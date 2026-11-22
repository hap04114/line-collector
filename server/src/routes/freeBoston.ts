/**
 * $0 Boston: free places and broke-student day trails.
 *   GET /api/free-boston?budget=0..50 (dollars)&cats=park,view&crew=date&diet=vegetarian&indoor=1&walk=1&lat=&lon=&seed=
 * Places come from data/freeBoston.ts; the cheap eat next to each stop comes from the spots table
 * (OSM prices + T-Field diet tags), so it shares data with Explore without touching its code.
 */
import { Router } from "express";
import opening_hours from "opening_hours";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { BROKE_HACKS, FREE_CATS, FREE_PLACES, type FreePlace } from "../data/freeBoston.js";
import { getWeather } from "../lib/external.js";
import { haversineM, walkMinutes } from "../lib/geo.js";
import { isOpenAt } from "../lib/hours.js";
import { routeById, stationById } from "../lib/static.js";
import { getBostonEvents, matchesQuery } from "../services/bostonEvents.js";
import { cleanQuery, searchBostonWeb } from "../services/eventSearch.js";
import { HttpError, rateLimit } from "../lib/util.js";
import { geminiEnabled } from "../lib/gemini.js";

export const freeBostonRoutes = Router();

const flag = z.enum(["1", "0", "true", "false"]).transform((v) => v === "1" || v === "true").optional();

const Q = z.object({
  budget: z.coerce.number().min(0).max(100).default(0),
  cats: z.string().optional(),
  crew: z.enum(["solo", "date", "friends"]).optional(),
  diet: z.enum(["halal", "vegetarian", "vegan", "gluten_free", "kosher"]).optional(),
  indoor: flag,
  walk: flag,
  lat: z.coerce.number().optional(),
  lon: z.coerce.number().optional(),
  seed: z.coerce.number().int().optional(),
  stops: z.coerce.number().int().min(2).max(6).default(4),
});

/** WMO weather codes for rain, snow, showers and storms */
const wet = (code: number | null) => code != null && ((code >= 51 && code <= 67) || (code >= 71 && code <= 86) || code >= 95);

/** small seeded RNG so "spin again" is reproducible and shareable */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Eat { id: string; name: string; priceCents: number; priceSource: string; cheapestItem: string | null; cuisines: string[]; diet: string[]; openNow: boolean | null; localOwned: boolean; chain: boolean; distanceM: number; walkMin: number; stationId: string; lat: number; lon: number }

function lineHop(a: FreePlace, b: FreePlace) {
  const sa = stationById.get(a.stationId), sb = stationById.get(b.stationId);
  if (!sa || !sb || sa.id === sb.id) return null;
  const shared = sa.routes.filter((r) => sb.routes.includes(r));
  const pick = (ids: string[]) => ids.map((r) => routeById.get(r)).filter(Boolean).map((r) => ({ id: r!.id, short: r!.short, color: r!.color }));
  return { from: sa.name, to: sb.name, direct: shared.length > 0, lines: pick(shared.length ? shared.slice(0, 1) : [sa.routes[0], sb.routes[0]]) };
}

