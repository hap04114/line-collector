/**
 * Google Photorealistic 3D Tiles drawn inside the main MapLibre map (the "Photoreal" map style).
 *
 * The tiles live in a three.js scene in local meters around an origin near the map centre
 * (x east, y up, z south), the same frame Street Runner uses. Each frame:
 *  - the map's own projection (mercator -> clip) times a model matrix (local meters -> mercator) draws the city
 *    in exact sync with the map camera;
 *  - a real perspective camera is recovered from that matrix so 3d-tiles-renderer picks the right detail
 *    (screen-space error needs true distances in meters);
 *  - the depth buffer is cleared afterwards, so the T lines, stations, labels and pins draw on top of the
 *    city like overlays on Google Earth.
 */
import * as THREE from "three";
import { MercatorCoordinate, type CustomLayerInterface, type Map as MLMap } from "maplibre-gl";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import {
  TilesRenderer, LRUCache, PriorityQueue, DownloadPriorityQueue,
  DEFAULT_LRU_CACHE, DEFAULT_DOWNLOAD_QUEUE, DEFAULT_PARSE_QUEUE, DEFAULT_NODE_QUEUE,
} from "3d-tiles-renderer";
import { GoogleCloudAuthPlugin, GLTFExtensionsPlugin, TilesFadePlugin } from "3d-tiles-renderer/plugins";

// Boston streets sit ~27 m below the WGS84 ellipsoid; lift the city so its streets meet the map's sea-level plane
const LIFT = 27;
const RECENTER_M = 2000;
const M_LAT = 111_320;
const mLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

export type PhotoCredit = { logo: string; text: string };

/**
 * By default every TilesRenderer on the page shares one memory cache and one set of download queues.
 * The main map's photoreal city then filled that cache while Street Runner was open on top, so the runner's
 * city could not load a single tile (blank sky, "100%"). Each city gets its own cache and queues.
 */
export function giveOwnCaches(tiles: TilesRenderer, maxBytes?: number) {
  const t = tiles as any, d = DEFAULT_LRU_CACHE as any;
  const lru = new LRUCache() as any;
  for (const k of ["minSize", "maxSize", "minBytesSize", "maxBytesSize", "unloadPercent", "unloadPriorityCallback"]) if (d[k] !== undefined) lru[k] = d[k];
  if (maxBytes) { lru.maxBytesSize = maxBytes; lru.minBytesSize = Math.min(lru.minBytesSize ?? maxBytes, maxBytes * 0.75); }
  t.lruCache = lru;
  const dq = new DownloadPriorityQueue() as any;
  dq.maxJobsPerOrigin = (DEFAULT_DOWNLOAD_QUEUE as any).maxJobsPerOrigin;
  dq.priorityCallback = (DEFAULT_DOWNLOAD_QUEUE as any).priorityCallback;
  t.downloadQueue = dq;
  for (const [key, def] of [["parseQueue", DEFAULT_PARSE_QUEUE], ["processNodeQueue", DEFAULT_NODE_QUEUE]] as const) {
    const q = new PriorityQueue() as any;
    q.maxJobs = (def as any).maxJobs;
    q.priorityCallback = (def as any).priorityCallback;
    t[key] = q;
  }
}

// one photoreal city per map: MapLibre drops custom layers on a style switch without calling onRemove, so a
// second three.js renderer + tile set on the same canvas would leak and draw nothing. The same layer object is
// handed back on every switch to Photoreal and simply re-added (instant: its tiles are still in memory).
type Handlers = { onCredit: (c: PhotoCredit) => void; onFail: () => void };
type PhotoLayer = CustomLayerInterface & { setHandlers: (h: Handlers) => void; setPaused: (p: boolean) => void };
const perMap = new WeakMap<MLMap, PhotoLayer>();

/** Pause the main map's photoreal city (frees its tiles and GPU memory), e.g. while Street Runner is open. */
export function setPhotorealPaused(map: MLMap | null, paused: boolean) {
  if (map) perMap.get(map)?.setPaused(paused);
}

