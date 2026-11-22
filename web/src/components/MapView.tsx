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
import { useStore } from "../store";

const STYLES = { night: "https://tiles.openfreemap.org/styles/dark", day: "https://tiles.openfreemap.org/styles/liberty" };
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
  const [theme, setTheme] = useState<"night" | "day">(() => {
    try {
      return (localStorage.getItem("lc-theme") as "night" | "day") || "night";
    } catch {
      return "night";
    }
  });
  const trains = useRef(new Map<string, { from: [number, number]; to: [number, number]; t0: number; color: string; route: string; label: string }>());
  const sRef = useRef(s);
  sRef.current = s;

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
      attributionControl: { compact: true },
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
    mapRef.current?.setStyle(STYLES[theme]);
    try {
      localStorage.setItem("lc-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // ---- custom layers (re-added after every style load) -------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !s.statics || map.getSource("lc-lines")) return;
    const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;

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
        paint: { "fill-color": "#c6ff3d", "fill-opacity": theme === "night" ? 0.1 : 0.16 },
      },
      firstSymbol,
    );

    map.addSource("lc-lines", { type: "geojson", data: s.statics.shapes });
    map.addLayer({ id: "lc-lines-casing", type: "line", source: "lc-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000", "line-width": 8, "line-opacity": 0.45 } });
    map.addLayer({ id: "lc-lines", type: "line", source: "lc-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4.5 } });
    map.addLayer({ id: "lc-lines-shuttle", type: "line", source: "lc-lines", filter: ["==", ["get", "shuttle"], true], paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [1, 2.5] } });

    map.addSource("lc-campuses", {
      type: "geojson",
      data: fc((s.config?.schools ?? []).map((c) => pt(c.lon, c.lat, { id: c.id, name: c.name, short: c.short, color: c.color }))),
    });
    map.addLayer({ id: "lc-campus-halo", type: "circle", source: "lc-campuses", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 16, 60], "circle-color": ["get", "color"], "circle-opacity": 0.12, "circle-blur": 0.6 } });
    map.addLayer({ id: "lc-campus-dots", type: "circle", source: "lc-campuses", paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: "lc-campus-labels", type: "symbol", source: "lc-campuses", layout: { "text-field": ["concat", "🎓 ", ["get", "short"]], "text-font": FONT, "text-size": 13, "text-offset": [0, 1.4], "text-anchor": "top" }, paint: { "text-color": ["get", "color"], "text-halo-color": "#0d0e12", "text-halo-width": 2 } });

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
          next.set(v.id, { from: cur, to: [v.lon, v.lat], t0: now, color: sRef.current.routeById.get(v.routeId)?.color ?? "#fff", route: v.routeId, label: v.label });
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
      src.setData(fc([...trains.current.entries()].map(([id, tr]) => { const [lon, lat] = lerp(tr, now); return pt(lon, lat, { id, color: tr.color }); })));
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
      <div style={{ position: "absolute", right: 10, bottom: "calc(var(--safe-bottom) + 200px)", zIndex: 4, display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="icon-btn" title="Day / night map" onClick={() => setTheme(theme === "night" ? "day" : "night")}>{theme === "night" ? "☀️" : "🌙"}</button>
        <button className="icon-btn" title="My location" onClick={() => (s.pos ? s.flyTo(s.pos.lat, s.pos.lon, 15.5) : s.toast(s.geoError || "Waiting for GPS…"))}>🎯</button>
      </div>
    </>
  );
}

function lerp(tr: { from: [number, number]; to: [number, number]; t0: number }, now: number): [number, number] {
  const k = Math.min(1, Math.max(0, (now - tr.t0) / 10_000));
  return [tr.from[0] + (tr.to[0] - tr.from[0]) * k, tr.from[1] + (tr.to[1] - tr.from[1]) * k];
}