freeBostonRoutes.get("/free-boston", async (req, res) => {
  const q = Q.parse(req.query);
  const budgetCents = Math.round(q.budget * 100);
  const cats = q.cats ? new Set(q.cats.split(",").filter(Boolean)) : null;
  const weather = await getWeather().catch(() => null);
  const rainy = wet(weather?.code ?? null) || (weather?.feelsLikeF ?? 99) <= 25;

  // ---- 1. filter the curated list -------------------------------------------------------
  let places = FREE_PLACES.filter((p) => p.costCents <= budgetCents);
  if (cats?.size) places = places.filter((p) => cats.has(p.cat));
  if (q.crew) places = places.filter((p) => p.crew.includes(q.crew!));
  if (q.indoor) places = places.filter((p) => p.indoor);

  // ---- 2. cheap eats from the shared spots table (only when there's money to spend) --------
  const now = new Date();
  let eats: Eat[] = [];
  if (budgetCents > 0) {
    const db = await getDb();
    const rows = await db.query<any>(
      `SELECT id, name, lat, lon, price_cents, price_source, cheapest_item, cuisines, diet, hours, local_owned, brand, station_id
       FROM spots WHERE kind='food' AND price_cents > 0 AND price_cents <= $1`,
      [budgetCents],
    );
    const okDiet = (d: string[]) => {
      if (!q.diet) return true;
      const clean = (d ?? []).map((x) => x.replace("?", ""));
      return q.diet === "vegetarian" ? clean.includes("vegetarian") || clean.includes("vegan") : clean.includes(q.diet);
    };
    eats = rows.filter((r) => okDiet(r.diet)).map((r) => ({
      id: r.id, name: r.name, priceCents: r.price_cents, priceSource: r.price_source, cheapestItem: r.cheapest_item, cuisines: r.cuisines ?? [],
      diet: r.diet ?? [], openNow: isOpenAt(r.hours, now), localOwned: !!r.local_owned, chain: !!r.brand, distanceM: 0, walkMin: 0, stationId: r.station_id, lat: r.lat, lon: r.lon,
    }));
  }
  const eatNear = (p: FreePlace, maxCents: number): Eat | null => {
    let best: Eat | null = null, bestScore = Infinity;
    for (const e of eats) {
      if (e.priceCents > maxCents || e.openNow === false) continue;
      const d = haversineM(p.lat, p.lon, e.lat, e.lon);
      if (d > 700) continue;
      // cheaper, closer, local first; chains last (a student can find a Dunkin' without us)
      const score = e.priceCents + d * 1.5 - (e.localOwned ? 400 : 0) + (e.chain ? 600 : 0);
      if (score < bestScore) { bestScore = score; best = { ...e, distanceM: Math.round(d), walkMin: walkMinutes(d) }; }
    }
    return best;
  };

  const here = q.lat != null && q.lon != null ? { lat: q.lat, lon: q.lon } : null;
  const decorated = places
    .map((p) => {
      const st = stationById.get(p.stationId);
      return {
        ...p,
        station: st?.name ?? null,
        lines: (st?.routes ?? []).map((r) => routeById.get(r)).filter(Boolean).map((r) => ({ id: r!.id, short: r!.short, color: r!.color })),
        distanceM: here ? Math.round(haversineM(here.lat, here.lon, p.lat, p.lon)) : null,
        eat: budgetCents > 0 ? eatNear(p, budgetCents - p.costCents) : null,
      };
    })
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0) || a.costCents - b.costCents);

  // ---- 3. build a day trail -----------------------------------------------------------------
  const rand = rng(q.seed ?? 1);
  const pool = [...places];
  let start: FreePlace | undefined;
  if (q.seed != null) start = pool[Math.floor(rand() * pool.length)];
  else {
    const from = here ?? { lat: 42.3564, lon: -71.0624 }; // Park Street
    start = [...pool].sort((a, b) => haversineM(from.lat, from.lon, a.lat, a.lon) - haversineM(from.lat, from.lon, b.lat, b.lon))[0];
  }
  const stops: FreePlace[] = [];
  let spent = 0;
  if (start) { stops.push(start); spent += start.costCents; }
  const maxHop = q.walk ? 2000 : 6000;
  while (stops.length < q.stops) {
    const last = stops[stops.length - 1];
    const next = pool
      .filter((p) => !stops.includes(p) && p.costCents + spent <= budgetCents)
      .map((p) => ({ p, d: haversineM(last.lat, last.lon, p.lat, p.lon) }))
      .filter((x) => x.d <= maxHop)
      // prefer a different kind of place than the last one, so the day has variety
      .sort((a, b) => a.d * (a.p.cat === last.cat ? 1.8 : 1) - b.d * (b.p.cat === last.cat ? 1.8 : 1));
    if (!next.length) break;
    const choice = next[Math.min(next.length - 1, q.seed != null ? Math.floor(rand() * Math.min(2, next.length)) : 0)];
    stops.push(choice.p);
    spent += choice.p.costCents;
  }
  // end on a sunset spot when the trail has one
  const sunsetIdx = stops.findIndex((s, i) => s.sunset && i > 0 && i < stops.length - 1);
  if (sunsetIdx > 0 && !stops[stops.length - 1].sunset) {
    const [s] = stops.splice(sunsetIdx, 1);
    stops.push(s);
  }

  // meal near the middle of the trail, then treats while money remains
  let meal: (Eat & { afterStop: number }) | null = null;
  if (budgetCents > spent && stops.length) {
    const mid = Math.min(stops.length - 1, Math.floor(stops.length / 2));
    const order = [mid, ...stops.map((_, i) => i).filter((i) => i !== mid)];
    for (const i of order) {
      const e = eatNear(stops[i], budgetCents - spent);
      if (e) { meal = { ...e, afterStop: i }; spent += e.priceCents; break; }
    }
  }
  const treats: { stopId: string; label: string; cents: number }[] = [];
  for (const s of stops) if (s.treat && spent + s.treat.cents <= budgetCents) { treats.push({ stopId: s.id, ...s.treat }); spent += s.treat.cents; }

  const legs = stops.slice(1).map((b, i) => {
    const a = stops[i];
    const d = haversineM(a.lat, a.lon, b.lat, b.lon);
    const walk = walkMinutes(d);
    const ride = !q.walk && d > 1600 ? lineHop(a, b) : null;
    return { distanceM: Math.round(d), mode: ride ? "ride" : "walk", minutes: ride ? Math.round(8 + d / 450) : walk, ride };
  });
  const minutes = stops.reduce((m, s) => m + s.minutes, 0) + legs.reduce((m, l) => m + l.minutes, 0);

  res.json({
    budgetCents,
    weather: weather ? { tempF: weather.tempF, feelsLikeF: weather.feelsLikeF, rainy } : null,
    cats: FREE_CATS,
    hacks: BROKE_HACKS,
    catalog: FREE_PLACES.map((p) => ({ id: p.id, name: p.name })),
    total: decorated.length,
    places: decorated,
    trail: stops.length
      ? {
          seed: q.seed ?? null,
          stops: stops.map((s) => decorated.find((d) => d.id === s.id)!),
          legs,
          meal,
          treats,
          spentCents: spent,
          minutes,
          rides: legs.filter((l) => l.mode === "ride").length,
          walkKm: +(legs.filter((l) => l.mode === "walk").reduce((m, l) => m + l.distanceM, 0) / 1000).toFixed(1),
        }
      : null,
  });
});