/** onFail fires if Google's tiles can't load (bad or restricted key, no network): the map falls back to Realistic. */
export function createPhotorealLayer(map: MLMap, apiToken: string, handlers: Handlers, coarse: boolean): CustomLayerInterface {
  const existing = perMap.get(map);
  if (existing) { existing.setHandlers(handlers); return existing; }
  let h = handlers;
  let rootLoaded = false, failed = false, paused = false;
  const fail = () => { if (!failed) { failed = true; h.onFail(); } };
  let renderer: THREE.WebGLRenderer | null = null;
  let tiles: TilesRenderer | null = null;
  const scene = new THREE.Scene();
  const renderCam = new THREE.Camera(); // identity world; its projection is the full clip <- local matrix
  const lodCam = new THREE.PerspectiveCamera(37, 1, 1, 1e6); // the map camera recovered in meters, for tile detail
  const model = new THREE.Matrix4(); // local meters -> mercator
  const view = new THREE.Matrix4();
  const clipFromLocal = new THREE.Matrix4();
  const mainM = new THREE.Matrix4();
  let originLon = 0, originLat = 0;
  let repaintUntil = 0, creditT = 0;

  // place the Earth-centred tiles into local meters around (lon, lat), and the local frame onto the map
  const recenter = (lon: number, lat: number) => {
    if (!tiles) return;
    originLon = lon; originLat = lat;
    const enu = tiles.ellipsoid.getEastNorthUpFrame((lat * Math.PI) / 180, (lon * Math.PI) / 180, 0, new THREE.Matrix4());
    new THREE.Matrix4().makeTranslation(0, LIFT, 0)
      .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
      .multiply(enu.invert())
      .decompose(tiles.group.position, tiles.group.quaternion, tiles.group.scale);
    tiles.group.updateMatrixWorld(true);
    const origin = MercatorCoordinate.fromLngLat([lon, lat], 0);
    const unit = origin.meterInMercatorCoordinateUnits();
    model.makeTranslation(origin.x, origin.y, origin.z)
      .scale(new THREE.Vector3(unit, -unit, unit))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  };

  // recover a true perspective camera (meters) from clip <- local: rows 0, 1 and 3 give the view's axes
  // (MapLibre's perspective is diagonal in x/y with w = -z), so neither the field of view nor near/far is needed
  const r0 = new THREE.Vector4(), r1 = new THREE.Vector4(), r3 = new THREE.Vector4();
  const updateLodCamera = (w: number, h: number) => {
    const e = clipFromLocal.elements; // column-major
    r0.set(e[0], e[4], e[8], e[12]);
    r1.set(e[1], e[5], e[9], e[13]);
    r3.set(e[3], e[7], e[11], e[15]);
    const l0 = Math.hypot(r0.x, r0.y, r0.z), l1 = Math.hypot(r1.x, r1.y, r1.z), s = Math.hypot(r3.x, r3.y, r3.z);
    if (!l0 || !l1 || !s) return;
    r0.multiplyScalar(1 / l0);
    r1.multiplyScalar(1 / l1);
    r3.multiplyScalar(-1 / s); // the view's z row
    // MapLibre flips y for screen pixels; undo it so the view is a proper rotation (what's in view is unchanged)
    const det = r0.x * (r1.y * r3.z - r1.z * r3.y) - r0.y * (r1.x * r3.z - r1.z * r3.x) + r0.z * (r1.x * r3.y - r1.y * r3.x);
    if (det < 0) r1.multiplyScalar(-1);
    view.set(r0.x, r0.y, r0.z, r0.w, r1.x, r1.y, r1.z, r1.w, r3.x, r3.y, r3.z, r3.w, 0, 0, 0, 1);
    lodCam.matrixWorld.copy(view).invert();
    lodCam.matrixWorld.decompose(lodCam.position, lodCam.quaternion, lodCam.scale);
    lodCam.updateMatrixWorld(true);
    const f = l1 / s; // 1 / tan(fov / 2)
    lodCam.fov = (2 * Math.atan(1 / f) * 180) / Math.PI;
    lodCam.aspect = l1 / l0;
    lodCam.updateProjectionMatrix();
    tiles!.setResolution(lodCam, w, h);
  };

  const layer = {
    setHandlers: (nh: Handlers) => { h = nh; },
    id: "lc-photoreal",
    type: "custom",
    renderingMode: "3d",
    onAdd(_m: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      if (failed) { h.onFail(); return; }
      if (renderer && tiles) {
        // back on Photoreal after another style: reuse the city already in memory
        repaintUntil = performance.now() + 900;
        map.triggerRepaint();
        return;
      }
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext });
      renderer.autoClear = false;
      buildTiles();
    },
    render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: any) {
      renderFrame(gl, args);
    },
    setPaused(p: boolean) {
      if (p === paused) return;
      paused = p;
      if (p) {
        // free the city (downloads, cache and GPU memory) so another 3D view gets the whole budget
        if (tiles) { scene.remove(tiles.group); tiles.dispose(); tiles = null; }
      } else if (renderer && !failed) {
        buildTiles();
      }
      map.triggerRepaint();
    },
    onRemove() {
      // kept for the next switch back to Photoreal (see perMap); freed when the map itself goes away
    },
  } satisfies PhotoLayer;

  function buildTiles() {
    if (!renderer || paused) return;
      tiles = new TilesRenderer();
      giveOwnCaches(tiles, coarse ? 160e6 : 320e6);
      tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken, autoRefreshToken: true, useRecommendedSettings: false }));
      tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: new DRACOLoader().setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/") }));
      tiles.registerPlugin(new TilesFadePlugin());
      // can't reach Google's city (key restricted to other sites, API off, offline): fall back instead of a blank map
      tiles.addEventListener("load-root-tileset", () => { rootLoaded = true; });
      tiles.addEventListener("load-error", () => { if (!rootLoaded) fail(); });
      setTimeout(() => { if (!rootLoaded && !paused) fail(); }, 20000);
      tiles.errorTarget = coarse ? 14 : 8; // lower = sharper; phones trade a little detail for speed
      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      const kick = () => { repaintUntil = performance.now() + 900; map.triggerRepaint(); };
      tiles.addEventListener("load-model", ({ scene: m }: any) => {
        // crisp streets at a low viewing angle
        m.traverse((o: any) => {
          for (const mat of [].concat(o.material ?? [])) {
            const t = (mat as any).map;
            if (t) { t.anisotropy = maxAniso; t.needsUpdate = true; }
          }
        });
        kick();
      });
      tiles.addEventListener("needs-update", kick);
      tiles.addEventListener("tiles-load-end", kick);
      scene.add(tiles.group);
      tiles.setCamera(lodCam);
      const c = map.getCenter();
      recenter(c.lng, c.lat);
      kick();
  }

  function renderFrame(gl: WebGLRenderingContext | WebGL2RenderingContext, args: any) {
      if (!renderer || !tiles || paused) return;
      // keep the local frame near the view so the city and the map's overlays stay registered
      const c = map.getCenter();
      if (Math.hypot((c.lng - originLon) * mLon(originLat), (c.lat - originLat) * M_LAT) > RECENTER_M) recenter(c.lng, c.lat);
      mainM.fromArray(args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix);
      clipFromLocal.multiplyMatrices(mainM, model);
      renderCam.projectionMatrix.copy(clipFromLocal);
      renderCam.projectionMatrixInverse.copy(clipFromLocal).invert();
      updateLodCamera(gl.drawingBufferWidth, gl.drawingBufferHeight);
      tiles.update();
      renderer.resetState();
      // the map canvas can change size (rotating a phone); render into its full drawing buffer
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      renderer.render(scene, renderCam);
      // overlays (T lines, stations, labels, pins) draw on top of the city
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      // keep drawing while tiles stream in and fade, then stop (no battery drain when the map is still)
      const now = performance.now();
      if (tiles.loadProgress < 1 || now < repaintUntil) map.triggerRepaint();
      if (now - creditT > 1000) {
        creditT = now;
        const at = tiles.getAttributions();
        h.onCredit({ logo: String(at.find((a) => a.type === "image")?.value ?? ""), text: at.filter((a) => a.type === "string").map((a) => String(a.value)).join(" ") });
      }
  }

  perMap.set(map, layer);
  map.once("remove", () => { tiles?.dispose(); tiles = null; renderer = null; perMap.delete(map); });
  return layer;
}
