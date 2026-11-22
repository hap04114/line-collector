/**
 * Brings T-Field's place data into Line Collector as data/tfield.json (spots.json stays untouched):
 *  - extras: T-Field fields for spots we already have (allergen risk, venue type, service, per-person
 *    price range, business status, opening hours when we have none, verified date, cuisine groups)
 *  - newSpots: T-Field places we don't have, within 1.2 km of a subway station, shaped like our spots
 *   npm run merge:tfield -- [path to t-field/web/public/data]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR, ROOT } from "./lib.js";

const SRC = resolve(process.argv[2] || resolve(ROOT, "../t-field/web/public/data"));
const MAX_STATION_M = 1200;

const tf: any[] = (() => { const j = JSON.parse(readFileSync(resolve(SRC, "places.json"), "utf8")); return j.places ?? j; })();
const spots: any[] = JSON.parse(readFileSync(resolve(DATA_DIR, "spots.json"), "utf8")).spots;
const stations: any[] = JSON.parse(readFileSync(resolve(DATA_DIR, "mbta.json"), "utf8")).stations;
const have = new Set(spots.map((s) => s.id));

const hav = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const r = Math.PI / 180, x = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(x));
};

const AMENITY: Record<string, string> = {
  restaurant: "restaurant", quick_service: "fast_food", cafe: "cafe", bakery: "bakery", dessert: "ice_cream",
  bubble_tea: "cafe", bar_pub: "pub", food_hall: "food_court", food_truck: "fast_food", grocery_deli: "fast_food",
};
const REGION: Record<string, string> = {
  south_asian: "south-asian", east_asian: "east-asian", southeast_asian: "southeast-asian", middle_eastern_arabic: "middle-eastern",
  latin_american_caribbean: "latin-american", african: "african", european: "european",
};
const CHAINS = /\b(dunkin|starbucks|mcdonald|subway|chipotle|panera|domino|burger king|wendy|taco bell|pizza hut|popeyes|kfc|sweetgreen|cava|five guys|shake shack|papa john|qdoba|chick-fil-a|wingstop|jersey mike|dominos|7-eleven|cvs|tatte|blue bottle|pret)\b/i;

const dietTags = (p: any) => Object.entries<any>(p.diet ?? {})
  .filter(([, v]) => v.level === "only" || v.level === "options")
  .map(([k, v]) => (v.confidence === "inferred" ? `${k}?` : k));

function extrasOf(p: any) {
  const allergen = Object.fromEntries(Object.entries<string>(p.allergen_risk ?? {}).filter(([, v]) => v !== "unknown"));
  const svc = p.service ?? {};
  const range = p.price?.per_person_usd;
  return {
    allergen: Object.keys(allergen).length ? allergen : null,
    venueType: p.venue_type ?? null,
    service: svc.dine_in != null || svc.takeout != null || svc.delivery != null ? { dineIn: svc.dine_in ?? null, takeout: svc.takeout ?? null, delivery: svc.delivery ?? null } : null,
    priceMinCents: range ? Math.round(range[0] * 100) : null,
    priceMaxCents: range ? Math.round(range[1] * 100) : null,
    priceRangeSource: p.price?.source ?? null,
    businessStatus: p.availability?.status ?? "unknown",
    hours: p.availability?.opening_hours_raw ?? null,
    verifiedAt: p.availability?.verified_at ?? null,
    cuisineGroups: p.cuisine_groups ?? [],
    rating: p.rating ?? null,
    ratingCount: p.rating_count ?? null,
  };
}

const extras: Record<string, ReturnType<typeof extrasOf>> = {};
const newSpots: any[] = [];
let far = 0;
for (const p of tf) {
  const id = String(p.id).replace("osm:", "osm-");
  const ex = extrasOf(p);
  extras[id] = ex;
  if (have.has(id)) continue;
  const [lon, lat] = p.lonlat;
  let best: any = null, bestD = Infinity;
  for (const st of stations) { const d = hav(lat, lon, st.lat, st.lon); if (d < bestD) { bestD = d; best = st; } }
  if (!best || bestD > MAX_STATION_M) { far++; continue; }
  const range = p.price?.per_person_usd as [number, number] | null;
  const low = range ? (range[0] || range[1] * 0.5) : 12;
  const priceCents = range ? Math.round((((low + range[1]) / 2) * 100) / 50) * 50 : 1200;
  const vibes = new Set<string>();
  if (p.venue_type === "cafe" || p.venue_type === "bakery") vibes.add("cozy");
  if (p.venue_type === "food_hall") vibes.add("good for groups");
  if (p.venue_type === "quick_service" || p.venue_type === "food_truck") vibes.add("quick bite");
  for (const v of p.vibe ?? []) vibes.add(String(v).replace(/_/g, " "));
  const chain = CHAINS.test(p.name);
  newSpots.push({
    id, osmId: id.replace("osm-n", "node/").replace("osm-w", "way/"), name: p.name, kind: "food",
    stationId: best.id, distanceM: Math.round(bestD), lat, lon,
    cuisines: p.cuisines_raw ?? [], region: (p.cuisine_groups ?? []).map((g: string) => REGION[g]).find(Boolean) ?? null,
    amenity: AMENITY[p.venue_type] ?? "restaurant", priceCents, priceSource: "estimate",
    hours: p.availability?.opening_hours_raw ?? null, vibes: [...vibes], vibeSource: "tfield",
    localOwned: !chain, brand: chain ? p.name : null, wifi: false, study: false,
    address: null, website: p.website ?? null, diet: dietTags(p),
  });
}

writeFileSync(resolve(DATA_DIR, "tfield.json"), JSON.stringify({
  bakedAt: new Date().toISOString(),
  source: "T-Field places.json (OSM + shared/taxonomy.json rules). Allergen risk is estimated and never 'safe'.",
  extras, newSpots,
}));
const known = Object.values(extras);
console.log(`T-Field places: ${tf.length}`);
console.log(`  extras for spots we already had: ${spots.filter((s) => extras[s.id]).length}`);
console.log(`  new spots within ${MAX_STATION_M} m of a station: ${newSpots.length} (skipped ${far} farther away)`);
console.log(`  with allergen risk: ${known.filter((e) => e.allergen).length} · with service info: ${known.filter((e) => e.service).length} · not operating: ${known.filter((e) => e.businessStatus !== "operational" && e.businessStatus !== "unknown").length}`);
