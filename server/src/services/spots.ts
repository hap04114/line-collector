/** Spot search for a station: budget, craving, vibe, open now / open late, landmarks, study spots. */
import type { Queryable } from "../db/index.js";
import { isOpenAt, isOpenLate, nextChangeLabel } from "../lib/hours.js";
import { haversineM, walkMinutes } from "../lib/geo.js";
import { stationById, STATIONS } from "../lib/static.js";

export const CRAVINGS: Record<string, { label: string; cuisines?: string[]; amenities?: string[]; regions?: string[] }> = {
  pizza: { label: "Pizza", cuisines: ["pizza"] },
  noodles: { label: "Noodles", cuisines: ["ramen", "noodle", "pho", "vietnamese", "chinese", "dumpling", "thai"] },
  spicy: { label: "Spicy", cuisines: ["indian", "thai", "sichuan", "korean", "mexican", "ethiopian", "nepalese", "pakistani", "jamaican", "caribbean", "szechuan", "hot_pot"] },
  coffee: { label: "Coffee", amenities: ["cafe"], cuisines: ["coffee_shop"] },
  sweet: { label: "Sweet", amenities: ["ice_cream", "bakery"], cuisines: ["dessert", "donut", "bubble_tea", "crepe", "ice_cream", "bakery", "cake"] },
  sandwich: { label: "Sandwich", cuisines: ["sandwich", "bagel", "deli", "sub"] },
  burger: { label: "Burgers", cuisines: ["burger", "american", "chicken", "fried_chicken"] },
  asian: { label: "Asian", regions: ["east-asian", "southeast-asian", "south-asian"] },
  latin: { label: "Latin", regions: ["latin-american", "caribbean"] },
  middle_eastern: { label: "Middle Eastern", regions: ["middle-eastern"] },
};

export const VIBES = ["cozy", "photogenic", "good for groups", "quiet", "late-night", "quick bite"];

export interface SpotQuery {
  stationId: string;
  budgetCents?: number;
  craving?: string;
  vibe?: string;
  openNow?: boolean;
  openLate?: boolean;
  homeRegions?: string[];
  kind?: "food" | "study" | "hangout" | "all";
  limit?: number;
  userId?: string | null;
}

function matchesCraving(s: any, craving: string, homeRegions: string[]): boolean {
  if (craving === "home") return !!s.region && homeRegions.includes(s.region);
  const c = CRAVINGS[craving];
  if (c) {
    return (
      (c.cuisines?.some((x) => s.cuisines.includes(x)) ?? false) ||
      (c.amenities?.some((x) => s.amenity === x) ?? false) ||
      (c.regions?.includes(s.region) ?? false)
    );
  }
  const needle = craving.toLowerCase();
  return s.name.toLowerCase().includes(needle) || s.cuisines.some((x: string) => x.includes(needle));
}

export function decorate(s: any, now = new Date()) {
  const st = stationById.get(s.station_id);
  const dist = st ? haversineM(st.lat, st.lon, s.lat, s.lon) : s.distance_m ?? 0;
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    amenity: s.amenity,
    stationId: s.station_id,
    lat: s.lat,
    lon: s.lon,
    cuisines: s.cuisines,
    region: s.region,
    priceCents: s.price_cents,
    priceSource: s.price_source,
    cheapestItem: s.cheapest_item,
    hours: s.hours,
    openNow: isOpenAt(s.hours, now),
    openLate: isOpenLate(s.hours, now),
    nextChange: nextChangeLabel(s.hours, now),
    vibes: s.vibes,
    vibeSource: s.vibe_source,
    localOwned: s.local_owned,
    brand: s.brand,
    wifi: s.wifi,
    study: s.study,
    neighborhoodId: s.neighborhood_id,
    address: s.address,
    website: s.website,
    description: s.description,
    walkMin: walkMinutes(dist),
    distanceM: Math.round(dist),
    checkinRadiusM: s.checkin_radius_m,
    partner: s.partner_id ? { id: s.partner_id, isSample: s.partner_is_sample, offer: s.offer_title, stampsNeeded: s.stamps_needed } : null,
    study_rating: s.r_n ? { outlets: +s.r_outlets.toFixed(1), noise: +s.r_noise.toFixed(1), wifi: +s.r_wifi.toFixed(1), n: s.r_n } : null,
    visitedByMe: !!s.visited,
  };
}