// ---- Boston events (Meetup, Luma, Eventbrite, campus calendars) -----------------------------------
const EQ = z.object({
  budget: z.coerce.number().min(0).max(100).default(0),
  when: z.enum(["today", "weekend", "week"]).default("week"),
  crew: z.enum(["solo", "date", "friends"]).optional(),
  food: flag,
  inPerson: flag,
  lat: z.coerce.number().optional(),
  lon: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  q: z.string().max(80).optional(),
});

const CREW_TAGS: Record<string, string[]> = {
  friends: ["social", "music", "food", "outdoors"],
  date: ["arts", "music", "food", "outdoors"],
  solo: ["learning", "tech", "career", "arts", "wellness"],
};

/** [start, end) of the window in Boston time (the server runs with TZ=America/New_York). */
export function eventWindow(when: "today" | "weekend" | "week", now = new Date()): [number, number] {
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const days = (n: number) => { const d = new Date(day0); d.setDate(d.getDate() + n); return d.getTime(); };
  if (when === "today") return [now.getTime(), days(1)];
  if (when === "week") return [now.getTime(), days(7)];
  const dow = now.getDay(); // 0 Sun … 6 Sat
  const fri = dow === 0 ? -2 : 5 - dow; // weekend = Fri 5 PM → Mon 00:00
  const start = new Date(days(fri)); start.setHours(17);
  return [Math.max(now.getTime(), start.getTime()), days(dow === 0 ? 1 : 8 - dow)];
}

