/**
 * Three.js game objects drawn inside the MapLibre map, at real GIS coordinates:
 *  - spinning gold tokens over every stop you haven't collected
 *  - glowing beacons in your school's color over stops you have
 *  - a pulsing quest ring over the current quest stop
 *  - 3D trains at their live MBTA positions, pointing along their bearing
 * Objects scale with zoom so they stay readable from neighborhood to city view.
 */
import * as THREE from "three";
import { MercatorCoordinate, type CustomLayerInterface, type Map as MLMap } from "maplibre-gl";

export interface GameStation { id: string; lat: number; lon: number; collected: boolean }
export interface GameTrain { lat: number; lon: number; bearing: number; color: string }

const ORIGIN = MercatorCoordinate.fromLngLat([-71.0857, 42.3485], 0);
const METER = ORIGIN.meterInMercatorCoordinateUnits();

function local(lat: number, lon: number) {
  const m = MercatorCoordinate.fromLngLat([lon, lat], 0);
  return { x: (m.x - ORIGIN.x) / METER, z: (m.y - ORIGIN.y) / METER };
}

export class GameLayer3D implements CustomLayerInterface {
  id = "lc-game-3d";
  type = "custom" as const;
  renderingMode = "3d" as const;

  private map!: MLMap;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private t0 = performance.now();
  private tokens!: THREE.InstancedMesh;
  private beacons!: THREE.InstancedMesh;
  private trains!: THREE.InstancedMesh;
  private quest!: THREE.Group;
  private stations: GameStation[] = [];
  private trainData: GameTrain[] = [];
  private questAt: { x: number; z: number } | null = null;
  private dummy = new THREE.Object3D();
  private schoolColor = new THREE.Color("#c6ff3d");
  private dirty = true;

  setStations(list: GameStation[], schoolColor: string) {
    this.stations = list;
    this.schoolColor.set(schoolColor);
    this.dirty = true;
  }
  setTrains(list: GameTrain[]) {
    this.trainData = list;
  }
  setQuest(target: { lat: number; lon: number } | null) {
    this.questAt = target ? local(target.lat, target.lon) : null;
  }

  onAdd(map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.4, 1, 0.3);
    this.scene.add(sun);

    // Gold token: a thick coin with a raised rim
    const coin = new THREE.CylinderGeometry(1, 1, 0.25, 28);
    coin.rotateX(Math.PI / 2);
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0x7a5200, metalness: 0.85, roughness: 0.25 });
    this.tokens = new THREE.InstancedMesh(coin, gold, 200);
    this.tokens.frustumCulled = false;
    this.scene.add(this.tokens);

    // Beacon: a translucent light column in the school color
    const col = new THREE.CylinderGeometry(0.35, 0.6, 1, 16, 1, true);
    col.translate(0, 0.5, 0);
    const beam = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.beacons = new THREE.InstancedMesh(col, beam, 200);
    this.beacons.frustumCulled = false;
    this.scene.add(this.beacons);

    // Trains: a rounded car body
    const car = new THREE.BoxGeometry(1, 1, 1);
    car.translate(0, 0.5, 0);
    const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.45, emissive: 0x111111 });
    this.trains = new THREE.InstancedMesh(car, paint, 400);
    this.trains.frustumCulled = false;
    this.scene.add(this.trains);

    // Quest marker: spinning ring + down arrow
    this.quest = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 12, 48), new THREE.MeshBasicMaterial({ color: 0xc6ff3d }));
    ring.rotation.x = Math.PI / 2;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), new THREE.MeshStandardMaterial({ color: 0xc6ff3d, emissive: 0x4a6a00 }));
    arrow.rotation.x = Math.PI;
    arrow.position.y = 1.8;
    arrow.name = "arrow";
    this.quest.add(ring, arrow);
    this.scene.add(this.quest);
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: any) {
    const t = (performance.now() - this.t0) / 1000;
    // objects grow as you zoom out so the city view still reads like a game board
    const zoom = this.map.getZoom();
    const k = Math.min(400, Math.max(6, 22 * Math.pow(2, 15 - zoom)));

    let ti = 0, bi = 0;
    for (let i = 0; i < this.stations.length; i++) {
      const s = this.stations[i];
      const p = local(s.lat, s.lon);
      if (!s.collected) {
        this.dummy.position.set(p.x, k * (2.2 + 0.25 * Math.sin(t * 2 + i)), p.z);
        this.dummy.rotation.set(0, t * 1.8 + i, 0);
        this.dummy.scale.setScalar(k * 0.55);
        this.dummy.updateMatrix();
        this.tokens.setMatrixAt(ti++, this.dummy.matrix);
      } else {
        this.dummy.position.set(p.x, 0, p.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(k * 0.6, k * (4 + 0.4 * Math.sin(t * 3 + i)), k * 0.6);
        this.dummy.updateMatrix();
        this.beacons.setMatrixAt(bi++, this.dummy.matrix);
      }
    }
    this.tokens.count = ti;
    this.beacons.count = bi;
    this.tokens.instanceMatrix.needsUpdate = true;
    this.beacons.instanceMatrix.needsUpdate = true;
    if (this.dirty) {
      (this.beacons.material as THREE.MeshBasicMaterial).color.copy(this.schoolColor);
      this.dirty = false;
    }

    const c = new THREE.Color();
    for (let i = 0; i < this.trainData.length && i < 400; i++) {
      const tr = this.trainData[i];
      const p = local(tr.lat, tr.lon);
      this.dummy.position.set(p.x, k * 0.15, p.z);
      // bearing: degrees clockwise from north; scene: -z is north, +x is east
      this.dummy.rotation.set(0, -THREE.MathUtils.degToRad(tr.bearing), 0);
      this.dummy.scale.set(k * 0.35, k * 0.35, k * 1.3);
      this.dummy.updateMatrix();
      this.trains.setMatrixAt(i, this.dummy.matrix);
      this.trains.setColorAt(i, c.set(tr.color));
    }
    this.trains.count = Math.min(400, this.trainData.length);
    this.trains.instanceMatrix.needsUpdate = true;
    if (this.trains.instanceColor) this.trains.instanceColor.needsUpdate = true;

    this.quest.visible = !!this.questAt;
    if (this.questAt) {
      const s = k * (1.3 + 0.15 * Math.sin(t * 4));
      this.quest.position.set(this.questAt.x, k * 0.2, this.questAt.z);
      this.quest.scale.setScalar(s);
      this.quest.rotation.y = t * 1.5;
      const arrow = this.quest.getObjectByName("arrow")!;
      arrow.position.y = 2.2 + 0.4 * Math.sin(t * 5);
    }

    const mainMatrix = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args;
    const m = new THREE.Matrix4().fromArray(mainMatrix as number[]);
    const l = new THREE.Matrix4()
      .makeTranslation(ORIGIN.x, ORIGIN.y, ORIGIN.z)
      .scale(new THREE.Vector3(METER, -METER, METER))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }
}
