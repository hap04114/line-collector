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
type Kind = "barrier" | "cone" | "bus" | "train" | "token" | "shield";

/** Real Boston landmarks; a big sign appears beside the run when the route passes near one. */
const LANDMARKS: [string, number, number][] = [
  ["Prudential Center", 42.3471, -71.0825], ["Fenway Park", 42.3467, -71.0972], ["Citgo Sign", 42.3489, -71.0951],
  ["Museum of Fine Arts", 42.3394, -71.094], ["Symphony Hall", 42.3426, -71.0857], ["Copley Square", 42.3499, -71.0774],
  ["Boston Public Library", 42.3493, -71.078], ["State House", 42.3588, -71.0638], ["Boston Common", 42.355, -71.0656],
  ["Faneuil Hall", 42.36, -71.0568], ["TD Garden", 42.3662, -71.0621], ["Zakim Bridge", 42.3687, -71.0612],
  ["MIT Great Dome", 42.3597, -71.0921], ["Harvard Yard", 42.3744, -71.1169], ["Kendall Square", 42.3625, -71.0862],
  ["Chinatown Gate", 42.3509, -71.0605], ["New England Aquarium", 42.3592, -71.049], ["South Station", 42.3523, -71.0552],
  ["Christian Science Center", 42.3445, -71.0853], ["Northeastern University", 42.3398, -71.0892], ["Boston University", 42.3505, -71.1054],
  ["Longfellow Bridge", 42.3617, -71.0758], ["Old State House", 42.3587, -71.0575], ["Arnold Arboretum", 42.2995, -71.1159],
  ["Boston College", 42.3355, -71.1685], ["Tufts University", 42.4075, -71.119], ["JFK Library", 42.3164, -71.0342], ["Logan Airport", 42.3656, -71.0096],
];

function trainTexture(color: string) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = color; g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#fff"; g.fillRect(0, 86, 256, 10);
  g.fillStyle = "#1b2433";
  for (let x = 10; x < 256; x += 42) { g.fillRect(x, 26, 30, 40); }
  g.fillStyle = "#ffe9a8";
  for (let x = 14; x < 256; x += 42) { g.fillRect(x, 30, 22, 14); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
interface Thing { s: number; lane: number; kind: Kind; alive: boolean; mesh: THREE.Object3D; len: number; h: number; v?: number }

const canvasTex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

/** The cab end of a T car: windshield, amber destination sign, headlights, in the line's color. */
function trainFront(color: string, dest: string) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 320;
  const g = c.getContext("2d")!;
  g.fillStyle = color; g.fillRect(0, 0, 256, 320);
  g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(0, 0, 256, 18);
  // destination sign
  g.fillStyle = "#101010"; g.beginPath(); g.roundRect(34, 26, 188, 34, 6); g.fill();
  g.fillStyle = "#ffb627"; let size = 22; g.font = `800 ${size}px Inter, system-ui, sans-serif`;
  while (g.measureText(dest).width > 176 && size > 10) { size -= 1; g.font = `800 ${size}px Inter, system-ui, sans-serif`; }
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(dest, 128, 44);
  // windshield, split in two with a door window
  g.fillStyle = "#1b2433";
  g.beginPath(); g.roundRect(18, 72, 70, 92, 8); g.fill();
  g.beginPath(); g.roundRect(98, 72, 60, 110, 6); g.fill();
  g.beginPath(); g.roundRect(168, 72, 70, 92, 8); g.fill();
  g.fillStyle = "rgba(160,200,255,.25)"; g.fillRect(24, 78, 22, 80); g.fillRect(174, 78, 22, 80);
  // white band, headlights, coupler
  g.fillStyle = "#f4f4f4"; g.fillRect(0, 214, 256, 14);
  for (const x of [46, 210]) {
    g.fillStyle = "#fff9e0"; g.beginPath(); g.arc(x, 252, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,235,160,.6)"; g.beginPath(); g.arc(x, 252, 22, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = "#2a2a2a"; g.fillRect(96, 276, 64, 30);
  return canvasTex(c);
}

/** A blue station information board with a strip map of the line: previous stop, you are here, next stop. */
function stationBoard(name: string, prev: string, next: string, color: string, lineName: string) {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 320;
  const g = c.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, 0, 320); bg.addColorStop(0, "#1d4a8f"); bg.addColorStop(1, "#13305e");
  g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, 632, 312, 18); g.fill();
  g.lineWidth = 6; g.strokeStyle = "#0b1220"; g.stroke();
  // diagonal stripes in the line color, top right
  g.save(); g.beginPath(); g.roundRect(4, 4, 632, 312, 18); g.clip();
  for (let i = 0; i < 3; i++) { g.fillStyle = i === 1 ? "#ffffff" : color; g.beginPath(); g.moveTo(520 + i * 26, 4); g.lineTo(546 + i * 26, 4); g.lineTo(446 + i * 26, 120); g.lineTo(420 + i * 26, 120); g.fill(); }
  g.restore();
  const fit = (text: string, max: number, start: number, weight = 800) => { let s = start; g.font = `${weight} ${s}px Inter, system-ui, sans-serif`; while (g.measureText(text).width > max && s > 12) { s -= 2; g.font = `${weight} ${s}px Inter, system-ui, sans-serif`; } };
  g.fillStyle = "#fff"; g.textBaseline = "alphabetic"; g.textAlign = "left";
  fit(name, 420, 46); g.fillText(name, 30, 66);
  g.fillStyle = "#b9cdf0"; fit(`${lineName} · Boston`, 420, 22, 600); g.fillText(`${lineName} · Boston`, 30, 98);
  // strip map
  const y = 196;
  g.strokeStyle = color; g.lineWidth = 14; g.lineCap = "round"; g.beginPath(); g.moveTo(70, y); g.lineTo(570, y); g.stroke();
  const stop = (x: number, label: string, here: boolean) => {
    g.fillStyle = here ? "#fff" : "#13305e"; g.strokeStyle = here ? color : "#fff"; g.lineWidth = here ? 10 : 6;
    g.beginPath(); g.arc(x, y, here ? 22 : 14, 0, Math.PI * 2); g.fill(); g.stroke();
    if (!label) return;
    g.fillStyle = here ? "#ffd84a" : "#dfe8f7"; g.textAlign = "center";
    fit(label, 190, here ? 24 : 20, here ? 800 : 600); g.fillText(label, x, y + (here ? 56 : 48));
  };
  stop(110, prev, false); stop(530, next, false); stop(320, "YOU ARE HERE", true);
  g.fillStyle = "#9fb6dd"; g.font = "600 18px Inter, system-ui, sans-serif"; g.textAlign = "right"; g.fillText("Live times in the app", 610, 300);
  return canvasTex(c);
}

