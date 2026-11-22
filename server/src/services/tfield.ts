/**
 * T-Field's food logic, ported to Line Collector (see t-field web/src/core/availability.ts and ranking.ts):
 *  R0 availability first: judged at the time you ARRIVE, not now. Hidden when closed, closing within
 *     30 min of arrival, or not operating; warns when closing within an hour, hours unknown, or stale info.
 *  Allergens: "high" risk is hidden, "elevated" warns, umbrella terms expand (seafood = fish + shellfish).
 *     Never labeled "safe" (T-Field R4.5).
 *  Budget: per-person price, up to 20% over is allowed with a warning.
 *  Order: availability tier → budget fit → cuisine match → score (rating, vibe, travel time).
 * Data comes from data/tfield.json (npm run merge:tfield) and data/google-places.json (npm run enrich:google).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import opening_hours from "opening_hours";
import { DATA_DIR } from "../config.js";
import type { Db } from "../db/index.js";
import { neighborhoodAt, stationById } from "../lib/static.js";

// ---- constants from T-Field shared/modes.json and shared/taxonomy.json ----
export const AVAILABILITY = { minOpenAfterArrivalMin: 30, closingSoonMin: 60, staleAfterDays: 180 };
export const SOFT_OVER_BUDGET = 1.2;
export const ALLERGENS = ["milk", "egg", "fish", "shellfish", "tree_nut", "peanut", "wheat", "soy", "sesame"] as const;
export const ALLERGEN_UMBRELLA: Record<string, string[]> = { seafood: ["fish", "shellfish"] };
export const ALLERGEN_DISCLAIMER = "Allergen info is estimated. Always confirm with the restaurant.";
export const VENUE_TYPES: Record<string, string> = {
  restaurant: "Restaurant", quick_service: "Quick service", cafe: "Café", bakery: "Bakery", dessert: "Dessert",
  bubble_tea: "Bubble tea", bar_pub: "Bar / pub", food_hall: "Food hall", food_truck: "Food truck", grocery_deli: "Grocery / deli",
};

export type Tier = "available" | "probably" | "unavailable";
export interface Availability { tier: Tier; reasons: string[]; warnings: string[] }

// ---- availability at arrival -------------------------------------------------------------------
const ohCache = new Map<string, any>();
function parseHours(h: string) {
  if (!ohCache.has(h)) {
    try {
      // coordinates as strings: opening_hours ignores numbers and falls back to 6 AM-6 PM for sunrise/sunset
      ohCache.set(h, new opening_hours(h, { lat: "42.36", lon: "-71.06", address: { country_code: "us", state: "Massachusetts" } } as any, { mode: 0, tag_key: "opening_hours" } as any));
    } catch { ohCache.set(h, null); }
  }
  return ohCache.get(h);
}

export function assessAvailability(
  spot: { hours?: string | null; businessStatus?: string | null; verifiedAt?: string | null },
  arriveAt: Date,
  today = new Date(),
): Availability {
  const reasons: string[] = [], warnings: string[] = [];
  if (spot.businessStatus === "closed_permanently") return { tier: "unavailable", reasons: ["Permanently closed"], warnings };
  if (spot.businessStatus === "closed_temporarily") return { tier: "unavailable", reasons: ["Temporarily closed"], warnings };
  if (spot.verifiedAt) {
    const ageDays = (today.getTime() - new Date(spot.verifiedAt).getTime()) / 86_400_000;
    if (ageDays > AVAILABILITY.staleAfterDays) warnings.push("Info may be outdated");
  }
  const oh = spot.hours ? parseHours(spot.hours) : null;
  if (!oh) { warnings.push("Hours unknown, call ahead"); return { tier: "probably", reasons, warnings }; }
  let open: boolean;
  try { open = oh.getState(arriveAt); } catch { warnings.push("Hours unknown, call ahead"); return { tier: "probably", reasons, warnings }; }
  if (!open) { reasons.push("Closed when you arrive"); return { tier: "unavailable", reasons, warnings }; }
  const next: Date | undefined = oh.getNextChange(arriveAt);
  if (next) {
    const left = (next.getTime() - arriveAt.getTime()) / 60_000;
    if (left < AVAILABILITY.minOpenAfterArrivalMin) { reasons.push(`Closes ${Math.round(left)} min after you arrive`); return { tier: "unavailable", reasons, warnings }; }
    if (left < AVAILABILITY.closingSoonMin) warnings.push(`Closes ${Math.round(left)} min after you arrive`);
  }
  return { tier: "available", reasons, warnings };
}

// ---- allergens -----------------------------------------------------------------------------------
export function expandAllergens(avoid: string[]) {
  const out = new Set<string>();
  for (const a of avoid) (ALLERGEN_UMBRELLA[a] ?? [a]).forEach((k) => out.add(k));
  return [...out].filter((k) => (ALLERGENS as readonly string[]).includes(k));
}
/** null = hide this place; otherwise the warnings to show */
export function allergenCheck(risk: Record<string, string> | null | undefined, avoid: string[]): string[] | null {
  const warnings: string[] = [];
  for (const a of expandAllergens(avoid)) {
    const r = risk?.[a];
    if (r === "high") return null;
    if (r === "elevated") warnings.push(`Often contains ${a.replace("_", " ")}`);
  }
  return warnings;
}