freeBostonRoutes.get("/boston-events", async (req, res) => {
  const q = EQ.parse(req.query);
  const { events, sources, at } = await getBostonEvents();
  const [from, to] = eventWindow(q.when);
  const budgetCents = Math.round(q.budget * 100);
  const want = q.crew ? CREW_TAGS[q.crew] : [];
  const list = events
    .filter((e) => { const t = new Date(e.start).getTime(); return t < to && (e.end ? new Date(e.end).getTime() : t + 7_200_000) >= from; })
    // $0 → free or price not listed; otherwise anything at or under budget
    .filter((e) => (e.free === true || e.free === null || (e.priceCents ?? Infinity) <= budgetCents))
    .filter((e) => (q.food ? e.freeFood : true))
    .filter((e) => (q.q?.trim() ? matchesQuery(e, q.q) : true))
    .filter((e) => (q.inPerson ? !e.online : true))
    .map((e) => ({
      ...e,
      distanceM: q.lat != null && q.lon != null && e.lat != null && e.lon != null ? Math.round(haversineM(q.lat, q.lon, e.lat, e.lon)) : null,
      match: e.tags.filter((t) => want.includes(t)).length,
    }))
    // crew matches and free food float up within each day; otherwise chronological
    .sort((a, b) => a.start.slice(0, 10).localeCompare(b.start.slice(0, 10)) || b.match + Number(b.freeFood) - (a.match + Number(a.freeFood)) || a.start.localeCompare(b.start));
  res.json({ fetchedAt: new Date(at).toISOString(), window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() }, total: list.length, events: list.slice(0, q.limit), sources });
});

// ---- search all of Boston on the web (Gemini + Grounding with Google Search) -----------------------
const SQ = z.object({
  q: z.string().min(2).max(80),
  when: z.enum(["today", "weekend", "week"]).default("week"),
  budget: z.coerce.number().min(0).max(100).default(0),
});
const bostonDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const webCache = new Map<string, { at: number; value: unknown }>();

freeBostonRoutes.get("/boston-events/search", async (req, res) => {
  const q = SQ.parse(req.query);
  const query = cleanQuery(q.q);
  if (query.length < 2) throw new HttpError(400, "Type a little more");
  const budget = q.budget === 0 ? 0 : q.budget <= 10 ? 10 : q.budget <= 25 ? 25 : 40; // bucket so the cache gets hits
  const key = `${query.toLowerCase()}|${q.when}|${budget}|${bostonDay(Date.now())}`;
  const hit = webCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return res.json({ ...(hit.value as object), cached: true });
  if (!geminiEnabled()) throw new HttpError(503, "Web search needs GEMINI_API_KEY on the server");
  const who = (req as any).user?.id ?? req.ip ?? "anon";
  if (!rateLimit(`evsearch:${who}`, 15, 60 * 60_000)) throw new HttpError(429, "That's a lot of searching. Try again in a bit.");
  const [from, to] = eventWindow(q.when);
  let found;
  try { found = await searchBostonWeb({ q: query, from: bostonDay(from), to: bostonDay(to - 1), budget }); }
  catch (e) { console.warn("[events] web search failed:", (e as Error).message); throw new HttpError(502, "Web search didn't answer. Try again in a moment."); }
  const value = { query, ...found };
  if (webCache.size > 200) webCache.delete(webCache.keys().next().value!);
  webCache.set(key, { at: Date.now(), value });
  res.json({ ...value, cached: false });
});

