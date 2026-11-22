/**
 * Street Runner: run your T line through the REAL streets of Boston.
 * The world is the actual map: real OpenStreetMap building footprints in 3D, real street names,
 * real shop and restaurant labels, parks and the river (OpenFreeMap "liberty" style on MapLibre).
 * The camera rides at street level along the line's real route; only the runner, tokens and
 * obstacles are game pieces (Three.js, anchored to real coordinates).
 */
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { MercatorCoordinate, type CustomLayerInterface, type Map as MLMap } from "maplibre-gl";
import * as THREE from "three";
import { api } from "../api";
import { LinePill, useStore } from "../store";

const LANES = [-4, 0, 4]; // meters left/right of the route
const M_LAT = 110540;
const mLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

interface Path { pts: [number, number][]; cum: number[]; len: number }
type Kind = "barrier" | "cone" | "bus" | "token" | "shield";
interface Thing { s: number; lane: number; kind: Kind; alive: boolean; mesh: THREE.Object3D; len: number; h: number }

function buildPath(coords: [number, number][]): Path {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    const dx = (b[0] - a[0]) * mLon(a[1]), dy = (b[1] - a[1]) * M_LAT;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return { pts: coords, cum, len: cum[cum.length - 1] };
}

/** point + unit heading (east, north) at distance s along the path */
function at(p: Path, s: number) {
  s = Math.max(0, Math.min(p.len - 0.01, s));
  let lo = 0, hi = p.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.cum[m] <= s) lo = m; else hi = m; }
  const a = p.pts[lo], b = p.pts[hi];
  const seg = p.cum[hi] - p.cum[lo] || 1;
  const k = (s - p.cum[lo]) / seg;
  const lon = a[0] + (b[0] - a[0]) * k, lat = a[1] + (b[1] - a[1]) * k;
  const e = (b[0] - a[0]) * mLon(a[1]), n = (b[1] - a[1]) * M_LAT;
  const l = Math.hypot(e, n) || 1;
  return { lon, lat, e: e / l, n: n / l };
}

function offset(lon: number, lat: number, e: number, n: number, right: number, fwd = 0): [number, number] {
  // right-hand normal of heading (e, n) is (n, -e)
  const de = n * right + e * fwd, dn = -e * right + n * fwd;
  return [lon + de / mLon(lat), lat + dn / M_LAT];
}

function project(p: Path, lon: number, lat: number) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < p.pts.length; i++) {
    const dx = (p.pts[i][0] - lon) * mLon(lat), dy = (p.pts[i][1] - lat) * M_LAT;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return { s: p.cum[best], d: Math.sqrt(bd) };
}