const SPOT_SELECT = `
  SELECT s.*, p.id AS partner_id, p.is_sample AS partner_is_sample, o.title AS offer_title, o.stamps_needed,
         r.outlets AS r_outlets, r.noise AS r_noise, r.wifi AS r_wifi, r.n AS r_n,
         EXISTS (SELECT 1 FROM checkins c WHERE c.spot_id = s.id AND c.user_id = $2 AND c.verified IN ('verified','unchecked')) AS visited
  FROM spots s
  LEFT JOIN partners p ON p.spot_id = s.id
  LEFT JOIN LATERAL (SELECT title, stamps_needed FROM offers WHERE partner_id = p.id AND active ORDER BY created_at LIMIT 1) o ON true
  LEFT JOIN LATERAL (SELECT avg(outlets)::float8 AS outlets, avg(noise)::float8 AS noise, avg(wifi)::float8 AS wifi, count(*)::int AS n
                     FROM study_ratings WHERE spot_id = s.id) r ON true`;

export async function getSpot(q: Queryable, id: string, userId: string | null = null) {
  const rows = await q.query(`${SPOT_SELECT} WHERE s.id = $1`, [id, userId]);
  return rows[0] ? decorate(rows[0]) : null;
}

export async function findSpots(q: Queryable, opt: SpotQuery) {
  const now = new Date();
  const budget = opt.budgetCents ?? 1000;
  const rows = (await q.query(`${SPOT_SELECT} WHERE s.station_id = $1`, [opt.stationId, opt.userId ?? null])).map((r) => decorate(r, now));

  const landmarks = rows.filter((s) => s.kind === "landmark" || s.kind === "hangout").sort((a, b) => (a.kind === "landmark" ? -1 : 1) - (b.kind === "landmark" ? -1 : 1) || a.distanceM - b.distanceM);
  const study = rows
    .filter((s) => s.study || s.kind === "study")
    .filter((s) => (opt.openLate ? s.openLate !== false : true))
    .sort((a, b) => (b.study_rating?.n ?? 0) - (a.study_rating?.n ?? 0) || a.distanceM - b.distanceM);

  let food = rows.filter((s) => s.kind === "food");
  const totalFood = food.length;
  food = food.filter((s) => s.priceCents <= budget);
  if (opt.craving) food = food.filter((s) => matchesCraving(s, opt.craving!, opt.homeRegions || []));
  if (opt.vibe) food = food.filter((s) => s.vibes.includes(opt.vibe!));
  if (opt.openNow) food = food.filter((s) => s.openNow === true);
  if (opt.openLate) food = food.filter((s) => s.openLate === true);

  // rank: partners and local spots first, then open, then cheaper and closer
  food.sort(
    (a, b) =>
      Number(!!b.partner) - Number(!!a.partner) ||
      Number(b.localOwned) - Number(a.localOwned) ||
      Number(b.openNow === true) - Number(a.openNow === true) ||
      a.priceCents + a.distanceM * 2 - (b.priceCents + b.distanceM * 2),
  );

  let suggestion: { stationId: string; name: string; distanceM: number; count: number } | null = null;
  if (!food.length && (opt.kind ?? "food") === "food") suggestion = await nearestStationWithSpots(q, opt, budget);

  return {
    stationId: opt.stationId,
    budgetCents: budget,
    food: food.slice(0, opt.limit ?? 3),
    moreFood: Math.max(0, food.length - (opt.limit ?? 3)),
    totalFood,
    landmarks: landmarks.slice(0, 3),
    study: study.slice(0, 6),
    suggestion,
  };
}

async function nearestStationWithSpots(q: Queryable, opt: SpotQuery, budget: number) {
  const here = stationById.get(opt.stationId);
  if (!here) return null;
  const counts = await q.query<{ station_id: string; n: number }>(
    `SELECT station_id, count(*)::int AS n FROM spots WHERE kind='food' AND price_cents <= $1 GROUP BY station_id`,
    [budget],
  );
  const best = counts
    .filter((c) => c.station_id !== opt.stationId)
    .map((c) => ({ c, st: stationById.get(c.station_id)! }))
    .filter((x) => x.st)
    .map((x) => ({ stationId: x.st.id, name: x.st.name, distanceM: Math.round(haversineM(here.lat, here.lon, x.st.lat, x.st.lon)), count: x.c.n }))
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  return best ?? null;
}

export const allStationIds = () => STATIONS.map((s) => s.id);
