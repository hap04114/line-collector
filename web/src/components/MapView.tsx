/**
 * Live 3D Boston: OpenFreeMap tiles on MapLibre GL, real 3D buildings, every T line,
 * trains moving in real time (interpolated between 10 s polls), the student's GPS position,
 * collected stops filled in with their school's color, and campuses tinted.
 */
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
// MapLibre 6 loads its worker next to its own module; point it at the bundled asset instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
maplibregl.setWorkerUrl(workerUrl);
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useQuest, useQuests, useStore } from "../store";
import { createPhotorealLayer, setPhotorealPaused, type PhotoCredit } from "./PhotorealLayer";
import { GameLayer3D } from "./GameLayer3D";

const STYLES = { photo: "https://tiles.openfreemap.org/styles/liberty", real: "https://tiles.openfreemap.org/styles/liberty", day: "https://tiles.openfreemap.org/styles/liberty", night: "https://tiles.openfreemap.org/styles/dark" };
type Theme = keyof typeof STYLES;

const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/** Photoreal: Google's photorealistic 3D city replaces the base map; our lines, stations, labels and pins sit on top. */
function applyPhotoreal(map: MLMap, key: string, onCredit: (c: PhotoCredit) => void, onFail: () => void) {
  const layers = map.getStyle().layers;
  const firstAbove = layers.find((l) => l.type !== "background")?.id;
  for (const l of layers) {
    try {
      if (l.type === "background") map.setPaintProperty(l.id, "background-color", "#cfd6de");
      else if (l.type !== "symbol") map.setLayoutProperty(l.id, "visibility", "none");
    } catch { /* ignore */ }
  }
  if (!map.getLayer("lc-photoreal")) map.addLayer(createPhotorealLayer(map, key, { onCredit, onFail }, COARSE), firstAbove);
  try {
    (map as any).setSky({ "sky-color": "#79aee0", "horizon-color": "#eaddc7", "fog-color": "#e6dccb", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.65, "fog-ground-blend": 0.8, "atmosphere-blend": 0.7 });
  } catch { /* older style spec */ }
}

/** Realistic look on top of the liberty style: real building materials, asphalt streets with lane paint,
 *  concrete sidewalks, real greens and water, a hazy sky at the horizon and sunlight that shades the buildings. */