/** Gravel track ballast as a repeating map pattern. */
function ballastImage() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#77716a"; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 420; i++) {
    const v = 90 + Math.floor(Math.random() * 90);
    g.fillStyle = `rgb(${v},${v - 6},${v - 12})`;
    g.beginPath(); g.ellipse(Math.random() * 64, Math.random() * 64, 1 + Math.random() * 2.2, 0.8 + Math.random() * 1.6, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
  return g.getImageData(0, 0, 64, 64);
}

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
  const [look, setLook] = useState<"real" | "color">(() => {
    try {
      return (localStorage.getItem("lc-runner-look") as "real" | "color") || "real";
    } catch {
      return "real";
    }
  });
  const [line, setLine] = useState(() => s.stationById.get(homeStations[0] ?? "")?.routes[0] ?? "Green-B");
  const [phase, setPhase] = useState<"ready" | "playing" | "over">("ready");
  const [runKey, setRunKey] = useState(0);
  const autoStart = useRef(false);
  const [hud, setHud] = useState({ score: 0, tokens: 0, distance: 0, next: "", street: "", shield: 0, bike: 0, bikeCd: 0, kmh: 0, count: 0, clock: "", eta: "" });
  const [flash, setFlash] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [top, setTop] = useState<any>(null);
  const el = useRef<HTMLDivElement>(null);
  const controls = useRef({ left: () => {}, right: () => {}, jump: () => {}, bike: () => {} });
  const cr = s.statics?.commuter;
  const route = s.routeById.get(line) ?? cr?.routes.find((r) => r.id === line);

  useEffect(() => { api.get(`/arcade/top?line=${line}`).then(setTop).catch(() => {}); }, [line, result]);

  useEffect(() => {
    if (!el.current || !route || !s.statics) return;
    // the line's longest real shape, oriented to start near your home station
    const shapes = [...s.statics.shapes.features, ...(cr?.shapes.features ?? [])].filter((f: any) => f.properties.routeId === line);
    let coords: [number, number][] = shapes.reduce((a: any, f: any) => (f.geometry.coordinates.length > a.length ? f.geometry.coordinates : a), []);
    let path = buildPath(coords);
    const stations = route.stopIds.map((id) => s.stationById.get(id) ?? cr?.stations.find((x) => x.id === id)!).filter(Boolean);
    const first = project(path, stations[0].lon, stations[0].lat);
    if (first.s > path.len / 2) { coords = [...coords].reverse(); path = buildPath(coords); }
    const stops = stations.map((st) => ({ name: st.name, ...project(path, st.lon, st.lat) })).filter((x) => x.d < 400).sort((a, b) => a.s - b.s);
    const home = stops.find((x) => stations.find((st) => st.name === x.name && homeStations.includes(st.id)));
    // Commuter Rail starts at a downtown terminal; begin ~300 m out so you are not inside the train shed
    const startS = Math.max(0, (home?.s ?? (line.startsWith("CR-") ? 380 : 0)) - 80);
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

    // ---- the runner: a big cartoon student with a real run cycle, and a blue bike power-up ----
    // local axes: +y up, +z is the direction of travel (the camera sees the runner's back)
    const RSCALE = 4.6;
    const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
    const skin = mat(0xf2c9a0), shirt = mat(schoolColor), pants = mat(0x2b3a55), shoeMat = mat(0xffffff), soleMat = mat(lineColor), capMat = mat(lineColor), hairMat = mat(0x3b2a20), packMat = mat(0xff8a3d), packPocket = mat(0xffb36b);
    // a capsule hanging down from its pivot, for arms and legs
    const limb = (r: number, len: number, m: THREE.Material) => { const g = new THREE.CapsuleGeometry(r, len, 4, 10); g.translate(0, -len / 2 - r * 0.4, 0); return new THREE.Mesh(g, m); };
    const runner = new THREE.Group();
    const rig = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.55, 6, 14), shirt); torso.position.y = 1.42; torso.scale.set(1.12, 1, 0.82);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), skin); head.position.set(0, 2.18, 0.03);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 16), hairMat); hair.position.set(0, 2.16, -0.04);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.37, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat); cap.position.y = 2.24;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.32), capMat); brim.position.set(0, 2.26, 0.4);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.66, 0.3), packMat); pack.position.set(0, 1.5, -0.38);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.08), packPocket); pocket.position.set(0, 1.34, -0.56);
    const mkArm = (side: number) => {
      const g = new THREE.Group(); g.position.set(side * 0.5, 1.8, 0);
      const sleeve = limb(0.15, 0.16, shirt);
      const arm = limb(0.11, 0.52, skin);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin); hand.position.y = -0.76;
      g.add(arm, sleeve, hand); return g;
    };
    const mkLeg = (side: number) => {
      const g = new THREE.Group(); g.position.set(side * 0.2, 1.02, 0);
      const leg = limb(0.15, 0.62, pants);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.17, 0.46), shoeMat); shoe.position.set(0, -0.92, 0.08);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.48), soleMat); sole.position.set(0, -1.0, 0.08);
      g.add(leg, shoe, sole); return g;
    };
    const armL = mkArm(-1), armR = mkArm(1), legL = mkLeg(-1), legR = mkLeg(1);
    rig.add(torso, hair, head, cap, brim, pack, pocket, armL, armR, legL, legR);

    // the blue bike (generic, unbranded): two spinning wheels, a frame, a saddle and handlebars
    const blue = mat(0x1e7bff, { metalness: 0.35, roughness: 0.3, emissive: 0x0a2a66, emissiveIntensity: 0.35 });
    const tire = mat(0x1a1a1a), chrome = mat(0xdfe6ee, { metalness: 0.85, roughness: 0.2 });
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) => {
      const d = b.clone().sub(a);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), m);
      t.position.copy(a).add(b).multiplyScalar(0.5);
      t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      return t;
    };
    const bike = new THREE.Group(); bike.visible = false;
    const wheels: THREE.Group[] = [];
    for (const z of [-0.8, 0.8]) {
      const w = new THREE.Group(); w.position.set(0, 0.58, z);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.075, 10, 32), tire); rim.rotation.y = Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.025, 6, 28), blue); ring.rotation.y = Math.PI / 2;
      w.add(rim, ring);
      for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.9, 0.025), chrome); sp.rotation.x = (i * Math.PI) / 4; w.add(sp); }
      wheels.push(w); bike.add(w);
    }
    const P = (y: number, z: number, x = 0) => new THREE.Vector3(x, y, z);
    const R = P(0.58, -0.8), F = P(0.58, 0.8), B = P(0.5, -0.05), S = P(1.22, -0.36), H = P(1.2, 0.56), BAR = P(1.48, 0.64);
    bike.add(tube(R, B, 0.05, blue), tube(R, S, 0.045, blue), tube(B, S, 0.065, blue), tube(B, H, 0.075, blue), tube(S, H, 0.06, blue), tube(H, F, 0.05, chrome), tube(H, BAR, 0.05, chrome), tube(P(1.48, 0.64, -0.42), P(1.48, 0.64, 0.42), 0.04, chrome));
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.4), mat(0x222222)); saddle.position.set(0, 1.3, -0.4);
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.36), mat(0x1e7bff, { transparent: true, opacity: 0.85 })); basket.position.set(0, 1.42, 0.95);
    // parts that read from behind (the camera mostly sees the bike's back): fat fenders, a rack bag, a tail light
    const fenderGeo = new THREE.CylinderGeometry(0.64, 0.64, 0.32, 20, 1, true, -Math.PI * 0.05, Math.PI * 0.65); fenderGeo.rotateZ(Math.PI / 2);
    const fenderMat = mat(0x1e7bff, { metalness: 0.35, roughness: 0.3, emissive: 0x0a2a66, emissiveIntensity: 0.35, side: THREE.DoubleSide });
    const rearFender = new THREE.Mesh(fenderGeo, fenderMat); rearFender.position.set(0, 0.58, -0.8); rearFender.rotation.x = Math.PI * 0.95;
    const frontFender = new THREE.Mesh(fenderGeo, fenderMat); frontFender.position.set(0, 0.58, 0.8); frontFender.rotation.x = -Math.PI * 0.25;
    const rackBag = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.55), blue); rackBag.position.set(0, 1.0, -0.88);
    const rackStripe = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.07, 0.57), mat(0xffffff)); rackStripe.position.set(0, 1.02, -0.88);
    const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0xff3b3b })); tailLight.position.set(0, 0.92, -1.17);
    const trail = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 8), new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
    trail.rotation.x = -Math.PI / 2; trail.position.set(0, 0.06, -5.2);
    bike.add(saddle, basket, rearFender, frontFender, rackBag, rackStripe, tailLight, trail);

    const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.65, 24, 16), new THREE.MeshBasicMaterial({ color: 0x7ad7ff, transparent: true, opacity: 0.25, depthWrite: false }));
    bubble.position.y = 1.3; bubble.visible = false;
    runner.add(rig, bike, bubble);
    runner.scale.setScalar(RSCALE);
    scene.add(runner);
    // soft round shadow on the street that shrinks while you're in the air
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 28), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.08;
    scene.add(shadow);

    const geo = { barrier: new THREE.BoxGeometry(2.4, 1, 0.4), cone: new THREE.ConeGeometry(0.5, 1.1, 14), bus: new THREE.BoxGeometry(2.4, 3, 9), train: new THREE.BoxGeometry(2.8, 3.4, 22), token: new THREE.CylinderGeometry(0.5, 0.5, 0.12, 24), shield: new THREE.SphereGeometry(0.5, 16, 12) };
    geo.token.rotateX(Math.PI / 2);
    for (const g of Object.values(geo)) g.translate(0, 0, 0);
    const mats = {
      barrier: new THREE.MeshStandardMaterial({ map: label("DELAY", "#ff5a5f") }),
      cone: new THREE.MeshStandardMaterial({ color: 0xff7a00 }),
      bus: new THREE.MeshStandardMaterial({ color: 0xffd23f }),
      // box faces: +x, -x sides; +y roof, -y floor; +z, -z cab ends
      train: (() => {
        const side = new THREE.MeshStandardMaterial({ map: trainTexture(route.color), emissive: 0x222222, roughness: 0.4, metalness: 0.2 });
        const roof = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.5, metalness: 0.4 });
        const cab = new THREE.MeshStandardMaterial({ map: trainFront(route.color, stops[stops.length - 1]?.name ?? route.short), emissive: 0x222222, roughness: 0.35, metalness: 0.2 });
        return [side, side, roof, roof, cab, cab];
      })(),
      token: new THREE.MeshStandardMaterial({ color: 0xffd84a, emissive: 0xc79100, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.25 }),
      shield: new THREE.MeshStandardMaterial({ color: 0x7ad7ff, emissive: 0x1a5070 }),
    };
    // headlight glow and the light they throw on the track, added to every train (box is 2.8 × 3.4 × 22, +z faces you)
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const headlights: THREE.Object3D[] = [];
    for (const x of [-0.92, 0.92]) {
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), glowMat); glow.position.set(x, -1.02, 11.03); headlights.push(glow);
    }
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 12), beamMat); beam.rotation.x = -Math.PI / 2; beam.position.set(0, -1.66, 17); headlights.push(beam);
    const things: Thing[] = [];
    const signs: { s: number; mesh: THREE.Mesh; name: string; counted: boolean }[] = [];
    for (let i = 0; i < stops.length; i++) {
      const st = stops[i];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: stationBoard(st.name, stops[i - 1]?.name ?? "", stops[i + 1]?.name ?? "", route.color, route.name), side: THREE.DoubleSide, transparent: true }));
      scene.add(m);
      signs.push({ s: st.s, mesh: m, name: st.name, counted: false });
    }

    const marks: { s: number; side: number; mesh: THREE.Mesh; name: string; shown: boolean }[] = [];
    for (const [name, lat, lon] of LANDMARKS) {
      const pr = project(path, lon, lat);
      if (pr.d > 500) continue;
      const a = at(path, pr.s);
      const dx = (lon - a.lon) * mLon(lat), dy = (lat - a.lat) * M_LAT;
      const side = dx * a.n - dy * a.e >= 0 ? 1 : -1; // right of travel (forward direction) is +1
      const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.6), new THREE.MeshBasicMaterial({ map: label(`📍 ${name}`, "#F7DD04", "#0b1220"), side: THREE.DoubleSide, transparent: true }));
      scene.add(m);
      marks.push({ s: pr.s, side, mesh: m, name, shown: false });
    }

    const state = { run: 0, lane: 1, x: 0, y: 0, vy: 0, speed: 18, tokens: 0, stations: 0, shield: 0, bike: 0, bikeCd: 0, over: false, nextSpawn: 150, t0: performance.now(), bearing: 0 };
    let mapReady = false;
    let started = autoStart.current;
    let goAt = Infinity; // 3-2-1 countdown ends here
    // fairness: an oncoming train sweeps back over rows already placed, so it may only use a lane that no
    // upcoming row leaves free, and new rows keep their free lane off any lane an oncoming train is in
    const rows: { s: number; free: number }[] = [];
    const oncomingLanes = () => new Set(things.filter((t) => t.alive && t.v).map((t) => t.lane));
    const spawnRow = (r: number) => {
      const busy = oncomingLanes();
      const options = [0, 1, 2].filter((l) => !busy.has(l));
      const free = options.length ? options[Math.floor(Math.random() * options.length)] : Math.floor(Math.random() * 3);
      rows.push({ s: r, free });
      while (rows.length && rows[0].s < state.run - 20) rows.shift();
      for (let lane = 0; lane < 3; lane++) {
        if (lane === free) continue;
        const q = Math.random();
        const kind: Kind | null = q < 0.2 ? "train" : q < 0.32 ? "bus" : q < 0.6 ? "barrier" : q < 0.72 ? "cone" : null;
        if (!kind) continue;
        const mesh = new THREE.Mesh(geo[kind], mats[kind]); mesh.scale.setScalar(SCALE); scene.add(mesh);
        // some trains are coming at you, headlights on
        let v = 0;
        if (kind === "train") {
          mesh.add(...headlights.map((h) => h.clone()));
          const laneIsSomeonesExit = rows.some((rw) => rw.s > state.run - 5 && rw.free === lane);
          if (Math.random() < 0.45 && state.run > 150 && !laneIsSomeonesExit) v = 9;
        }
        things.push({ s: r + (v ? 60 : 0), lane, kind, alive: true, mesh, v, len: kind === "train" ? 22 : kind === "bus" ? 9 : 0.8, h: kind === "barrier" ? 1 : kind === "cone" ? 1.1 : kind === "train" ? 3.4 : 3 });
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
        // pose: run cycle, pedaling on the bike, or a tuck in the air
        const onBike = state.bike > 0;
        const air = state.y > 0.05;
        const ph = state.run * (onBike ? 0.38 : 0.45);
        const sw = Math.sin(ph);
        bike.visible = onBike;
        shadow.scale.setScalar(RSCALE * (onBike ? 1.5 : 1) * Math.max(0.45, 1 - state.y / 14));
        if (onBike) {
          for (const w of wheels) w.rotation.x = state.run / (0.58 * RSCALE);
          rig.position.set(0, 0.34 + (air ? 0 : Math.abs(sw) * 0.03), 0);
          rig.rotation.x = 0.28;
          legL.rotation.x = -1.0 + sw * 0.55; legR.rotation.x = -1.0 - sw * 0.55;
          armL.rotation.x = armR.rotation.x = -1.05;
          armL.rotation.z = 0.12; armR.rotation.z = -0.12;
          trail.scale.y = 0.8 + Math.abs(Math.sin(state.run * 0.9)) * 0.4;
        } else if (air) {
          rig.position.set(0, 0, 0); rig.rotation.x = 0.12;
          legL.rotation.x = -0.9; legR.rotation.x = 0.5;
          armL.rotation.x = -2.6; armR.rotation.x = -2.3;
          armL.rotation.z = -0.25; armR.rotation.z = 0.25;
        } else {
          rig.position.set(0, Math.abs(Math.cos(ph)) * 0.13, 0); rig.rotation.x = started ? 0.16 : 0;
          legL.rotation.x = sw * 0.95; legR.rotation.x = -sw * 0.95;
          armL.rotation.x = -sw * 0.85; armR.rotation.x = sw * 0.85;
          armL.rotation.z = -0.08; armR.rotation.z = 0.08;
        }
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
        for (const mk of marks) {
          const k = Math.floor((startS + state.run) / L);
          const fw = k % 2 === 0;
          const runS = k * L - startS + (fw ? mk.s : L - mk.s);
          const ahead = runS - state.run;
          mk.mesh.visible = ahead > -40 && ahead < 650;
          if (!mk.mesh.visible) continue;
          const w = runToLngLat(runS, (fw ? mk.side : -mk.side) * 24);
          const p = local(w.lon, w.lat);
          mk.mesh.position.set(p.x, 20, p.z);
          mk.mesh.rotation.y = -Math.atan2(w.e, w.n);
          mk.mesh.scale.setScalar(2.2);
          if (!mk.shown && ahead < 120 && started) {
            mk.shown = true;
            setFlash(`📍 ${mk.name}`); setTimeout(() => setFlash(null), 1400);
          }
          if (ahead > 200) mk.shown = false;
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
        const h = ["coalesce", ["get", "render_height"], 8];
        const pick = ["%", ["floor", ["+", ["*", h, 3.7], ["*", ["coalesce", ["get", "render_min_height"], 0], 1.3]]], 4];
        const realColor = [
          "case",
          // a real building colour from OpenStreetMap wins when it's tagged
          ["has", "colour"], ["to-color", ["get", "colour"], "#b9ab98"],
          // glass and steel towers
          [">", h, 45], ["match", pick, 0, "#7f93a8", 1, "#8a9bb0", 2, "#6e8299", "#93a5b8"],
          // limestone, concrete and brownstone mid-rise
          [">", h, 16], ["match", pick, 0, "#c8bba6", 1, "#b9ad9a", 2, "#a49d93", "#8f6f5a"],
          // Boston brick and brownstone row houses
          ["match", pick, 0, "#9c5b45", 1, "#a8674f", 2, "#8b5040", "#b58466"],
        ];
        const candy = [
          "case", [">", h, 70], ["interpolate", ["linear"], h, 70, "#9fd3ff", 200, "#5aa8ff"],
          ["match", ["%", ["floor", ["+", ["*", h, 3.7], ["*", ["coalesce", ["get", "render_min_height"], 0], 1.3]]], 8],
            0, "#ff9ebb", 1, "#ffd166", 2, "#7fe0d0", 3, "#9ccfff", 4, "#ffb38a", 5, "#c7b3ff", 6, "#b9f28c", 7, "#ffe08a", "#ffc4d6"],
        ];
        map.setPaintProperty("building-3d", "fill-extrusion-color", (look === "real" ? realColor : candy) as any);
        map.setPaintProperty("building-3d", "fill-extrusion-opacity", 1);
        map.setPaintProperty("building-3d", "fill-extrusion-vertical-gradient", true);
      }
      for (const l of map.getStyle().layers) if (/shield|oneway/.test(l.id)) map.setLayoutProperty(l.id, "visibility", "none");
      try {
        (map as any).setSky(look === "real"
          ? { "sky-color": "#8fbde8", "horizon-color": "#e4ecf3", "fog-color": "#e9eef3", "sky-horizon-blend": 0.7, "horizon-fog-blend": 0.75, "fog-ground-blend": 0.5, "atmosphere-blend": 0.6 }
          : { "sky-color": "#6fb1ff", "horizon-color": "#ffd6a3", "fog-color": "#ffe6c7", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.35, "atmosphere-blend": 0.8 });
      } catch { /* older style spec */ }
      try {
        map.setLight({ anchor: "viewport", color: look === "real" ? "#ffffff" : "#fff4e0", intensity: look === "real" ? 0.32 : 0.45, position: [1.2, 220, 32] } as any);
      } catch { /* ignore */ }
      // the line as a real track bed with sleepers and rails, glowing in the line's color
      const below = map.getStyle().layers.find((x) => x.type === "symbol")?.id;
      const W = (a: number, b: number) => ["interpolate", ["exponential", 2], ["zoom"], 15, a, 20, b] as any;
      map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } } as any });
      map.addLayer({ id: "route-glow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": route.color, "line-width": W(8, 150), "line-opacity": look === "real" ? 0.18 : 0.35, "line-blur": W(2, 30) } }, below);
      if (!map.hasImage("ballast")) map.addImage("ballast", ballastImage());
      map.addLayer({ id: "route-bed", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: look === "real" ? { "line-pattern": "ballast", "line-width": W(5, 110) } : { "line-color": "#4a4f5c", "line-width": W(5, 110) } }, below);
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
      // 🚲 blue bike: 8 s, 30% faster, one crash just knocks you off the bike; 20 s cooldown
      bike: () => {
        if (!started || state.over || performance.now() < goAt || state.bike > 0 || state.bikeCd > 0) return;
        state.bike = 8; state.bikeCd = 20;
        setFlash("🚲 Blue bike! 8 s"); setTimeout(() => setFlash(null), 1200);
      },
    };
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) controls.current.left();
      else if (["ArrowRight", "d", "D"].includes(e.key)) controls.current.right();
      else if (["ArrowUp", "w", "W", " "].includes(e.key)) controls.current.jump();
      else if (["b", "B"].includes(e.key)) controls.current.bike();
      else return;
      e.preventDefault();
    };
    let touch: { x: number; y: number } | null = null;
    let lastTap = 0;
    const ts = (e: TouchEvent) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
    const te = (e: TouchEvent) => {
      if (!touch) return;
      const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 25) (dx < 0 ? controls.current.left : controls.current.right)();
      else {
        controls.current.jump();
        // a double-tap hops on the bike
        const now = performance.now();
        if (Math.abs(dx) < 15 && Math.abs(dy) < 15 && now - lastTap < 320) controls.current.bike();
        lastTap = now;
      }
      touch = null;
    };
    const dbl = (e: MouseEvent) => { e.preventDefault(); controls.current.bike(); };
    window.addEventListener("keydown", onKey);
    el.current.addEventListener("touchstart", ts, { passive: true });
    el.current.addEventListener("touchend", te);
    el.current.addEventListener("dblclick", dbl);
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
        state.run += state.speed * (state.bike > 0 ? 1.3 : 1) * dt;
        if (state.bike > 0 && state.bike - dt <= 0) { setFlash("🚲 Bike docked, keep running!"); setTimeout(() => setFlash(null), 1100); }
        state.bike = Math.max(0, state.bike - dt);
        state.bikeCd = Math.max(0, state.bikeCd - dt);
        state.vy -= 26 * dt;
        state.y = Math.max(0, state.y + state.vy * dt);
        if (state.y === 0) state.vy = Math.max(0, state.vy);
        state.shield = Math.max(0, state.shield - dt);
        while (state.nextSpawn < state.run + 220) { spawnRow(state.nextSpawn); state.nextSpawn += 30 + Math.random() * 16 + state.speed * 0.25; }
        for (const t of things) {
          if (!t.alive) continue;
          if (t.v) t.s -= t.v * dt;
          if (t.s < state.run - 15) { t.alive = false; scene.remove(t.mesh); continue; }
          if (t.lane !== state.lane || Math.abs(state.x - LANES[t.lane]) > 1.6) continue;
          const dz = Math.abs(t.s - state.run);
          if ((t.kind === "token" || t.kind === "shield") && dz < 1.4) {
            t.alive = false; scene.remove(t.mesh);
            if (t.kind === "token") state.tokens++;
            else { state.shield = 6; setFlash("☕ Coffee shield: 6 s"); setTimeout(() => setFlash(null), 1200); }
          } else if (t.kind !== "token" && t.kind !== "shield" && dz < t.len / 2 + 0.6) {
            if (t.kind !== "bus" && t.kind !== "train" && state.y * 1 > t.h * 0.9) continue;
            if (state.shield > 0) { t.alive = false; scene.remove(t.mesh); state.shield = 0; setFlash("Shield used!"); setTimeout(() => setFlash(null), 900); }
            else if (state.bike > 0) { t.alive = false; scene.remove(t.mesh); state.bike = 0; state.vy = 7; setFlash("💥 Off the bike! Keep running"); setTimeout(() => setFlash(null), 1100); }
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
        setHud({ score: Math.round(state.run) + state.tokens * 10 + state.stations * 50, tokens: state.tokens, distance: Math.round(state.run), next: nextSt ? `${nextSt.name} · ${Math.round(nextSt.ahead)} m` : "", street,
          clock: new Date().toLocaleTimeString("en-GB", { hour12: false }),
          eta: nextSt ? new Date(Date.now() + (nextSt.ahead / Math.max(1, state.speed * (state.bike > 0 ? 1.3 : 1))) * 1000).toLocaleTimeString("en-GB", { hour12: false }) : "", shield: Math.ceil(state.shield), bike: Math.ceil(state.bike), bikeCd: state.bike > 0 ? 0 : Math.ceil(state.bikeCd), kmh: Math.round(state.speed * (state.bike > 0 ? 1.3 : 1) * 3.6), count: mapReady && started ? Math.ceil((goAt - performance.now()) / 1000) : 9 });
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      host.removeEventListener("touchstart", ts);
      host.removeEventListener("touchend", te);
      host.removeEventListener("dblclick", dbl);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, runKey, s.statics, look]);

  const start = () => {
    autoStart.current = true;
    setResult(null);
    setPhase("playing");
    setRunKey((k) => k + 1);
  };

  return (
    <div className="runner">
      <div ref={el} className="runner-stage" />
      {phase === "playing" && <div className={`speedlines${hud.bike > 0 ? " bike" : ""}`} style={{ opacity: hud.bike > 0 ? 0.9 : Math.max(0, Math.min(0.85, (hud.kmh - 70) / 90)) }} />}
      <div className="runner-top">
        <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        <div className="sr-hud">
          <div className="sr-score">{hud.score.toLocaleString()}</div>
          <div className="sr-row">
            <span key={hud.tokens} className="sr-coins">🪙 {hud.tokens}</span>
            <span className="sr-dist">{hud.distance} m</span>
            {hud.shield > 0 && <span className="sr-shield">☕ {hud.shield}s</span>}
            {hud.bike > 0 && <span key={`b${hud.bike}`} className="sr-bike">🚲 {hud.bike}s</span>}
          </div>
          <div className="sr-speed"><i style={{ width: `${Math.min(100, (hud.kmh / 162) * 100)}%` }} /><b>{hud.kmh} km/h</b></div>
          {phase === "playing" && hud.count <= 0 && hud.bike <= 0 && hud.bikeCd <= 0 && <div className="sr-hint">Double-click for a 🚲 blue bike</div>}
        </div>
      </div>
      {phase === "playing" && hud.count > 0 && hud.count <= 3 && <div key={hud.count} className="sr-count">{hud.count}</div>}
      {phase === "playing" && hud.count <= 0 && hud.count > -1 && <div className="sr-count go">GO!</div>}
      {(hud.street || hud.next) && phase === "playing" && (
        <div className="runner-next">{hud.street && <>📍 <b>{hud.street}</b></>}{hud.street && hud.next && " · "}{hud.next && <>Next: <b>{hud.next}</b></>}{hud.eta && <span className="sr-eta"> 🕒 arr {hud.eta}</span>}</div>
      )}
      {flash && <div className="runner-flash">{flash}</div>}
      {phase === "playing" && hud.clock && <div className="sr-clock">{hud.clock}</div>}
      {phase === "playing" && (
        <div className="runner-pad">
          <button onClick={() => controls.current.left()} aria-label="Left">◀</button>
          <button onClick={() => controls.current.jump()} aria-label="Jump">▲</button>
          <button onClick={() => controls.current.right()} aria-label="Right">▶</button>
          <button className={`bike-btn${hud.bike > 0 ? " on" : hud.bikeCd > 0 ? " cool" : ""}`} onClick={() => controls.current.bike()} aria-label="Blue bike">
            🚲{hud.bikeCd > 0 && hud.bike <= 0 && <small>{hud.bikeCd}</small>}
          </button>
        </div>
      )}
      {phase !== "playing" && (
        <div className="runner-card">
          {phase === "ready" ? (
            <>
              <div className="logo" style={{ fontSize: 28 }}>Street <i>Runner</i></div>
              <p className="small muted" style={{ margin: 0 }}>
                Run your T line's real route through the real streets of Boston: real buildings, real street names, real shops. Dodge shuttle buses and DELAY barriers, grab tokens, +50 for every station you pass.
                ← → to switch lanes, ↑ or Space to jump, or swipe. Double-click (double-tap, or B) to hop on a 🚲 blue bike: 30% faster, and a crash only knocks you off the bike.
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
          <div className="seg" style={{ padding: 3 }}>
            {(["real", "color"] as const).map((v) => (
              <button key={v} className={look === v ? "on" : ""} onClick={() => { autoStart.current = false; setLook(v); setPhase("ready"); try { localStorage.setItem("lc-runner-look", v); } catch { /* ignore */ } }}>
                {v === "real" ? "🏙️ Real city" : "🍬 Colorful"}
              </button>
            ))}
          </div>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {(s.statics?.routes ?? []).map((r) => (
              <button key={r.id} className={`chip ${line === r.id ? "on" : ""}`} onClick={() => { autoStart.current = false; setLine(r.id); setPhase("ready"); }}><LinePill id={r.id} /> {r.short}</button>
            ))}
          </div>
          {!!cr?.routes.length && (
            <>
              <b className="small" style={{ marginBottom: -4 }}>🚆 Commuter Rail</b>
              <div className="chips cr-chips" style={{ flexWrap: "wrap" }}>
                {cr.routes.map((r) => (
                  <button key={r.id} className={`chip ${line === r.id ? "on" : ""}`} onClick={() => { autoStart.current = false; setLine(r.id); setPhase("ready"); }}><span className="line-pill" style={{ background: "#80276C" }}>CR</span> {r.short}</button>
                ))}
              </div>
            </>
          )}
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