function label(text: string, bg: string, fg = "#fff") {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 112;
  const g = c.getContext("2d")!;
  g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, 504, 104, 20); g.fill();
  g.fillStyle = fg; let size = 48;
  g.font = `800 ${size}px Inter, system-ui, sans-serif`;
  while (g.measureText(text).width > 470 && size > 18) { size -= 2; g.font = `800 ${size}px Inter, system-ui, sans-serif`; }
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 58);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function StreetRunner({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const homeStations = s.config?.schools.find((c) => c.id === s.me?.user?.school?.id)?.homeStations ?? [];
  const [line, setLine] = useState(() => s.stationById.get(homeStations[0] ?? "")?.routes[0] ?? "Green-B");
  const [phase, setPhase] = useState<"ready" | "playing" | "over">("ready");
  const [runKey, setRunKey] = useState(0);
  const autoStart = useRef(false);
  const [hud, setHud] = useState({ score: 0, tokens: 0, distance: 0, next: "", street: "", shield: 0, kmh: 0, count: 0 });
  const [flash, setFlash] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [top, setTop] = useState<any>(null);
  const el = useRef<HTMLDivElement>(null);
  const controls = useRef({ left: () => {}, right: () => {}, jump: () => {} });
  const route = s.routeById.get(line);

  useEffect(() => { api.get(`/arcade/top?line=${line}`).then(setTop).catch(() => {}); }, [line, result]);

  useEffect(() => {
    if (!el.current || !route || !s.statics) return;
    // the line's longest real shape, oriented to start near your home station
    const shapes = s.statics.shapes.features.filter((f: any) => f.properties.routeId === line);
    let coords: [number, number][] = shapes.reduce((a: any, f: any) => (f.geometry.coordinates.length > a.length ? f.geometry.coordinates : a), []);
    let path = buildPath(coords);
    const stations = route.stopIds.map((id) => s.stationById.get(id)!).filter(Boolean);
    const first = project(path, stations[0].lon, stations[0].lat);
    if (first.s > path.len / 2) { coords = [...coords].reverse(); path = buildPath(coords); }
    const stops = stations.map((st) => ({ name: st.name, ...project(path, st.lon, st.lat) })).filter((x) => x.d < 400).sort((a, b) => a.s - b.s);
    const home = stops.find((x) => stations.find((st) => st.name === x.name && homeStations.includes(st.id)));
    const startS = Math.max(0, (home?.s ?? 0) - 80);
    const L = path.len;
    const linePos = (r: number) => { const u = startS + r, k = Math.floor(u / L), w = u - k * L; return k % 2 === 0 ? { p: w, dir: 1 } : { p: L - w, dir: -1 }; };

    const start = at(path, startS);
    const map = new maplibregl.Map({
      container: el.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [start.lon, start.lat],
      zoom: 19.3,
      pitch: 76,
      maxPitch: 85,
      bearing: (Math.atan2(start.e, start.n) * 180) / Math.PI,
      interactive: false,
      attributionControl: { compact: true },
    });

    (window as any).__srmap = map;
    map.on("error", (e: any) => console.error("[street-runner map]", e?.error?.message ?? e));
    // ---- game pieces (Three.js inside the map) ----------------------------------------------
    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.3, 1, 0.4); scene.add(sun);
    const schoolColor = new THREE.Color(s.me?.user?.school?.color ?? "#c6ff3d");
    const lineColor = new THREE.Color(route.color);
    const SCALE = 3.2; // game pieces are drawn larger than life so they read at street-level zoom

    const runner = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.8, 6, 12), new THREE.MeshStandardMaterial({ color: schoolColor }));
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 18, 14), new THREE.MeshStandardMaterial({ color: 0xf2c9a0 }));
    head.position.y = 1.85;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: lineColor }));
    cap.position.y = 1.9;
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 14), new THREE.MeshBasicMaterial({ color: 0x7ad7ff, transparent: true, opacity: 0.25 }));
    bubble.position.y = 1.1; bubble.visible = false;
    runner.add(body, head, cap, bubble);
    runner.scale.setScalar(SCALE);
    scene.add(runner);

    const geo = { barrier: new THREE.BoxGeometry(2.4, 1, 0.4), cone: new THREE.ConeGeometry(0.5, 1.1, 14), bus: new THREE.BoxGeometry(2.4, 3, 9), token: new THREE.CylinderGeometry(0.5, 0.5, 0.12, 24), shield: new THREE.SphereGeometry(0.5, 16, 12) };
    geo.token.rotateX(Math.PI / 2);
    for (const g of Object.values(geo)) g.translate(0, 0, 0);
    const mats = {
      barrier: new THREE.MeshStandardMaterial({ map: label("DELAY", "#ff5a5f") }),
      cone: new THREE.MeshStandardMaterial({ color: 0xff7a00 }),
      bus: new THREE.MeshStandardMaterial({ color: 0xffd23f }),
      token: new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0x6a4a00, metalness: 0.9, roughness: 0.2 }),
      shield: new THREE.MeshStandardMaterial({ color: 0x7ad7ff, emissive: 0x1a5070 }),
    };
    const things: Thing[] = [];
    const signs: { s: number; mesh: THREE.Mesh; name: string; counted: boolean }[] = [];
    for (const st of stops) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 2), new THREE.MeshBasicMaterial({ map: label(`🚉 ${st.name}`, route.color), side: THREE.DoubleSide, transparent: true }));
      scene.add(m);
      signs.push({ s: st.s, mesh: m, name: st.name, counted: false });
    }

    const state = { run: 0, lane: 1, x: 0, y: 0, vy: 0, speed: 18, tokens: 0, stations: 0, shield: 0, over: false, nextSpawn: 150, t0: performance.now(), bearing: 0 };
    let mapReady = false;
    let started = autoStart.current;
    let goAt = Infinity; // 3-2-1 countdown ends here
    const spawnRow = (r: number) => {
      const free = Math.floor(Math.random() * 3);
      for (let lane = 0; lane < 3; lane++) {
        if (lane === free) continue;
        const q = Math.random();
        const kind: Kind | null = q < 0.25 ? "bus" : q < 0.55 ? "barrier" : q < 0.7 ? "cone" : null;
        if (!kind) continue;
        const mesh = new THREE.Mesh(geo[kind], mats[kind]); mesh.scale.setScalar(SCALE); scene.add(mesh);
        things.push({ s: r, lane, kind, alive: true, mesh, len: kind === "bus" ? 9 : 0.8, h: kind === "barrier" ? 1 : kind === "cone" ? 1.1 : 3 });
      }
      const extra: Kind = Math.random() < 0.06 && state.run > 400 ? "shield" : "token";
      for (let i = 0; i < (extra === "token" ? 6 : 1); i++) {
        const mesh = new THREE.Mesh(geo[extra], mats[extra]); mesh.scale.setScalar(SCALE); scene.add(mesh);
        things.push({ s: r + i * 3.5, lane: free, kind: extra, alive: true, mesh, len: 1, h: 0 });
      }
    };

    // world position of a run-distance + lane, in meters relative to the runner
    const runToLngLat = (r: number, right: number, up = 0) => {
      const { p, dir } = linePos(r);
      const a = at(path, p);
      const e = a.e * dir, n = a.n * dir;
      const [lon, lat] = offset(a.lon, a.lat, e, n, right);
      return { lon, lat, e, n, up };
    };

    const renderPieces = (args: any) => (layer as any).renderPieces_unused(null, args);
    const layer: CustomLayerInterface & Record<string, any> = {
      id: "street-runner", type: "custom", renderingMode: "3d",
      onAdd: (_m, gl) => {
        (layer as any).renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
        (layer as any).renderer.autoClear = false;
      },
      render: (_gl, args: any) => {
        try { renderPieces(args); } catch (err) { if (!(layer as any).warned) { (layer as any).warned = true; console.error("[street-runner layer]", (err as Error).stack); } }
      },
      renderPieces_unused: (_gl: any, args: any) => {
        const me = runToLngLat(state.run, state.x);
        const origin = MercatorCoordinate.fromLngLat([me.lon, me.lat], 0);
        const unit = origin.meterInMercatorCoordinateUnits();
        const local = (lon: number, lat: number) => ({ x: (lon - me.lon) * mLon(lat), z: -(lat - me.lat) * M_LAT });
        const yaw = -Math.atan2(me.e, me.n);
        runner.position.set(0, state.y, 0);
        runner.rotation.y = yaw + Math.PI;
        bubble.visible = state.shield > 0;
        body.position.y = 0.95 + (state.y > 0 ? 0 : Math.abs(Math.sin(state.run * 1.3)) * 0.1);
        for (const t of things) {
          if (!t.alive) continue;
          const w = runToLngLat(t.s, LANES[t.lane]);
          const p = local(w.lon, w.lat);
          t.mesh.position.set(p.x, t.kind === "token" || t.kind === "shield" ? 1.2 * SCALE : (t.h / 2) * SCALE, p.z);
          t.mesh.rotation.y = t.kind === "token" ? state.run * 0.15 : -Math.atan2(w.e, w.n);
        }
        for (const sg of signs) {
          // a sign at the station, beside the route, for whichever direction you're running
          const k = Math.floor((startS + state.run) / L);
          const fw = k % 2 === 0;
          const runS = k * L - startS + (fw ? sg.s : L - sg.s);
          const ahead = runS - state.run;
          sg.mesh.visible = ahead > -30 && ahead < 500;
          if (!sg.mesh.visible) continue;
          const w = runToLngLat(runS, 9);
          const p = local(w.lon, w.lat);
          sg.mesh.position.set(p.x, 9, p.z);
          sg.mesh.rotation.y = -Math.atan2(w.e, w.n);
          sg.mesh.scale.setScalar(1.6);
          if (!sg.counted && ahead < 0 && started) {
            sg.counted = true; state.stations++;
            setFlash(`🚉 ${sg.name} +50`); setTimeout(() => setFlash(null), 1300);
          }
          if (ahead > 40) sg.counted = false;
        }
        const m = new THREE.Matrix4().fromArray(args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix);
        const l = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(unit, -unit, unit)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        camera.projectionMatrix = m.multiply(l);
        const r: THREE.WebGLRenderer = (layer as any).renderer;
        r.resetState(); r.render(scene, camera);
      },
    };
    map.on("load", () => {
      mapReady = true;
      goAt = performance.now() + 3000;
      state.t0 = goAt;
      // a prettier real city: brick and brownstone low-rise, sandstone mid-rise, glass towers
      if (map.getLayer("building-3d")) {
        map.setLayerZoomRange("building-3d", 13, 24);
        map.setPaintProperty("building-3d", "fill-extrusion-color", ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, "#d9906f", 12, "#c97b5f", 22, "#e3c9a3", 45, "#d8d0c4", 80, "#a9c3df", 150, "#7fa6d6"]);
        map.setPaintProperty("building-3d", "fill-extrusion-opacity", 1);
        map.setPaintProperty("building-3d", "fill-extrusion-vertical-gradient", true);
      }
      for (const l of map.getStyle().layers) if (/shield|oneway/.test(l.id)) map.setLayoutProperty(l.id, "visibility", "none");
      try {
        (map as any).setSky({ "sky-color": "#6fb1ff", "horizon-color": "#ffd6a3", "fog-color": "#ffe6c7", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.35, "atmosphere-blend": 0.8 });
      } catch { /* older style spec */ }
      try {
        map.setLight({ anchor: "viewport", color: "#fff4e0", intensity: 0.45, position: [1.4, 210, 35] } as any);
      } catch { /* ignore */ }
      // the line as a real track bed with sleepers and rails, glowing in the line's color
      const below = map.getStyle().layers.find((x) => x.type === "symbol")?.id;
      const W = (a: number, b: number) => ["interpolate", ["exponential", 2], ["zoom"], 15, a, 20, b] as any;
      map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } } as any });
      map.addLayer({ id: "route-glow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": route.color, "line-width": W(8, 150), "line-opacity": 0.35, "line-blur": W(2, 30) } }, below);
      map.addLayer({ id: "route-bed", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#4a4f5c", "line-width": W(5, 110) } }, below);
      map.addLayer({ id: "route-sleepers", type: "line", source: "route", paint: { "line-color": "#7a634c", "line-width": W(4, 96), "line-dasharray": [0.08, 0.32] } }, below);
      for (const off of [-1, 1]) for (const lane of [-36, 0, 36]) {
        map.addLayer({ id: `rail-${off}-${lane}`, type: "line", source: "route", paint: { "line-color": "#e8edf3", "line-width": W(0.4, 3), "line-offset": W((lane + off * 8) / 32, lane + off * 8) } }, below);
      }
      // game pieces (runner, coins, obstacles, station signs) draw on top of everything
      map.addLayer(layer);
    });

    controls.current = {
      left: () => { if (state.lane > 0) state.lane--; },
      right: () => { if (state.lane < 2) state.lane++; },
      jump: () => { if (state.y <= 0.001) state.vy = 10; },
    };
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) controls.current.left();
      else if (["ArrowRight", "d", "D"].includes(e.key)) controls.current.right();
      else if (["ArrowUp", "w", "W", " "].includes(e.key)) controls.current.jump();
      else return;
      e.preventDefault();
    };
    let touch: { x: number; y: number } | null = null;
    const ts = (e: TouchEvent) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
    const te = (e: TouchEvent) => {
      if (!touch) return;
      const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 25) (dx < 0 ? controls.current.left : controls.current.right)();
      else controls.current.jump();
      touch = null;
    };
    window.addEventListener("keydown", onKey);
    el.current.addEventListener("touchstart", ts, { passive: true });
    el.current.addEventListener("touchend", te);
    const host = el.current;

    let raf = 0, last = performance.now(), hudT = 0, streetT = 0, street = "";
    const end = () => {
      state.over = true;
      setPhase("over");
      api.post("/arcade/score", { routeId: line, distance: Math.round(state.run), tokens: state.tokens, stations: state.stations, durationMs: Math.max(1000, Math.round(performance.now() - state.t0)) })
        .then(setResult).catch(() => setResult({ score: Math.round(state.run) + state.tokens * 10 + state.stations * 50 }));
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (started && mapReady && now >= goAt && !state.over) {
        state.speed = Math.min(45, state.speed + dt * 0.7);
        state.run += state.speed * dt;
        state.vy -= 26 * dt;
        state.y = Math.max(0, state.y + state.vy * dt);
        if (state.y === 0) state.vy = Math.max(0, state.vy);
        state.shield = Math.max(0, state.shield - dt);
        while (state.nextSpawn < state.run + 220) { spawnRow(state.nextSpawn); state.nextSpawn += 30 + Math.random() * 16 + state.speed * 0.25; }
        for (const t of things) {
          if (!t.alive) continue;
          if (t.s < state.run - 15) { t.alive = false; scene.remove(t.mesh); continue; }
          if (t.lane !== state.lane || Math.abs(state.x - LANES[t.lane]) > 1.6) continue;
          const dz = Math.abs(t.s - state.run);
          if ((t.kind === "token" || t.kind === "shield") && dz < 1.4) {
            t.alive = false; scene.remove(t.mesh);
            if (t.kind === "token") state.tokens++;
            else { state.shield = 6; setFlash("☕ Coffee shield: 6 s"); setTimeout(() => setFlash(null), 1200); }
          } else if (t.kind !== "token" && t.kind !== "shield" && dz < t.len / 2 + 0.6) {
            if (t.kind !== "bus" && state.y * 1 > t.h * 0.9) continue;
            if (state.shield > 0) { t.alive = false; scene.remove(t.mesh); state.shield = 0; setFlash("Shield used!"); setTimeout(() => setFlash(null), 900); }
            else end();
          }
        }
      }
      state.x += (LANES[state.lane] - state.x) * Math.min(1, dt * 12);
      // camera: behind and above the runner, looking down the real street
      const me = runToLngLat(state.run, 0);
      const target = (Math.atan2(me.e, me.n) * 180) / Math.PI;
      let d = target - state.bearing;
      d = ((d + 540) % 360) - 180;
      state.bearing += d * Math.min(1, dt * 3);
      const [clon, clat] = offset(me.lon, me.lat, me.e, me.n, state.x * 0.5, 22);
      map.jumpTo({ center: [clon, clat], bearing: state.bearing, pitch: 77, zoom: 19.35 });
      map.triggerRepaint();

      streetT += dt;
      if (streetT > 0.8 && map.isStyleLoaded()) {
        streetT = 0;
        const pt = map.project([me.lon, me.lat]);
        const f = map.queryRenderedFeatures([[pt.x - 60, pt.y - 60], [pt.x + 60, pt.y + 60]]).find((x) => x.sourceLayer === "transportation_name" && x.properties?.name);
        if (f) street = String(f.properties!.name);
      }
      hudT += dt;
      if (hudT > 0.1) {
        hudT = 0;
        const k = Math.floor((startS + state.run) / L), fw = k % 2 === 0;
        const nextSt = signs.map((sg) => ({ name: sg.name, ahead: k * L - startS + (fw ? sg.s : L - sg.s) - state.run })).filter((x) => x.ahead > 0).sort((a, b) => a.ahead - b.ahead)[0];
        setHud({ score: Math.round(state.run) + state.tokens * 10 + state.stations * 50, tokens: state.tokens, distance: Math.round(state.run), next: nextSt ? `${nextSt.name} · ${Math.round(nextSt.ahead)} m` : "", street, shield: Math.ceil(state.shield), kmh: Math.round(state.speed * 3.6), count: mapReady && started ? Math.ceil((goAt - performance.now()) / 1000) : 9 });
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      host.removeEventListener("touchstart", ts);
      host.removeEventListener("touchend", te);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, runKey, s.statics]);

  const start = () => {
    autoStart.current = true;
    setResult(null);
    setPhase("playing");
    setRunKey((k) => k + 1);
  };

  return (
    <div className="runner">
      <div ref={el} className="runner-stage" />
      {phase === "playing" && <div className="speedlines" style={{ opacity: Math.max(0, Math.min(0.85, (hud.kmh - 70) / 90)) }} />}
      <div className="runner-top">
        <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        <div className="sr-hud">
          <div className="sr-score">{hud.score.toLocaleString()}</div>
          <div className="sr-row">
            <span key={hud.tokens} className="sr-coins">🪙 {hud.tokens}</span>
            <span className="sr-dist">{hud.distance} m</span>
            {hud.shield > 0 && <span className="sr-shield">☕ {hud.shield}s</span>}
          </div>
          <div className="sr-speed"><i style={{ width: `${Math.min(100, (hud.kmh / 162) * 100)}%` }} /><b>{hud.kmh} km/h</b></div>
        </div>
      </div>
      {phase === "playing" && hud.count > 0 && hud.count <= 3 && <div key={hud.count} className="sr-count">{hud.count}</div>}
      {phase === "playing" && hud.count <= 0 && hud.count > -1 && <div className="sr-count go">GO!</div>}
      {(hud.street || hud.next) && phase === "playing" && (
        <div className="runner-next">{hud.street && <>📍 <b>{hud.street}</b></>}{hud.street && hud.next && " · "}{hud.next && <>Next: <b>{hud.next}</b></>}</div>
      )}
      {flash && <div className="runner-flash">{flash}</div>}
      {phase === "playing" && (
        <div className="runner-pad">
          <button onClick={() => controls.current.left()} aria-label="Left">◀</button>
          <button onClick={() => controls.current.jump()} aria-label="Jump">▲</button>
          <button onClick={() => controls.current.right()} aria-label="Right">▶</button>
        </div>
      )}
      {phase !== "playing" && (
        <div className="runner-card">
          {phase === "ready" ? (
            <>
              <div className="logo" style={{ fontSize: 28 }}>Street <i>Runner</i></div>
              <p className="small muted" style={{ margin: 0 }}>
                Run your T line's real route through the real streets of Boston: real buildings, real street names, real shops. Dodge shuttle buses and DELAY barriers, grab tokens, +50 for every station you pass.
                ← → to switch lanes, ↑ or Space to jump, or swipe.
              </p>
            </>
          ) : (
            <>
              <div className="points-burst" style={{ fontSize: 52 }}>{(result?.score ?? hud.score).toLocaleString()}</div>
              <div className="center">
                {result?.newBest && <span className="tag ok">🏆 New personal best!</span>}{" "}
                {result?.rank && <span className="tag">#{result.rank} on the {route?.short} board</span>}
              </div>
              <div className="center small muted">{hud.distance} m through Boston · {hud.tokens} tokens</div>
            </>
          )}
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {(s.statics?.routes ?? []).map((r) => (
              <button key={r.id} className={`chip ${line === r.id ? "on" : ""}`} onClick={() => { autoStart.current = false; setLine(r.id); setPhase("ready"); }}><LinePill id={r.id} /> {r.short}</button>
            ))}
          </div>
          <button className="btn primary block" onClick={start}>{phase === "ready" ? "▶ Start run" : "↻ Run again"}</button>
          {top && top.players.length > 0 && (
            <div className="col" style={{ gap: 6 }}>
              <b className="small">{route?.short} board</b>
              {top.players.slice(0, 5).map((p: any, i: number) => (
                <div key={i} className="row between small"><span>{i + 1}. {p.name}{p.me ? " (you)" : ""} · {p.school}</span><b>{p.score}</b></div>
              ))}
            </div>
          )}
          <div className="tiny muted">Map © OpenStreetMap contributors, OpenFreeMap. Arcade scores have their own board; school points only come from real check-ins.</div>
        </div>
      )}
    </div>
  );
}