function applyRealistic(map: MLMap) {
  for (const l of map.getStyle().layers) {
    try {
      if (l.type === "line" && /^(road|bridge|tunnel)_/.test(l.id) && !/rail|hatching/.test(l.id)) {
        map.setPaintProperty(l.id, "line-color", /casing/.test(l.id) ? "#bcb6ab" : /path|pedestrian/.test(l.id) ? "#d8d2c6" : /^tunnel/.test(l.id) ? "#6b6d72" : "#4a4c51");
      } else if (l.id === "background") map.setPaintProperty(l.id, "background-color", "#dcd7cd");
      else if (l.type === "fill" && /park|grass|wood|pitch|cemetery|golf/.test(l.id)) map.setPaintProperty(l.id, "fill-color", "#7aa15a");
      else if (l.type === "fill" && /water/.test(l.id)) map.setPaintProperty(l.id, "fill-color", "#5a8bb0");
      else if (l.type === "line" && /^waterway/.test(l.id)) map.setPaintProperty(l.id, "line-color", "#5a8bb0");
      else if (l.type === "fill" && /^landuse_/.test(l.id)) map.setPaintProperty(l.id, "fill-color", "#d3cdc2");
      else if (l.id === "building") map.setPaintProperty(l.id, "fill-color", "#c3b8aa");
      else if (l.id === "road_area_pattern") map.setLayoutProperty(l.id, "visibility", "none");
    } catch { /* layer without that property */ }
  }
  if (map.getLayer("building-3d")) {
    // Boston brick and brownstone low-rise, limestone and concrete mid-rise, glass towers;
    // a real building colour from OpenStreetMap wins when it's tagged
    const h = ["coalesce", ["get", "render_height"], 8];
    const pick = ["%", ["floor", ["+", ["*", h, 3.7], ["*", ["coalesce", ["get", "render_min_height"], 0], 1.3]]], 4];
    map.setPaintProperty("building-3d", "fill-extrusion-color", [
      "case",
      ["has", "colour"], ["to-color", ["get", "colour"], "#b9ab98"],
      [">", h, 45], ["match", pick, 0, "#8193a6", 1, "#8c9db0", 2, "#71849a", "#97a8ba"],
      [">", h, 16], ["match", pick, 0, "#cfc3ae", 1, "#c0b4a1", 2, "#aaa398", "#957660"],
      ["match", pick, 0, "#a5614a", 1, "#b06d53", 2, "#935543", "#bc8a6b"],
    ] as any);
    map.setPaintProperty("building-3d", "fill-extrusion-opacity", 1);
    map.setPaintProperty("building-3d", "fill-extrusion-vertical-gradient", true);
  }
  if (!map.getLayer("lc-lanes")) {
    map.addLayer({
      id: "lc-lanes", type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: 16,
      filter: ["all", ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "trunk"]]], ["!=", ["get", "brunnel"], "tunnel"]],
      paint: { "line-color": "#f2efe6", "line-width": ["interpolate", ["exponential", 2], ["zoom"], 16, 0.5, 20, 2.4], "line-dasharray": [4, 6], "line-opacity": 0.75 },
    } as any, map.getLayer("building") ? "building" : undefined);
  }
  try {
    (map as any).setSky({ "sky-color": "#79aee0", "horizon-color": "#eaddc7", "fog-color": "#e6dccb", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.65, "fog-ground-blend": 0.8, "atmosphere-blend": 0.7 });
  } catch { /* older style spec */ }
  try {
    map.setLight({ anchor: "map", color: "#fff3e0", intensity: 0.42, position: [1.5, 210, 40] } as any);
  } catch { /* ignore */ }
}
const FONT = ["Noto Sans Regular"];

type Pins = { id: string; name: string; lat: number; lon: number; partner: boolean; kind: string }[];
let pinSink: ((p: Pins, selected?: string | null) => void) | null = null;
/** StationSheet calls this to show its spots on the map. */
export function showSpotPins(p: Pins, selected: string | null = null) {
  pinSink?.(p, selected);
}
let pinClick: ((id: string) => void) | null = null;
export function onSpotPinClick(fn: ((id: string) => void) | null) {
  pinClick = fn;
}

const fc = (features: any[]): any => ({ type: "FeatureCollection", features });
const pt = (lon: number, lat: number, properties: any = {}) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: [lon, lat] } });