// ---- explore nearby (Stop Planner): tourist spots with today's hours -------------------------------
// coordinates must be strings, or opening_hours silently falls back to 6 AM-6 PM for sunrise/sunset
const ohCache = new Map<string, any>();
function parseHours(h: string) {
  if (!ohCache.has(h)) {
    try {
      ohCache.set(h, new opening_hours(h, { lat: "42.36", lon: "-71.06", address: { country_code: "us", state: "Massachusetts" } } as any, { mode: 0, tag_key: "opening_hours" } as any));
    } catch { ohCache.set(h, null); }
  }
  return ohCache.get(h);
}
const clock12 = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined, timeZone: "America/New_York" });

/** Today's hours, open now, and the next change, in Boston time (the server runs with TZ=America/New_York). */
export function placeHours(hours: string | null, note: string | undefined, now = new Date()) {
  const base = { openNow: null as boolean | null, allDay: false, today: null as string | null, next: null as string | null, note: note ?? null };
  if (!hours) return base;
  if (hours === "24/7") return { ...base, openNow: true, allDay: true, today: "Open 24 hours" };
  const oh = parseHours(hours);
  if (!oh) return base;
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const spans: [Date, Date][] = oh.getOpenIntervals(start, end);
  const today = spans.length
    ? spans.map(([a, b]) => `${clock12(a)}–${b.getTime() >= end.getTime() - 60_000 ? "midnight" : clock12(b)}`).join(", ")
    : "Closed today";
  const openNow: boolean = oh.getState(now);
  const nx: Date | undefined = oh.getNextChange(now);
  let next: string | null = null;
  if (nx) {
    const days = Math.round((new Date(nx).setHours(0, 0, 0, 0) - start.getTime()) / 86_400_000);
    const when = days === 0 ? "" : days === 1 ? " tomorrow" : days < 7 ? ` ${nx.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" })}` : ` ${nx.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}`;
    next = `${openNow ? "Closes" : "Opens"} ${clock12(nx)}${when}`;
  }
  return { ...base, openNow, today, next };
}

const XQ = z.object({
  cats: z.string().max(100).optional(),
  lat: z.coerce.number().optional(),
  lon: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(12).default(6),
});

freeBostonRoutes.get("/explore-nearby", (req, res) => {
  const q = XQ.parse(req.query);
  const known = new Set(FREE_CATS.map((c) => c.id));
  const cats = (q.cats ?? "").split(",").filter((c) => known.has(c as any));
  const from = q.lat != null && q.lon != null ? { lat: q.lat, lon: q.lon } : { lat: 42.3564, lon: -71.0624 }; // Park Street
  const now = new Date();
  const list = FREE_PLACES
    .filter((p) => !cats.length || cats.includes(p.cat))
    .map((p) => {
      const st = stationById.get(p.stationId);
      const d = haversineM(from.lat, from.lon, p.lat, p.lon);
      return {
        id: p.id, name: p.name, cat: p.cat, blurb: p.blurb, costCents: p.costCents, costNote: p.costNote ?? null,
        lat: p.lat, lon: p.lon, stationId: p.stationId, station: st?.name ?? null,
        lines: (st?.routes ?? []).map((r) => routeById.get(r)).filter(Boolean).map((r) => ({ id: r!.id, short: r!.short, color: r!.color })),
        distanceM: Math.round(d), walkMin: walkMinutes(d),
        hours: placeHours(p.hours, p.hoursNote, now),
      };
    })
    // nearest first, but a spot that's closed right now counts as 25 walking minutes farther
    .sort((a, b) => {
      const score = (x: typeof a) => x.walkMin + (x.hours.openNow === false ? 25 : x.hours.openNow === null ? 3 : 0);
      return score(a) - score(b);
    });
  res.json({ cats: FREE_CATS, total: list.length, places: list.slice(0, q.limit) });
});
