/** Google Places API (New) helpers for the enrichment script (scripts/enrich-google.ts). Pure parts are unit-tested. */
import { haversineM } from "../lib/geo.js";

const DAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;

/** regularOpeningHours.periods → OSM opening_hours ("Mo 11:00-21:00; Tu …"); open past midnight keeps the evening's day. */
export function periodsToOsm(periods: any[] | undefined): string | null {
  if (!periods?.length) return null;
  if (periods.length === 1 && periods[0].open && !periods[0].close && periods[0].open.hour === 0 && (periods[0].open.minute ?? 0) === 0) return "24/7";
  const byDay = new Map<number, string[]>();
  for (const p of periods) {
    if (!p.open || !p.close) continue;
    const span = `${hhmm(p.open.hour, p.open.minute)}-${p.close.hour === 0 && (p.close.minute ?? 0) === 0 && p.close.day !== p.open.day ? "24:00" : hhmm(p.close.hour, p.close.minute)}`;
    byDay.set(p.open.day, [...(byDay.get(p.open.day) ?? []), span]);
  }
  if (!byDay.size) return null;
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => byDay.has(d)).map((d) => `${DAY[d]} ${byDay.get(d)!.join(",")}`).join("; ");
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|restaurant|cafe|café|boston|cambridge|and)\b/g, " ").replace(/\s+/g, " ").trim();
export function sameName(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  // a trailing plural "s" doesn't make a different place ("Mamacitas" is "Mamacita Mexican Comida")
  const stem = (t: string) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
  const ta = new Set(x.split(" ").map(stem)), tb = new Set(y.split(" ").map(stem));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / Math.min(ta.size, tb.size) >= 0.6;
}

const STATUS: Record<string, string> = { OPERATIONAL: "operational", CLOSED_TEMPORARILY: "closed_temporarily", CLOSED_PERMANENTLY: "closed_permanently" };
const money = (p: any) => (p?.units != null ? Math.round((Number(p.units) + (p.nanos ?? 0) / 1e9) * 100) : null);

/** One Text Search result → what we store, or { matched: false } when it isn't the same place. */
export function shapePlace(spot: { name: string; lat: number; lon: number }, place: any) {
  if (!place) return { matched: false as const, reason: "no result" };
  const lat = place.location?.latitude, lon = place.location?.longitude;
  const d = Number.isFinite(lat) && Number.isFinite(lon) ? haversineM(spot.lat, spot.lon, lat, lon) : Infinity;
  const name = place.displayName?.text ?? "";
  if (d > 120 || !sameName(spot.name, name)) return { matched: false as const, reason: `different place (${name}, ${Math.round(d)} m)` };
  return {
    matched: true as const, googleId: place.id, googleName: name,
    rating: place.rating ?? null, ratingCount: place.userRatingCount ?? null,
    priceLevel: place.priceLevel ?? null, priceMinCents: money(place.priceRange?.startPrice), priceMaxCents: money(place.priceRange?.endPrice),
    businessStatus: STATUS[place.businessStatus] ?? null, hours: periodsToOsm(place.regularOpeningHours?.periods),
  };
}

export const PLACES_FIELDS = "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.priceRange,places.businessStatus,places.regularOpeningHours";

export async function searchPlace(key: string, spot: { name: string; lat: number; lon: number }) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": PLACES_FIELDS },
    body: JSON.stringify({ textQuery: spot.name, pageSize: 1, locationBias: { circle: { center: { latitude: spot.lat, longitude: spot.lon }, radius: 150 } } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return shapePlace(spot, (await res.json()).places?.[0]);
}