export function MapView() {
  const s = useStore();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [loaded, setLoaded] = useState(0); // bumps on every style load
  // v2 key: an older saved "Illustrated" choice shouldn't hide the new looks. Default: Photoreal on laptops
  // (it needs the Google key; without one it draws as Realistic), Realistic on phones (lighter on data and battery)
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem("lc-theme-v2") as Theme | null;
      return t && t in STYLES ? t : COARSE ? "real" : "photo";
    } catch {
      return "real";
    }
  });
  const tilesKey = s.config?.googleTilesKey ?? null;
  const [gCredit, setGCredit] = useState<PhotoCredit | null>(null);
  const trains = useRef(new Map<string, { from: [number, number]; to: [number, number]; t0: number; color: string; route: string; label: string; bearing: number }>());
  const game = useRef<GameLayer3D | null>(null);
  const [show3d, setShow3d] = useState(() => {
    try {
      return localStorage.getItem("lc-3d") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    game.current?.setVisible(show3d);
    try {
      localStorage.setItem("lc-3d", show3d ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [show3d, loaded]);
  const sRef = useRef(s);
  sRef.current = s;
  // Street Runner draws its own photoreal city full-screen: free the map's one meanwhile (memory, GPU, data)
  const runnerOpen = s.panel === "run";
  useEffect(() => { setPhotorealPaused(mapRef.current, runnerOpen); }, [runnerOpen, loaded]);

  // ---- create map once ------------------------------------------------------------
  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const home = s.config?.schools.find((c) => c.id === s.me?.user?.school?.id);
    const map = new maplibregl.Map({
      container: el.current,
      style: STYLES[theme],
      center: home ? [home.lon, home.lat] : [-71.0892, 42.3398],
      zoom: 13.4,
      pitch: 55,
      bearing: -18,
      maxPitch: 72,
      // stay in Greater Boston: zooming out stops where the T and the city end
      maxBounds: [[-71.42, 42.13], [-70.82, 42.53]],
      minZoom: 10.6,
      attributionControl: { compact: true },
      // smoother edges (photoreal city, 3D buildings) on laptops; phones keep the faster default
      canvasContextAttributes: { antialias: !COARSE },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.on("style.load", () => setLoaded((n) => n + 1));
    mapRef.current = map;

    const onStation = (e: any) => {
      const f = e.features?.[0];
      if (!f) return;
      sRef.current.openStation(f.properties.id);
      map.easeTo({ center: (f.geometry as any).coordinates, zoom: Math.max(map.getZoom(), 15.2), duration: 700 });
    };
    map.on("click", "lc-stations", onStation);
    map.on("click", "lc-spots", (e: any) => {
      const f = e.features?.[0];
      if (f) pinClick?.(f.properties.id);
    });
    for (const layer of ["lc-stations", "lc-spots", "lc-campus-dots"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
    map.on("click", "lc-campus-dots", (e: any) => {
      const f = e.features?.[0];
      if (f) new maplibregl.Popup({ closeButton: false }).setLngLat((f.geometry as any).coordinates).setText(f.properties.name).addTo(map);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- theme switch -----------------------------------------------------------------
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    // a full reload (no diff): Realistic and Illustrated share a base style but paint it differently
    mapRef.current?.setStyle(STYLES[theme], { diff: false });
    try {
      localStorage.setItem("lc-theme-v2", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // ---- custom layers (re-added after every style load) -------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !s.statics || map.getSource("lc-lines")) return;
    const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    // real 3D buildings from neighborhood zoom: realistic materials, or shaded by height (illustrated style)
    if (map.getLayer("building-3d")) map.setLayerZoomRange("building-3d", 13, 24);
    const photoOn = theme === "photo" && !!sRef.current.config?.googleTilesKey;
    if (photoOn) {
      applyPhotoreal(map, sRef.current.config!.googleTilesKey!, setGCredit, () => {
        setTheme("real");
        sRef.current.toast("Photoreal map isn't available right now, showing Realistic");
      });
    }
    else if (theme === "real" || theme === "photo") applyRealistic(map);
    else if (map.getLayer("building-3d")) {
      map.setPaintProperty("building-3d", "fill-extrusion-color", ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, "#ece6dc", 20, "#ddd6ca", 60, "#c9cfd9", 150, "#aab6c8"]);
      map.setPaintProperty("building-3d", "fill-extrusion-opacity", 0.92);
    }

    if (!map.getLayer("building-3d") && !map.getLayer("lc-buildings")) {
      map.addLayer(
        {
          id: "lc-buildings", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
          paint: {
            "fill-extrusion-color": "#272a35",
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": 0.88,
          },
        },
        firstSymbol,
      );
    }
    map.addLayer(
      {
        id: "lc-campus-tint", type: "fill", source: "openmaptiles", "source-layer": "landuse",
        filter: ["in", ["get", "class"], ["literal", ["university", "college"]]],
        paint: { "fill-color": "#c6ff3d", "fill-opacity": theme === "night" ? 0.1 : theme === "photo" ? 0 : theme === "real" ? 0.07 : 0.16 },
      },
      firstSymbol,
    );

    // Commuter Rail: purple rail lines with white ties and small stop rings, drawn under the subway
    if (s.statics.commuter?.shapes.features.length) {
      map.addSource("lc-cr", { type: "geojson", data: s.statics.commuter.shapes });
      map.addSource("lc-cr-stops", { type: "geojson", data: fc(s.statics.commuter.stations.map((st) => pt(st.lon, st.lat, { name: st.name }))) });
      map.addLayer({ id: "lc-cr-casing", type: "line", source: "lc-cr", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000", "line-width": 6, "line-opacity": 0.3 } });
      map.addLayer({ id: "lc-cr", type: "line", source: "lc-cr", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#80276C", "line-width": 3.5 } });
      map.addLayer({ id: "lc-cr-ties", type: "line", source: "lc-cr", paint: { "line-color": "#ffffff", "line-width": 1.2, "line-dasharray": [0.6, 3] } });
      map.addLayer({
        id: "lc-cr-stops", type: "circle", source: "lc-cr-stops", minzoom: 10.5,
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10.5, 2.5, 16, 6], "circle-color": "#ffffff", "circle-stroke-color": "#80276C", "circle-stroke-width": 2 },
      });
      map.addLayer({
        id: "lc-cr-labels", type: "symbol", source: "lc-cr-stops", minzoom: 13,
        layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": "#80276C", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
    }
    map.addSource("lc-lines", { type: "geojson", data: s.statics.shapes });
    map.addLayer({ id: "lc-lines-casing", type: "line", source: "lc-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000", "line-width": 8, "line-opacity": 0.45 } });
    map.addLayer({ id: "lc-lines", type: "line", source: "lc-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4.5 } });
    map.addLayer({ id: "lc-lines-shuttle", type: "line", source: "lc-lines", filter: ["==", ["get", "shuttle"], true], paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [1, 2.5] } });

    map.addSource("lc-campuses", {
      type: "geojson",
      data: fc((s.config?.schools ?? []).map((c) => pt(c.lon, c.lat, { id: c.id, name: c.name, short: c.short, color: c.color }))),
    });
    map.addLayer({ id: "lc-campus-halo", type: "circle", source: "lc-campuses", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 16, 60], "circle-color": ["get", "color"], "circle-opacity": 0.12, "circle-blur": 0.6 } });

    map.addSource("lc-stations", { type: "geojson", data: fc([]) });
    map.addLayer({ id: "lc-owner-ring", type: "circle", source: "lc-stations", filter: ["!=", ["get", "owner"], ""], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 15], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["get", "owner"], "circle-stroke-width": 2, "circle-stroke-opacity": 0.55 } });
    map.addLayer({ id: "lc-pulse", type: "circle", source: "lc-stations", filter: ["==", ["get", "pulse"], true], paint: { "circle-radius": 18, "circle-color": ["get", "fill"], "circle-opacity": 0.35, "circle-blur": 0.4 } });
    map.addLayer({
      id: "lc-stations", type: "circle", source: "lc-stations",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["get", "collected"], 4.5, 3], 16, ["case", ["get", "collected"], 11, 8]],
        "circle-color": ["case", ["get", "collected"], ["get", "fill"], "#0d0e12"],
        "circle-stroke-color": ["case", ["get", "collected"], "#ffffff", ["get", "line"]],
        "circle-stroke-width": ["case", ["get", "selected"], 4, 2.2],
      },
    });
    map.addLayer({
      id: "lc-station-labels", type: "symbol", source: "lc-stations", minzoom: 13.2,
      layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 12, "text-offset": [0, 1.25], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": theme === "night" ? "#f3f4f6" : "#1b1d24", "text-halo-color": theme === "night" ? "#0d0e12" : "#ffffff", "text-halo-width": 1.6 },
    });

    map.addSource("lc-spots", { type: "geojson", data: fc([]) });
    map.addLayer({ id: "lc-spots", type: "circle", source: "lc-spots", paint: { "circle-radius": ["case", ["get", "selected"], 9, 6], "circle-color": ["match", ["get", "kind"], "study", "#5ab0ff", "landmark", "#3ddc97", "hangout", "#3ddc97", "#c6ff3d"], "circle-stroke-color": ["case", ["get", "partner"], "#ffd166", "#0d0e12"], "circle-stroke-width": ["case", ["get", "partner"], 3, 1.5] } });
    map.addLayer({ id: "lc-spot-labels", type: "symbol", source: "lc-spots", minzoom: 14.5, layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#c6ff3d", "text-halo-color": "#0d0e12", "text-halo-width": 1.5 } });

    map.addSource("lc-trains", { type: "geojson", data: fc([]) });
    map.addLayer({ id: "lc-trains-glow", type: "circle", source: "lc-trains", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 14], "circle-color": ["get", "color"], "circle-opacity": 0.3, "circle-blur": 0.8 } });
    map.addLayer({ id: "lc-trains", type: "circle", source: "lc-trains", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 16, 7], "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.6 } });

    map.addSource("lc-me", { type: "geojson", data: fc([]) });
    map.addLayer({ id: "lc-me-acc", type: "circle", source: "lc-me", paint: { "circle-radius": 26, "circle-color": "#5ab0ff", "circle-opacity": 0.15 } });
    map.addLayer({ id: "lc-me", type: "circle", source: "lc-me", paint: { "circle-radius": 7.5, "circle-color": "#5ab0ff", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });

    if (!map.getLayer("lc-game-3d")) {
      game.current = new GameLayer3D();
      map.addLayer(game.current);
    }
    pinSink = (pins, selected) => {
      (map.getSource("lc-spots") as GeoJSONSource | undefined)?.setData(fc(pins.map((p) => pt(p.lon, p.lat, { id: p.id, name: p.name, partner: p.partner, kind: p.kind, selected: p.id === selected }))));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, s.statics]);

  // ---- stations: collected fill, weekly owner ring, selection ---------------------------
  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("lc-stations") as GeoJSONSource | undefined;
    if (!src || !s.statics) return;
    const collected = new Set(s.mapState?.collected ?? []);
    const myColor = s.me?.user?.school?.color ?? "#c6ff3d";
    src.setData(
      fc(
        s.statics.stations.map((st) => {
          const owner = s.mapState?.weekOwners?.[st.id];
          return pt(st.lon, st.lat, {
            id: st.id,
            name: st.name,
            collected: collected.has(st.id),
            fill: myColor,
            line: s.routeById.get(st.routes[0])?.color ?? "#999",
            owner: owner ? s.schoolById.get(owner.school)?.color ?? "" : "",
            selected: st.id === s.stationId,
            pulse: st.id === s.justCollected,
          });
        }),
      ),
    );
  }, [loaded, s.statics, s.mapState, s.me, s.stationId, s.justCollected, s.routeById, s.schoolById]);

  // ---- map overlays: layer toggles, campus pills, quest bubbles, live status -------------------------
  const [layers, setLayers] = useState({ is3d: true, trains: true, campuses: true, quests: true, delays: false });
  const [panel, setPanel] = useState(false);
  const [liveInfo, setLiveInfo] = useState<{ at: string | null; tempF: number | null; trains: number }>({ at: null, tempF: null, trains: 0 });
  const quests = useQuests(5);
  const campusMarkers = useRef<maplibregl.Marker[]>([]);
  const questMarkers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    for (const id of ["lc-trains", "lc-trains-glow"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", layers.trains ? "visible" : "none");
    if (map.getLayer("lc-lines"))
      map.setPaintProperty("lc-lines", "line-color", layers.delays ? ["interpolate", ["linear"], ["get", "chaos"], 0, "#3ddc97", 35, "#ffb020", 65, "#ff3b3b"] : ["get", "color"]);
    map.easeTo({ pitch: layers.is3d ? 55 : 0, duration: 600 });
  }, [layers, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !s.config) return;
    for (const m of campusMarkers.current) m.remove();
    campusMarkers.current = [];
    if (!layers.campuses) return;
    for (const c of s.config.schools) {
      const el = document.createElement("div");
      el.className = `campus-pill${c.id === s.me?.user?.school?.id ? " mine" : ""}`;
      el.innerHTML = `<i style="background:${c.color}"></i>${c.short}`;
      el.title = c.name;
      campusMarkers.current.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([c.lon, c.lat]).addTo(map));
    }
  }, [s.config, layers.campuses, loaded, s.me?.user?.school?.id]);

  const questKey = quests.map((q) => `${q.station.id}:${q.points}`).join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of questMarkers.current) m.remove();
    questMarkers.current = [];
    if (!layers.quests) return;
    quests.forEach((q, i) => {
      const el = document.createElement("button");
      el.className = `quest-pin${i === 0 ? " top" : ""}`;
      el.innerHTML = `<span>${i === 0 ? "🎯" : "✨"}</span><b>+${q.points}</b>`;
      el.title = `${q.station.name}: ${q.reasons.join(", ")}`;
      el.onclick = (e) => {
        e.stopPropagation();
        sRef.current.openStation(q.station.id);
        sRef.current.flyTo(q.station.lat, q.station.lon, 15.5);
      };
      questMarkers.current.push(new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -14] }).setLngLat([q.station.lon, q.station.lat]).addTo(map));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questKey, layers.quests, loaded]);

  useEffect(() => {
    const load = () =>
      api.get("/lines/status").then((r) => setLiveInfo((x) => ({ ...x, at: r.updatedAt, tempF: r.weather?.tempF ?? null }))).catch(() => {});
    load();
    const t = setInterval(() => {
      load();
      setLiveInfo((x) => ({ ...x, trains: trains.current.size }));
    }, 15_000);
    const t2 = setTimeout(() => setLiveInfo((x) => ({ ...x, trains: trains.current.size })), 4000);
    return () => { clearInterval(t); clearTimeout(t2); };
  }, []);
  const ago = liveInfo.at ? Math.max(0, Math.round((Date.now() - new Date(liveInfo.at).getTime()) / 1000)) : null;

  // ---- Three.js game layer: tokens, beacons, quest ring, 3D trains -----------------------------
  const quest = useQuest();
  useEffect(() => {
    const g = game.current;
    if (!g || !s.statics) return;
    const collected = new Set(s.mapState?.collected ?? []);
    g.setStations(s.statics.stations.map((st) => ({ id: st.id, lat: st.lat, lon: st.lon, collected: collected.has(st.id) })), s.me?.user?.school?.color ?? "#c6ff3d");
    g.setQuest(quest ? { lat: quest.station.lat, lon: quest.station.lon } : null);
  }, [loaded, s.statics, s.mapState, s.me, quest]);

  // ---- lines: chaos width in Ride mode, dashed shuttle overlay ------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("lc-lines") as GeoJSONSource | undefined;
    if (!map || !src || !s.statics) return;
    const status = new Map((s.mapState?.lines ?? []).map((l) => [l.routeId, l]));
    src.setData(fc(s.statics.shapes.features.map((f: any) => ({ ...f, properties: { ...f.properties, chaos: status.get(f.properties.routeId)?.chaos ?? 0, shuttle: !!status.get(f.properties.routeId)?.shuttle } }))));
    map.setPaintProperty("lc-lines", "line-width", s.mode === "ride" ? ["interpolate", ["linear"], ["get", "chaos"], 0, 4, 100, 12] : 4.5);
    map.setPaintProperty("lc-lines", "line-opacity", s.mode === "ride" ? 1 : 0.9);
  }, [loaded, s.statics, s.mapState, s.mode]);

  // ---- GPS dot ------------------------------------------------------------------------------
  useEffect(() => {
    const src = mapRef.current?.getSource("lc-me") as GeoJSONSource | undefined;
    if (src && s.pos) src.setData(fc([pt(s.pos.lon, s.pos.lat)]));
  }, [loaded, s.pos]);

  // ---- fly-to requests ------------------------------------------------------------------------
  useEffect(() => {
    if (s.focus && mapRef.current) mapRef.current.flyTo({ center: [s.focus.lon, s.focus.lat], zoom: s.focus.zoom ?? mapRef.current.getZoom(), pitch: 55, speed: 1.4 });
  }, [s.focus]);

  // ---- live trains: poll every 10 s, interpolate every frame -------------------------------------
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await api.get<{ vehicles: any[] }>("/trains");
        const now = performance.now();
        const next = new Map<string, any>();
        for (const v of r.vehicles) {
          const prev = trains.current.get(v.id);
          const cur = prev ? lerp(prev, now) : ([v.lon, v.lat] as [number, number]);
          next.set(v.id, { from: cur, to: [v.lon, v.lat], t0: now, color: sRef.current.routeById.get(v.routeId)?.color ?? "#fff", route: v.routeId, label: v.label, bearing: v.bearing ?? 0 });
        }
        trains.current = next;
      } catch {
        /* keep last known trains */
      }
    };
    poll();
    const t = setInterval(poll, 10_000);
    let raf = 0, last = 0;
    const frame = (ts: number) => {
      if (stop) return;
      raf = requestAnimationFrame(frame);
      if (ts - last < 60) return;
      last = ts;
      const src = mapRef.current?.getSource("lc-trains") as GeoJSONSource | undefined;
      if (!src) return;
      const now = performance.now();
      const list = [...trains.current.entries()].map(([id, tr]) => { const [lon, lat] = lerp(tr, now); return { id, lon, lat, color: tr.color, bearing: tr.bearing }; });
      src.setData(fc(list.map((x) => pt(x.lon, x.lat, { id: x.id, color: x.color }))));
      game.current?.setTrains(list);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      stop = true;
      clearInterval(t);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div ref={el} className="map" aria-label="Map of Boston T stations" />
      {theme === "photo" && tilesKey && gCredit && (
        <div className="g-credit">{gCredit.logo && <img src={gCredit.logo} alt="Google" />}<span>{gCredit.text}</span></div>
      )}
      <div style={{ position: "absolute", right: 10, bottom: "calc(var(--safe-bottom) + 236px)", zIndex: 4, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
        {panel && (
          <div className="layer-panel">
            <div className="live-pill"><span className="live-dot" />LIVE · {liveInfo.trains || "…"} trains{ago != null ? ` · ${ago < 90 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago` : ""}{liveInfo.tempF != null ? ` · ${Math.round(liveInfo.tempF)}°F` : ""}</div>
            <div className="seg" style={{ padding: 3 }}>
              <button className={layers.is3d ? "on" : ""} onClick={() => setLayers({ ...layers, is3d: true })}>3D</button>
              <button className={!layers.is3d ? "on" : ""} onClick={() => setLayers({ ...layers, is3d: false })}>2D</button>
            </div>
            <div className="seg style-grid" style={{ padding: 3 }}>
              {([["photo", "📸 Photoreal"], ["real", "Realistic"], ["day", "Illustrated"], ["night", "Night"]] as const)
                .filter(([k]) => k !== "photo" || tilesKey)
                .map(([k, label]) => (
                  <button key={k} className={theme === k ? "on" : ""} onClick={() => setTheme(k)}>{label}</button>
                ))}
            </div>
            {([["trains", "Live trains"], ["campuses", "Campuses"], ["quests", "Quests"], ["delays", "Color lines by delay"]] as const).map(([k, label]) => (
              <label key={k} className="check"><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /><span>{label}</span></label>
            ))}
            <label className="check"><input type="checkbox" checked={show3d} onChange={(e) => setShow3d(e.target.checked)} /><span>3D tokens</span></label>
          </div>
        )}
        <button className="icon-btn" title="Map layers" onClick={() => setPanel(!panel)} style={panel ? { borderColor: "var(--accent)" } : undefined}>🗂️</button>
        <button className="icon-btn" title="My location" onClick={() => (s.pos ? s.flyTo(s.pos.lat, s.pos.lon, 15.5) : s.toast(s.geoError || "Waiting for GPS…"))}>🎯</button>
      </div>
    </>
  );
}

function lerp(tr: { from: [number, number]; to: [number, number]; t0: number }, now: number): [number, number] {
  const k = Math.min(1, Math.max(0, (now - tr.t0) / 10_000));
  return [tr.from[0] + (tr.to[0] - tr.from[0]) * k, tr.from[1] + (tr.to[1] - tr.from[1]) * k];
}
