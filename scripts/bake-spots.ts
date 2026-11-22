/**
 * Bakes food, study and free-hangout spots within ~450 m of every subway station
 * from OpenStreetMap (Overpass) into data/spots.json.
 *
 * OSM has no prices, so each spot gets an *estimated* typical-order price from its
 * type and cuisine (price_source = "estimate"). Hand-checked prices go in
 * data/price-overrides.json and win over estimates (price_source = "checked").
 * Vibe tags here are heuristic from OSM tags; `npm run bake:vibes` upgrades them with Gemini.
 *
 *   npm run bake:spots            (needs data/mbta.json first)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR, writeData, sleep } from "./lib.js";

const MIRRORS = [
  process.env.OVERPASS_URL,
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
].filter(Boolean) as string[];

const RADIUS = 450;
const MAX_FOOD = 30;
const MAX_STUDY = 8;
const MAX_PARKS = 2;

const mbta = JSON.parse(readFileSync(resolve(DATA_DIR, "mbta.json"), "utf8"));
const stations: any[] = mbta.stations;

function hav(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLon = (bLon - aLon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function overpass(query: string) {
  for (const url of MIRRORS) {
    for (let i = 0; i < 2; i++) {
      try {
        console.log(`overpass → ${url}`);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "LineCollector/0.1 (BostonHacks 2026)" },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(240_000),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        return (await res.json()) as any;
      } catch (e) {
        console.warn(`  failed: ${(e as Error).message}`);
        await sleep(5000);
      }
    }
  }
  throw new Error("all Overpass mirrors failed");
}

// ---- price estimates (USD cents for a typical cheap order) --------------------
const CUISINE_PRICE: Record<string, number> = {
  pizza: 450, sandwich: 1000, burger: 1200, mexican: 1150, burrito: 1100, tacos: 1000, falafel: 1000,
  middle_eastern: 1150, lebanese: 1200, mediterranean: 1250, greek: 1200, turkish: 1300, chinese: 1250,
  dumpling: 1100, noodle: 1300, ramen: 1600, japanese: 1600, sushi: 1700, korean: 1500, thai: 1450,
  vietnamese: 1300, pho: 1300, indian: 1500, nepalese: 1500, pakistani: 1400, bangladeshi: 1300,
  ethiopian: 1500, caribbean: 1300, jamaican: 1300, haitian: 1300, brazilian: 1400, colombian: 1400,
  salvadoran: 1100, peruvian: 1600, italian: 1700, american: 1500, seafood: 2000, bagel: 700,
  donut: 450, coffee_shop: 600, bubble_tea: 700, ice_cream: 650, breakfast: 1200, chicken: 1100,
  fried_chicken: 1100, kebab: 1150, poke: 1500, salad: 1300, bakery: 600, dessert: 800, crepe: 1000,
};
const AMENITY_PRICE: Record<string, number> = { fast_food: 950, cafe: 700, food_court: 1100, ice_cream: 650, restaurant: 1700, bakery: 600 };

// cuisine → "Taste of Home" region
export const CUISINE_REGION: Record<string, string> = {
  indian: "south-asian", nepalese: "south-asian", pakistani: "south-asian", bangladeshi: "south-asian", sri_lankan: "south-asian",
  chinese: "east-asian", dumpling: "east-asian", cantonese: "east-asian", sichuan: "east-asian", taiwanese: "east-asian", bubble_tea: "east-asian",
  japanese: "east-asian", ramen: "east-asian", sushi: "east-asian", korean: "east-asian",
  vietnamese: "southeast-asian", pho: "southeast-asian", thai: "southeast-asian", filipino: "southeast-asian", malaysian: "southeast-asian", indonesian: "southeast-asian",
  middle_eastern: "middle-eastern", lebanese: "middle-eastern", falafel: "middle-eastern", turkish: "middle-eastern", persian: "middle-eastern", kebab: "middle-eastern",
  mexican: "latin-american", tacos: "latin-american", burrito: "latin-american", brazilian: "latin-american", colombian: "latin-american", salvadoran: "latin-american", peruvian: "latin-american",
  caribbean: "caribbean", jamaican: "caribbean", haitian: "caribbean", cuban: "caribbean", dominican: "caribbean",
  ethiopian: "african", african: "african", nigerian: "african", somali: "african", moroccan: "african",
  italian: "european", greek: "mediterranean", mediterranean: "mediterranean", french: "european", german: "european", polish: "european", portuguese: "european", spanish: "european",
};

function cuisinesOf(tags: any): string[] {
  const c = (tags.cuisine || "").toLowerCase().split(/[;,]/).map((s: string) => s.trim().replace(/\s+/g, "_")).filter(Boolean);
  if (tags.amenity === "ice_cream") c.push("ice_cream");
  if (tags.shop === "bakery") c.push("bakery");
  return [...new Set(c)] as string[];
}

function estimatePrice(tags: any, cuisines: string[]): number {
  const known = cuisines.map((c) => CUISINE_PRICE[c]).filter(Boolean);
  if (known.length) {
    const base = Math.min(...known);
    // counters run cheaper than sit-down restaurants for the same cuisine
    const scale = tags.amenity === "restaurant" ? 1.1 : tags.amenity === "fast_food" || tags.amenity === "food_court" ? 0.75 : 0.85;
    return Math.round((base * scale) / 50) * 50;
  }
  return AMENITY_PRICE[tags.amenity] ?? AMENITY_PRICE[tags.shop] ?? 1500;
}

function heuristicVibes(tags: any, kind: string): string[] {
  const v = new Set<string>();
  if (kind === "landmark" || kind === "hangout") v.add("photogenic");
  if (tags.amenity === "cafe" || tags.shop === "bakery") v.add("cozy");
  if (tags.outdoor_seating === "yes") v.add("photogenic");
  if (tags.amenity === "food_court" || tags.amenity === "restaurant" && /pizza|korean|chinese|dumpling|mexican|indian/.test(tags.cuisine || "")) v.add("good for groups");
  if (tags.amenity === "library") v.add("quiet");
  return [...v];
}

function address(tags: any) {
  const n = tags["addr:housenumber"], s = tags["addr:street"];
  return n && s ? `${n} ${s}` : s || null;
}

async function main() {
  const lines: string[] = [];
  for (const s of stations) {
    const a = `(around:${RADIUS},${s.lat},${s.lon})`;
    lines.push(`nwr${a}["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream|library)$"]["name"];`);
    lines.push(`nwr${a}["shop"="bakery"]["name"];`);
    lines.push(`nwr${a}["leisure"="park"]["name"];`);
  }
  const query = `[out:json][timeout:220];(${lines.join("")});out center tags;`;
  const res = await overpass(query);
  console.log(`${res.elements.length} OSM elements`);

  const byStation = new Map<string, any[]>();
  for (const el of res.elements) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null || !tags.name) continue;
    if (tags.disused || tags["disused:amenity"]) continue;

    let best: any = null, bestD = Infinity;
    for (const s of stations) {
      const d = hav(lat, lon, s.lat, s.lon);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best || bestD > RADIUS + 50) continue;

    const isPark = tags.leisure === "park";
    const isLibrary = tags.amenity === "library";
    const wifi = /^(wlan|yes|wifi|free)$/i.test(tags.internet_access || "") || tags["internet_access:fee"] === "no";
    const kind = isPark ? "hangout" : isLibrary ? "study" : "food";
    const cuisines = cuisinesOf(tags);
    const spot = {
      id: `osm-${el.type[0]}${el.id}`,
      osmId: `${el.type}/${el.id}`,
      name: tags.name,
      kind,
      stationId: best.id,
      distanceM: Math.round(bestD),
      lat: +lat.toFixed(6),
      lon: +lon.toFixed(6),
      cuisines,
      region: cuisines.map((c) => CUISINE_REGION[c]).find(Boolean) || null,
      amenity: tags.amenity || tags.shop || tags.leisure,
      priceCents: kind === "food" ? estimatePrice(tags, cuisines) : 0,
      priceSource: kind === "food" ? "estimate" : "free",
      hours: tags.opening_hours || null,
      vibes: heuristicVibes(tags, kind),
      vibeSource: "osm-heuristic",
      localOwned: !(tags.brand || tags["brand:wikidata"]),
      brand: tags.brand || null,
      wifi: wifi || isLibrary,
      study: isLibrary || (tags.amenity === "cafe" && wifi),
      address: address(tags),
      website: tags.website || tags["contact:website"] || null,
    };
    const arr = byStation.get(best.id) || [];
    arr.push(spot);
    byStation.set(best.id, arr);
  }

  const out: any[] = [];
  for (const [, arr] of byStation) {
    arr.sort((a, b) => a.distanceM - b.distanceM);
    const food = arr.filter((s) => s.kind === "food");
    // keep variety: local spots first, then chains, capped
    const foodKeep = [...food.filter((s) => s.localOwned), ...food.filter((s) => !s.localOwned)].slice(0, MAX_FOOD);
    const study = arr.filter((s) => s.kind === "study" || s.study).slice(0, MAX_STUDY);
    const parks = arr.filter((s) => s.kind === "hangout").slice(0, MAX_PARKS);
    const keep = new Map<string, any>();
    for (const s of [...foodKeep, ...study, ...parks]) keep.set(s.id, s);
    out.push(...keep.values());
  }

  writeData("spots.json", {
    bakedAt: new Date().toISOString(),
    source: "OpenStreetMap contributors (ODbL) via Overpass",
    note: "priceCents are estimates by type/cuisine unless overridden in data/price-overrides.json",
    spots: out,
  });
  const counts = out.reduce((m: any, s) => ((m[s.kind] = (m[s.kind] || 0) + 1), m), {});
  console.log(`${out.length} spots`, counts, `study-capable: ${out.filter((s) => s.study).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
