/**
 * Live → Find a place: real data only from APIs that allow it.
 *   GET /api/housing/meta                                 which sources are switched on
 *   GET /api/housing/rentals?lat&lon&maxRent&beds         RentCast active rental listings (RENTCAST_API_KEY)
 *   GET /api/housing/stays?type=hostel|hotel&lat&lon      Google Places lodging nearby (GOOGLE_API_KEY)
 * Zillow, Apartments.com, Craigslist and Facebook Marketplace have no listings API and forbid scraping,
 * so the app links to a pre-filled search on each instead (web/src/components/HousingFinder.tsx).
 * Both APIs bill per call (RentCast's free plan is 50 calls a month), so results are cached.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router } from "express";
import { z } from "zod";
import { STATE_DIR } from "../config.js";
import { haversineM, walkMinutes } from "../lib/geo.js";
import { nearestStations, routeById } from "../lib/static.js";
import { HttpError } from "../lib/util.js";

export const housingRoutes = Router();

const rentcastKey = () => process.env.RENTCAST_API_KEY || "";
const googleKey = () => process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "";

// small disk cache so a restart doesn't spend more of RentCast's monthly allowance
const CACHE_FILE = resolve(STATE_DIR, "housing-cache.json");
let cache: Record<string, { at: number; value: any }> = {};
try { if (existsSync(CACHE_FILE)) cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { cache = {}; }
const saveCache = () => { try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch { /* read-only disk: memory only */ } };
const cached = async <T,>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> => {
  const hit = cache[key];
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache[key] = { at: Date.now(), value };
  saveCache();
  return value;
};

const nearT = (lat: number, lon: number) => {
  const n = nearestStations(lat, lon, 1)[0];
  if (!n || n.distanceM > 2000) return null;
  return { id: n.station.id, name: n.station.name, walkMin: walkMinutes(n.distanceM), lines: n.station.routes.map((r) => routeById.get(r)).filter(Boolean).map((r) => ({ id: r!.id, short: r!.short, color: r!.color })) };
};

housingRoutes.get("/housing/meta", (_req, res) => res.json({ rentcast: !!rentcastKey(), google: !!googleKey() }));

const Pt = { lat: z.coerce.number().min(41).max(43.5), lon: z.coerce.number().min(-72.5).max(-70) };

/** RentCast listing → what the app shows. Pure, so it's tested. */
export function shapeRental(l: any, from: { lat: number; lon: number }) {
  if (!Number.isFinite(l?.latitude) || !Number.isFinite(l?.longitude) || !Number.isFinite(l?.price)) return null;
  const d = haversineM(from.lat, from.lon, l.latitude, l.longitude);
  return {
    id: String(l.id ?? `${l.latitude},${l.longitude}`), address: l.formattedAddress ?? l.addressLine1 ?? "Address on request",
    priceCents: Math.round(l.price * 100), bedrooms: l.bedrooms ?? null, bathrooms: l.bathrooms ?? null, sqft: l.squareFootage ?? null,
    propertyType: l.propertyType ?? null, listedDate: l.listedDate ? String(l.listedDate).slice(0, 10) : null, daysOnMarket: l.daysOnMarket ?? null,
    lat: l.latitude, lon: l.longitude, distanceM: Math.round(d), station: nearT(l.latitude, l.longitude),
  };
}

housingRoutes.get("/housing/rentals", async (req, res) => {
  const q = z.object({ ...Pt, maxRent: z.coerce.number().min(300).max(20000).default(2500), beds: z.coerce.number().int().min(0).max(5).optional() }).parse(req.query);
  if (!rentcastKey()) throw new HttpError(503, "Real rental listings turn on once RENTCAST_API_KEY is set on the server");
  // cache per ~1 km square and bedroom count for 12 hours; budget is filtered after, so it costs nothing to change
  const key = `rc:${q.lat.toFixed(2)},${q.lon.toFixed(2)}:${q.beds ?? "any"}`;
  const raw: any[] = await cached(key, 12 * 3_600_000, async () => {
    const url = new URL("https://api.rentcast.io/v1/listings/rental/long-term");
    url.search = new URLSearchParams({ latitude: String(q.lat), longitude: String(q.lon), radius: "1.5", status: "Active", limit: "200", ...(q.beds != null ? { bedrooms: String(q.beds) } : {}) }).toString();
    const r = await fetch(url, { headers: { "X-Api-Key": rentcastKey(), Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new HttpError(502, `RentCast answered ${r.status}`);
    const j = await r.json();
    return Array.isArray(j) ? j : j?.listings ?? [];
  });
  const listings = raw.map((l) => shapeRental(l, q)).filter((x): x is NonNullable<typeof x> => !!x && x.priceCents <= q.maxRent * 100)
    .sort((a, b) => a.priceCents - b.priceCents || a.distanceM - b.distanceM).slice(0, 25);
  res.json({ source: "RentCast (active listings, cached 12 h)", total: listings.length, listings });
});

/** Google Places lodging result → what the app shows. Pure, so it's tested. */
export function shapeStay(p: any, from: { lat: number; lon: number }) {
  const lat = p?.location?.latitude, lon = p?.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const d = haversineM(from.lat, from.lon, lat, lon);
  return {
    id: p.id, name: p.displayName?.text ?? "Place to stay", address: p.formattedAddress ?? null, rating: p.rating ?? null, ratingCount: p.userRatingCount ?? null,
    priceLevel: p.priceLevel ?? null, website: p.websiteUri ?? null, mapsUrl: p.googleMapsUri ?? null,
    lat, lon, distanceM: Math.round(d), station: nearT(lat, lon),
  };
}

housingRoutes.get("/housing/stays", async (req, res) => {
  const q = z.object({ ...Pt, type: z.enum(["hostel", "hotel"]) }).parse(req.query);
  if (!googleKey()) throw new HttpError(503, "Nearby hostels and hotels turn on once GOOGLE_API_KEY (Places API (New)) is set on the server");
  const key = `gp:${q.type}:${q.lat.toFixed(2)},${q.lon.toFixed(2)}`;
  const places: any[] = await cached(key, 6 * 3_600_000, async () => {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "X-Goog-Api-Key": googleKey(),
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.websiteUri,places.googleMapsUri",
      },
      body: JSON.stringify({ textQuery: q.type === "hostel" ? "hostel" : "hotel", includedType: q.type, strictTypeFiltering: true, pageSize: 15, locationBias: { circle: { center: { latitude: q.lat, longitude: q.lon }, radius: 3000 } } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new HttpError(502, `Google Places answered ${r.status}`);
    return (await r.json()).places ?? [];
  });
  const stays = places.map((p) => shapeStay(p, q)).filter(Boolean).sort((a: any, b: any) => a.distanceM - b.distanceM);
  res.json({ source: "Google Places (cached 6 h)", total: stays.length, stays });
});
