/**
 * "Transit wave": every T station you can reach within N minutes (merged plan P1, T-Field's travel field idea).
 * Walk to stations within ~1 km, wait half a headway, ride along each line's stop order, pay 2 min + another
 * half headway to transfer. Dijkstra over (station, line) states. No key needed.
 */
import { haversineM } from "../lib/geo.js";
import { ROUTES, STATIONS, stationById } from "../lib/static.js";

const RIDE_M_PER_MIN = 500, HALF_HEADWAY = 4, TRANSFER = 2, MAX_WALK_M = 1100, DETOUR = 1.25;

// edges between consecutive stops on each line; long jumps are branch splits in the stop list, not real track
const edges = new Map<string, { to: string; route: string; min: number }[]>();
for (const r of ROUTES) {
  for (let i = 1; i < r.stopIds.length; i++) {
    const a = stationById.get(r.stopIds[i - 1]), b = stationById.get(r.stopIds[i]);
    if (!a || !b) continue;
    const d = haversineM(a.lat, a.lon, b.lat, b.lon);
    if (d > 3500) continue;
    const min = Math.max(1.5, (d * 1.3) / RIDE_M_PER_MIN);
    for (const [x, y] of [[a.id, b.id], [b.id, a.id]]) edges.set(`${x}|${r.id}`, [...(edges.get(`${x}|${r.id}`) ?? []), { to: y, route: r.id, min }]);
  }
}

export interface Reached { id: string; name: string; minutes: number; walkOnly: boolean; lines: string[]; via: string | null }

export function reach(lat: number, lon: number, budgetMin: number, speed = 1.3): Reached[] {
  const best = new Map<string, number>(); // state "station|route" → minutes
  const viaOf = new Map<string, string | null>();
  const stationBest = new Map<string, { minutes: number; walkOnly: boolean; via: string | null }>();
  const queue: { key: string; min: number }[] = [];
  const push = (key: string, min: number, via: string | null) => {
    if (min > budgetMin || min >= (best.get(key) ?? Infinity)) return;
    best.set(key, min); viaOf.set(key, via); queue.push({ key, min });
  };
  for (const st of STATIONS) {
    const d = haversineM(lat, lon, st.lat, st.lon);
    if (d > MAX_WALK_M) continue;
    const walk = (d * DETOUR) / speed / 60;
    if (walk <= budgetMin) stationBest.set(st.id, { minutes: walk, walkOnly: true, via: null });
    for (const r of st.routes) push(`${st.id}|${r}`, walk + HALF_HEADWAY, r);
  }
  while (queue.length) {
    queue.sort((a, b) => a.min - b.min);
    const { key, min } = queue.shift()!;
    if (min > (best.get(key) ?? Infinity)) continue;
    const [sid, route] = key.split("|");
    const cur = stationBest.get(sid);
    if (!cur || min < cur.minutes) stationBest.set(sid, { minutes: min, walkOnly: false, via: viaOf.get(key) ?? route });
    for (const e of edges.get(key) ?? []) push(`${e.to}|${route}`, min + e.min, route);
    for (const r of stationById.get(sid)?.routes ?? []) if (r !== route) push(`${sid}|${r}`, min + TRANSFER + HALF_HEADWAY, r);
  }
  return [...stationBest.entries()]
    .map(([id, v]) => ({ id, name: stationById.get(id)!.name, minutes: Math.round(v.minutes), walkOnly: v.walkOnly, lines: stationById.get(id)!.routes, via: v.via }))
    .sort((a, b) => a.minutes - b.minutes);
}
