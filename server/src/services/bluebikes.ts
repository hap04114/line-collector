/** Live Blue Bikes docks from the public GBFS feed (no key). Ported from T-Field api/src/bluebikes.ts. */
import { haversineM, walkMinutes } from "../lib/geo.js";

const BASE = "https://gbfs.lyft.com/gbfs/1.1/bos/en";
export interface Dock { id: string; name: string; lat: number; lon: number; capacity: number | null; bikes: number; ebikes: number; docks: number; renting: boolean; returning: boolean }

/** Joins station_information and station_status into one list. Pure, so it's tested. */
export function shapeDocks(info: any, status: any): Dock[] {
  const st = new Map<string, any>((status?.data?.stations ?? []).map((s: any) => [String(s.station_id), s]));
  return (info?.data?.stations ?? []).flatMap((i: any) => {
    const s = st.get(String(i.station_id));
    if (!s || !Number.isFinite(+i.lat) || !Number.isFinite(+i.lon)) return [];
    const ebikes = Number(s.num_ebikes_available ?? 0);
    return [{
      id: String(i.station_id), name: String(i.name ?? "Blue Bikes"), lat: +i.lat, lon: +i.lon, capacity: i.capacity ?? null,
      bikes: Math.max(0, Number(s.num_bikes_available ?? 0)), ebikes, docks: Math.max(0, Number(s.num_docks_available ?? 0)),
      renting: s.is_renting === 1 || s.is_renting === true, returning: s.is_returning === 1 || s.is_returning === true,
    }];
  });
}

let cache: { at: number; docks: Dock[] } | null = null;
let inflight: Promise<Dock[]> | null = null;
export async function getDocks(): Promise<Dock[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.docks;
  if (!inflight) {
    inflight = (async () => {
      const get = async (f: string) => (await fetch(`${BASE}/${f}.json`, { headers: { "User-Agent": "LineCollector/0.1 (student map)" }, signal: AbortSignal.timeout(8000) })).json();
      const [info, status] = await Promise.all([get("station_information"), get("station_status")]);
      const docks = shapeDocks(info, status);
      cache = { at: Date.now(), docks };
      return docks;
    })().catch((e) => { if (cache) return cache.docks; throw e; }).finally(() => { inflight = null; });
  }
  return inflight;
}

/** Nearest docks that can rent (need = "bike") or take a bike back (need = "dock"). */
export function nearestDocks(docks: Dock[], lat: number, lon: number, need: "bike" | "dock" | "any" = "any", limit = 3, maxM = 1200) {
  return docks
    .filter((d) => (need === "bike" ? d.renting && d.bikes > 0 : need === "dock" ? d.returning && d.docks > 0 : true))
    .map((d) => { const m = haversineM(lat, lon, d.lat, d.lon); return { ...d, distanceM: Math.round(m), walkMin: walkMinutes(m) }; })
    .filter((d) => d.distanceM <= maxM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}