// ---- budget --------------------------------------------------------------------------------------
export type BudgetFit = "within" | "over" | "unknown";
/** null = over the soft limit, hide it */
export function budgetFit(spot: { priceCents?: number | null; priceMinCents?: number | null }, budgetCents: number | null): BudgetFit | null {
  if (budgetCents == null) return "within";
  // a real per-person range (Google) wins; otherwise our per-place estimate
  const price = spot.priceMinCents ?? (spot.priceCents && spot.priceCents > 0 ? spot.priceCents : null);
  if (price == null) return "unknown";
  if (price > budgetCents * SOFT_OVER_BUDGET) return null;
  return price > budgetCents ? "over" : "within";
}

// ---- ranking -------------------------------------------------------------------------------------
export interface Ranked { tier: Tier; budgetFit: BudgetFit; cuisineMatch: boolean; score: number }
export function scoreOf(o: { rating?: number | null; vibeHits?: number; arriveMin: number; partner?: boolean; localOwned?: boolean }) {
  // T-Field score, plus small Line Collector nudges for partner and local spots (never above the R0 tiers)
  return 6 * ((o.rating ?? 4) - 4) + 3 * (o.vibeHits ?? 0) - 0.5 * o.arriveMin + (o.partner ? 2 : 0) + (o.localOwned ? 1 : 0);
}
const TIER_RANK: Record<Tier, number> = { available: 0, probably: 1, unavailable: 2 };
const BUDGET_RANK: Record<BudgetFit, number> = { within: 0, over: 1, unknown: 2 };
export function compareRanked(a: Ranked, b: Ranked) {
  return TIER_RANK[a.tier] - TIER_RANK[b.tier] || BUDGET_RANK[a.budgetFit] - BUDGET_RANK[b.budgetFit] || Number(b.cuisineMatch) - Number(a.cuisineMatch) || b.score - a.score;
}

/** Runs every T-Field rule on one decorated spot. null = filtered out. */
export function evaluate(spot: any, o: { arriveAt: Date; budgetCents: number | null; avoid: string[]; venueTypes: string[]; showClosed: boolean; wantVibe?: string; cuisineMatch?: boolean; arriveMin: number }) {
  const av = assessAvailability(spot, o.arriveAt);
  if (av.tier === "unavailable" && !o.showClosed) return null;
  const allergy = allergenCheck(spot.allergen, o.avoid);
  if (allergy === null) return null;
  const fit = budgetFit(spot, o.budgetCents);
  if (fit === null) return null;
  if (o.venueTypes.length && !o.venueTypes.includes(spot.venueType)) return null;
  const warnings = [...av.reasons, ...av.warnings, ...allergy];
  if (fit === "over") warnings.push("A bit over budget");
  if (fit === "unknown") warnings.push("Price unknown");
  const ranked: Ranked = {
    tier: av.tier, budgetFit: fit, cuisineMatch: o.cuisineMatch ?? true,
    score: scoreOf({ rating: spot.rating, vibeHits: o.wantVibe && spot.vibes?.includes(o.wantVibe) ? 1 : 0, arriveMin: o.arriveMin, partner: !!spot.partner, localOwned: spot.localOwned }),
  };
  return { ...spot, availability: av.tier, budgetFit: fit, warnings, _rank: ranked };
}

// ---- loading the data into the spots table -------------------------------------------------------
const readJson = (name: string) => { const p = resolve(DATA_DIR, name); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };

export async function applyTField(db: Db) {
  const tf = readJson("tfield.json");
  const google = readJson("google-places.json");
  if (!tf && !google) return;
  for (const col of [
    "allergen jsonb", "venue_type text", "service jsonb", "price_min_cents int", "price_max_cents int", "business_status text",
    "verified_at date", "rating float8", "rating_count int", "cuisine_groups text[] NOT NULL DEFAULT '{}'", "data_source text",
  ]) await db.query(`ALTER TABLE spots ADD COLUMN IF NOT EXISTS ${col}`);

  let added = 0;
  if (tf?.newSpots?.length) {
    const chunk = 150;
    for (let i = 0; i < tf.newSpots.length; i += chunk) {
      const part = tf.newSpots.slice(i, i + chunk).filter((s: any) => stationById.has(s.stationId));
      if (!part.length) continue;
      const values: unknown[] = [];
      const rows = part.map((s: any, j: number) => {
        const st = stationById.get(s.stationId)!;
        values.push(s.id, s.osmId, s.name, s.amenity, s.stationId, s.lat, s.lon, s.distanceM, s.cuisines, s.region, s.priceCents, s.hours,
          s.vibes, s.localOwned, s.brand, neighborhoodAt(s.lat, s.lon, st.municipality), s.website, s.diet ?? []);
        const o = j * 18;
        return `($${o + 1},$${o + 2},$${o + 3},'food',$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},'estimate',$${o + 12},$${o + 13},'tfield',$${o + 14},$${o + 15},false,false,$${o + 16},$${o + 17},150,$${o + 18},'tfield')`;
      });
      await db.query(
        `INSERT INTO spots (id, osm_id, name, kind, amenity, station_id, lat, lon, distance_m, cuisines, region, price_cents, price_source, hours,
           vibes, vibe_source, local_owned, brand, wifi, study, neighborhood_id, website, checkin_radius_m, diet, data_source)
         VALUES ${rows.join(",")}
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, hours=EXCLUDED.hours, diet=EXCLUDED.diet`,
        values,
      );
      added += part.length;
    }
  }
  if (tf?.extras) {
    const recs = Object.entries<any>(tf.extras).map(([id, e]) => ({
      // T-Field's "level_default" ranges are generic guesses ($0–12 for every cheap place), so only real ranges are kept
      id, allergen: e.allergen, venue_type: e.venueType, service: e.service,
      price_min_cents: e.priceRangeSource === "level_default" ? null : e.priceMinCents, price_max_cents: e.priceRangeSource === "level_default" ? null : e.priceMaxCents,
      business_status: e.businessStatus, verified_at: e.verifiedAt, rating: e.rating, rating_count: e.ratingCount, cuisine_groups: e.cuisineGroups ?? [], hours: e.hours,
    }));
    await db.query(
      `UPDATE spots s SET allergen=x.allergen, venue_type=x.venue_type, service=x.service, price_min_cents=x.price_min_cents,
         price_max_cents=x.price_max_cents, business_status=x.business_status, verified_at=x.verified_at,
         rating=COALESCE(x.rating, s.rating), rating_count=COALESCE(x.rating_count, s.rating_count),
         cuisine_groups=COALESCE(x.cuisine_groups, '{}'), hours=COALESCE(s.hours, x.hours)
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, allergen jsonb, venue_type text, service jsonb, price_min_cents int, price_max_cents int,
         business_status text, verified_at date, rating float8, rating_count int, cuisine_groups text[], hours text)
       WHERE s.id = x.id`,
      [JSON.stringify(recs)],
    );
  }
  let enriched = 0;
  if (google?.places) {
    const recs = Object.entries<any>(google.places).filter(([, g]) => g.matched).map(([id, g]) => ({
      id, rating: g.rating ?? null, rating_count: g.ratingCount ?? null, hours: g.hours ?? null, business_status: g.businessStatus ?? null,
      price_min_cents: g.priceMinCents ?? null, price_max_cents: g.priceMaxCents ?? null,
    }));
    enriched = recs.length;
    if (recs.length) await db.query(
      `UPDATE spots s SET rating=COALESCE(x.rating, s.rating), rating_count=COALESCE(x.rating_count, s.rating_count),
         hours=COALESCE(x.hours, s.hours), business_status=COALESCE(x.business_status, s.business_status),
         price_min_cents=COALESCE(x.price_min_cents, s.price_min_cents), price_max_cents=COALESCE(x.price_max_cents, s.price_max_cents),
         price_cents=CASE WHEN x.price_min_cents IS NOT NULL AND s.price_source = 'estimate' THEN x.price_min_cents ELSE s.price_cents END,
         price_source=CASE WHEN x.price_min_cents IS NOT NULL AND s.price_source = 'estimate' THEN 'google' ELSE s.price_source END
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, rating float8, rating_count int, hours text, business_status text, price_min_cents int, price_max_cents int)
       WHERE s.id = x.id`,
      [JSON.stringify(recs)],
    );
  }
  console.log(`[tfield] ${added} T-Field places added, ${Object.keys(tf?.extras ?? {}).length} enriched with allergen/venue/price/status${google ? `, ${enriched} with Google Places` : ""}`);
}
