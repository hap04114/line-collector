/**
 * Real-city corridors for Line Runner.
 * For each T line, walks its real MBTA shape every 20 m and samples the real Boston building
 * massing on both sides (OSM footprints + heights, baked by our team's T-Field pipeline into
 * character.png: 25 m grid in EPSG:26986, R = coverage, G = median height, B = 90th-pct height).
 * Stations are placed at their real distance along the line, and landmarks near the line get signs.
 *
 *   npm run bake:runner -- [path to t-field/web/public/data]
 * Output: web/public/runner/<route>.json (committed, so the app has no runtime dependency).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { DATA_DIR, ROOT } from "./lib.js";

const SRC = resolve(process.argv[2] || resolve(ROOT, "../t-field/web/public/data"));
const OUT = resolve(ROOT, "web/public/runner");
const STEP = 20;
const OFFSETS = [16, 40, 70];

// ---- EPSG:26986 (NAD83 / Massachusetts Mainland), Lambert Conformal Conic 2SP on GRS80 ----
const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f);
const rad = (d: number) => (d * Math.PI) / 180;
const m = (p: number) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
const t = (p: number) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - e * Math.sin(p)) / (1 + e * Math.sin(p)), e / 2);
const p1 = rad(42 + 41 / 60), p2 = rad(41 + 43 / 60), p0 = rad(41), l0 = rad(-71.5);
const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
const F = m(p1) / (n * Math.pow(t(p1), n));
const rho0 = a * F * Math.pow(t(p0), n);
export function toMA(lon: number, lat: number): [number, number] {
  const rho = a * F * Math.pow(t(rad(lat)), n);
  const th = n * (rad(lon) - l0);
  return [200000 + rho * Math.sin(th), 750000 + rho0 - rho * Math.cos(th)];
}

const LANDMARKS: [string, number, number][] = [
  ["Prudential Center", 42.3471, -71.0825], ["Citgo Sign", 42.3489, -71.0951], ["Fenway Park", 42.3467, -71.0972],
  ["Boston Common", 42.355, -71.0656], ["State House", 42.3587, -71.0637], ["Faneuil Hall", 42.36, -71.0568],
  ["TD Garden", 42.3662, -71.0621], ["Zakim Bridge", 42.3687, -71.0612], ["MIT Great Dome", 42.3597, -71.0921],
  ["Harvard Yard", 42.3744, -71.1169], ["Museum of Fine Arts", 42.3394, -71.094], ["Hancock Tower", 42.3492, -71.0753],
  ["Longfellow Bridge", 42.3617, -71.0758], ["Boston Public Library", 42.3493, -71.078], ["Custom House Tower", 42.3593, -71.0534],
  ["Arnold Arboretum", 42.2995, -71.1159], ["Old North Church", 42.3663, -71.0544], ["Boston University", 42.3505, -71.1054],
  ["Northeastern University", 42.3398, -71.0892], ["Tufts University", 42.4075, -71.119], ["Boston College", 42.3355, -71.1685],
  ["UMass Boston", 42.3134, -71.0384], ["Charles River", 42.3555, -71.0905], ["Chinatown Gate", 42.3509, -71.0605],
  ["Boston Harbor", 42.3597, -71.0478], ["Logan Airport", 42.3656, -71.0096], ["Kendall Square", 42.3625, -71.0862],
];

async function main() {
  const meta = JSON.parse(readFileSync(resolve(SRC, "meta.json"), "utf8"));
  const [ox, oy] = meta.origin_xy as [number, number];
  const [ex, ey] = meta.extent_m as [number, number];
  const ch = meta.layers.character;
  const CELL = ch.cell_m as number;
  const { data, info } = await sharp(resolve(SRC, ch.file)).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  console.log(`character.png ${W}x${H}x${C} @ ${CELL} m; origin ${ox},${oy}; check SW corner → ${toMA(meta.bbox_wgs84[0], meta.bbox_wgs84[1]).map(Math.round)}`);

  const sample = (x: number, y: number) => {
    const col = Math.floor((x - ox) / CELL), row = Math.floor((oy + ey - y) / CELL);
    if (col < 0 || row < 0 || col >= W || row >= H) return { cov: 0, h: 0 };
    const i = (row * W + col) * C;
    return { cov: data[i] / 255, h: Math.max(data[i + 1], data[i + 2]) };
  };
  void ex;

  const mbta = JSON.parse(readFileSync(resolve(DATA_DIR, "mbta.json"), "utf8"));
  const stationBy = new Map(mbta.stations.map((s: any) => [s.id, s]));
  mkdirSync(OUT, { recursive: true });
  const index: any[] = [];

  for (const route of mbta.routes) {
    const shapes = mbta.shapes.filter((s: any) => s.routeId === route.id);
    let best = shapes[0];
    let bestLen = 0;
    for (const sh of shapes) {
      let L = 0;
      const pts = sh.coords.map(([lon, lat]: number[]) => toMA(lon, lat));
      for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (L > bestLen) { bestLen = L; best = sh; }
    }
    let pts: [number, number][] = best.coords.map(([lon, lat]: number[]) => toMA(lon, lat));
    const first = stationBy.get(route.stopIds[0]) as any;
    const f0 = toMA(first.lon, first.lat);
    if (Math.hypot(pts[0][0] - f0[0], pts[0][1] - f0[1]) > Math.hypot(pts[pts.length - 1][0] - f0[0], pts[pts.length - 1][1] - f0[1])) pts = pts.reverse();

    // resample every STEP meters
    const res: { x: number; y: number; tx: number; ty: number }[] = [];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (!seg) continue;
      const tx = (x1 - x0) / seg, ty = (y1 - y0) / seg;
      let d = carry;
      while (d <= seg) {
        res.push({ x: x0 + tx * d, y: y0 + ty * d, tx, ty });
        d += STEP;
      }
      carry = d - seg;
    }

    const L: number[] = [], R: number[] = [];
    for (const p of res) {
      // right-hand normal of the travel direction
      const nx = p.ty, ny = -p.tx;
      for (const side of [-1, 1]) {
        for (const off of OFFSETS) {
          const s = sample(p.x + side * nx * off, p.y + side * ny * off);
          // height in meters when a cell is mostly built, -1 for open/park land, 0 for sparse
          const v = s.cov > 0.22 ? Math.max(4, Math.round(s.h)) : s.cov < 0.04 ? -1 : 0;
          (side < 0 ? L : R).push(v);
        }
      }
    }

    const nearestSlice = (x: number, y: number) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < res.length; i++) {
        const d = Math.hypot(res[i].x - x, res[i].y - y);
        if (d < bd) { bd = d; bi = i; }
      }
      return { i: bi, d: bd };
    };
    const stations = route.stopIds
      .map((id: string) => {
        const st = stationBy.get(id) as any;
        const [x, y] = toMA(st.lon, st.lat);
        const nb = nearestSlice(x, y);
        return { id, name: st.name, s: nb.i * STEP, off: Math.round(nb.d) };
      })
      .filter((x: any) => x.off < 400)
      .sort((a: any, b: any) => a.s - b.s);
    const landmarks = LANDMARKS.map(([name, lat, lon]) => {
      const [x, y] = toMA(lon, lat);
      const nb = nearestSlice(x, y);
      const p = res[nb.i];
      const cross = p.tx * (y - p.y) - p.ty * (x - p.x); // >0 left of travel
      return { name, s: nb.i * STEP, side: cross > 0 ? -1 : 1, dist: Math.round(nb.d) };
    }).filter((l) => l.dist < 450);

    const out = { routeId: route.id, name: route.short, color: route.color, step: STEP, offsets: OFFSETS, lengthM: res.length * STEP, L, R, stations, landmarks };
    writeFileSync(resolve(OUT, `${route.id}.json`), JSON.stringify(out));
    index.push({ routeId: route.id, lengthM: out.lengthM, stations: stations.length, landmarks: landmarks.map((l) => l.name) });
    console.log(`${route.id}: ${(out.lengthM / 1000).toFixed(1)} km, ${stations.length} stations, ${landmarks.length} landmarks, tallest ${Math.max(...L, ...R)} m`);
  }
  writeFileSync(resolve(OUT, "index.json"), JSON.stringify({ source: "T-Field pipeline character.png (OSM buildings) + MBTA shapes", lines: index }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
