/**
 * Boston events for $0 Boston, from official feeds only:
 *  - Meetup: each group's public iCal feed           https://www.meetup.com/<urlname>/events/ical/
 *  - Luma: each calendar's public iCal feed          https://api.lu.ma/ics/get?entity=calendar&id=<cal-id>
 *  - Eventbrite: API v3 events by organizer          needs EVENTBRITE_TOKEN (public search was retired in 2020)
 *  - Campus: Localist university calendars (public JSON API, has a free flag and coordinates)
 * Sources live in data/event-sources.json. Results are cached for 15 minutes; a failing source never breaks the others.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "../config.js";
import { geocodeAddress } from "../lib/external.js";
import { nearestStations, routeById } from "../lib/static.js";

export type EventSource = "meetup" | "luma" | "eventbrite" | "campus";

export interface BostonEvent {
  id: string;
  source: EventSource;
  sourceName: string;
  title: string;
  start: string; // ISO UTC
  end: string | null;
  url: string | null;
  venue: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  online: boolean;
  /** true = free, false = paid, null = the feed doesn't say */
  free: boolean | null;
  priceCents: number | null;
  freeFood: boolean;
  tags: string[];
  summary: string | null;
  station?: { id: string; name: string; distanceM: number; lines: { id: string; short: string; color: string }[] } | null;
}

// ---- iCal ----------------------------------------------------------------------------------
export interface IcsEvent { [k: string]: { value: string; params: Record<string, string> } }

export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: IcsEvent[] = [];
  let cur: IcsEvent | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...rawParams] = line.slice(0, i).split(";");
    const params: Record<string, string> = {};
    for (const p of rawParams) { const [k, v] = p.split("="); if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, ""); }
    cur[name.toUpperCase()] = { value: line.slice(i + 1), params };
  }
  return out;
}

export const icsText = (s: string | undefined) =>
  s == null ? null : s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim() || null;

/** Wall-clock time in an IANA zone → UTC Date. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass settles DST edges
  return new Date(t);
}

export function icsDate(v: { value: string; params: Record<string, string> } | undefined): Date | null {
  if (!v) return null;
  const m = v.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return zonedToUtc(+y, +mo, +d, +h, +mi, +s, v.params.TZID || "America/New_York");
}

// ---- text signals -----------------------------------------------------------------------------
const TAGS: [string, RegExp][] = [
  ["tech", /\b(ai|ml|tech|startup|hack|developer|coding|python|java|data|robot|software|founder|llm|crypto)\b/i],
  ["career", /\b(career|network(ing)?|recruit|job|resume|founders?|pitch|investor|mixer)\b/i],
  ["social", /\b(social|meet ?up|friends|connection|hangout|mixer|trivia|game night|board games?)\b/i],
  ["arts", /\b(art|gallery|museum|exhibit|film|movie|theat(er|re)|poetry|book|reading|writing|craft)\b/i],
  ["music", /\b(music|concert|jazz|dj|band|open mic|karaoke|choir|live set)\b/i],
  ["outdoors", /\b(hike|walk|run|park|outdoor|bike|kayak|picnic|garden)\b/i],
  ["food", /\b(food|dinner|brunch|lunch|coffee|tasting|potluck|cook|pizza|tea)\b/i],
  ["wellness", /\b(yoga|meditat|wellness|mindful|fitness|sober)\b/i],
  ["learning", /\b(talk|lecture|workshop|seminar|class|panel|colloquium|course)\b/i],
];
const FREE_FOOD = /\b(free (food|pizza|lunch|dinner|snacks|drinks)|pizza|food (will be |is )?(provided|served)|refreshments|snacks (will be )?provided|light bites|(lunch|dinner|breakfast|drinks) (is |will be )?provided|bagels|donuts)\b/i;
const ONLINE = /\b(zoom|online|virtual|google meet|teams meeting|livestream|webinar)\b/i;

export function tagsFor(text: string) { return TAGS.filter(([, re]) => re.test(text)).map(([t]) => t); }
export const hasFreeFood = (text: string) => FREE_FOOD.test(text);

export function priceFromText(text: string): { free: boolean | null; priceCents: number | null } {
  const dollars = [...text.matchAll(/\$\s?(\d{1,3}(?:\.\d{2})?)/g)].map((m) => Math.round(+m[1] * 100)).filter((c) => c > 0);
  if (/\bfree\b/i.test(text) && !dollars.length) return { free: true, priceCents: 0 };
  if (dollars.length) return { free: false, priceCents: Math.min(...dollars) };
  if (/\bfree\b/i.test(text)) return { free: true, priceCents: 0 };
  return { free: null, priceCents: null };
}

// ---- per-source normalizers (pure, tested) ----------------------------------------------------
export function fromIcs(text: string, source: "meetup" | "luma", sourceName: string): BostonEvent[] {
  return parseIcs(text).flatMap((e) => {
    const start = icsDate(e.DTSTART);
    if (!start) return [];
    const title = icsText(e.SUMMARY?.value) ?? "Untitled event";
    const desc = icsText(e.DESCRIPTION?.value) ?? "";
    const loc = icsText(e.LOCATION?.value);
    const url = icsText(e.URL?.value) ?? desc.match(/https?:\/\/\S+/)?.[0] ?? null;
    const geo = e.GEO?.value.split(/[;,]/).map(Number);
    const all = `${title}\n${desc}`;
    const [venue, ...rest] = (loc ?? "").split(",").map((x) => x.trim());
    return [{
      id: `${source}:${e.UID?.value ?? `${title}-${start.toISOString()}`}`,
      source, sourceName, title,
      start: start.toISOString(), end: icsDate(e.DTEND)?.toISOString() ?? null,
      url, venue: venue || null, address: rest.length ? rest.join(", ") : loc,
      lat: geo && geo.length === 2 && geo.every(Number.isFinite) ? geo[0] : null,
      lon: geo && geo.length === 2 && geo.every(Number.isFinite) ? geo[1] : null,
      online: ONLINE.test(loc ?? "") || (!loc && ONLINE.test(desc)),
      ...priceFromText(all),
      freeFood: hasFreeFood(all), tags: tagsFor(all), summary: desc.slice(0, 280) || null,
    }];
  });
}

export function fromEventbrite(json: any, sourceName: string): BostonEvent[] {
  return (json?.events ?? []).map((e: any) => {
    const all = `${e.name?.text ?? ""}\n${e.summary ?? ""}`;
    const min = e.ticket_availability?.minimum_ticket_price?.major_value;
    const lat = e.venue?.latitude != null ? +e.venue.latitude : null, lon = e.venue?.longitude != null ? +e.venue.longitude : null;
    return {
      id: `eventbrite:${e.id}`, source: "eventbrite", sourceName,
      title: e.name?.text ?? "Untitled event", start: new Date(e.start?.utc).toISOString(), end: e.end?.utc ? new Date(e.end.utc).toISOString() : null,
      url: e.url ?? null, venue: e.venue?.name ?? null, address: e.venue?.address?.localized_address_display ?? null,
      lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null, online: !!e.online_event,
      free: typeof e.is_free === "boolean" ? e.is_free : null,
      priceCents: e.is_free ? 0 : min != null ? Math.round(+min * 100) : null,
      freeFood: hasFreeFood(all), tags: tagsFor(all), summary: e.summary ?? null,
    } as BostonEvent;
  });
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export function fromLocalist(json: any, sourceName: string, now = Date.now()): BostonEvent[] {
  return (json?.events ?? []).flatMap((w: any) => {
    const e = w.event ?? w;
    const inst = (e.event_instances ?? []).map((i: any) => i.event_instance ?? i).find((i: any) => new Date(i.end ?? i.start).getTime() >= now) ?? (e.event_instances?.[0]?.event_instance);
    if (!inst?.start) return [];
    const desc = stripHtml(e.description_text ?? e.description ?? "");
    const types = (e.filters?.event_types ?? []).map((t: any) => t.name).join(" ");
    const all = `${e.title}\n${desc}\n${types}`;
    const lat = e.geo?.latitude != null ? +e.geo.latitude : null, lon = e.geo?.longitude != null ? +e.geo.longitude : null;
    const cost = typeof e.ticket_cost === "string" ? priceFromText(e.ticket_cost) : { free: null, priceCents: null };
    return [{
      id: `campus:${sourceName}:${e.id}:${inst.start}`, source: "campus", sourceName, title: e.title,
      start: new Date(inst.start).toISOString(), end: inst.end ? new Date(inst.end).toISOString() : null,
      url: e.localist_url ?? e.url ?? null, venue: e.location_name || e.location || null, address: e.address || null,
      lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null,
      online: !!e.experience && /virtual/i.test(e.experience),
      free: e.free === true ? true : cost.free, priceCents: e.free === true ? 0 : cost.priceCents,
      freeFood: hasFreeFood(all), tags: tagsFor(all), summary: desc.slice(0, 280) || null,
    } as BostonEvent];
  });
}

// ---- fetching -------------------------------------------------------------------------------
interface Sources {
  meetup: { urlname: string; name: string }[];
  luma: { id: string; name: string }[];
  eventbrite: { organizers: { id: string; name: string }[] };
  campus: { id: string; name: string; base: string }[];
}
const loadSources = (): Sources => {
  try { return JSON.parse(readFileSync(resolve(DATA_DIR, "event-sources.json"), "utf8")); }
  catch { return { meetup: [], luma: [], eventbrite: { organizers: [] }, campus: [] }; }
};

const UA = { "User-Agent": "LineCollector/0.1 (student events map)" };
const get = async (url: string, headers: Record<string, string> = {}) => {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
};

export interface SourceStatus { source: EventSource; name: string; ok: boolean; count: number; error?: string }

const geoCache = new Map<string, { lat: number; lon: number } | null>();
async function geocodeSome(events: BostonEvent[], budget = 25) {
  for (const e of events) {
    if (e.lat != null || e.online || !e.address || !/\d/.test(e.address)) continue;
    if (!geoCache.has(e.address)) {
      if (budget-- <= 0) break;
      const g = await geocodeAddress(e.address);
      geoCache.set(e.address, g ? { lat: g.lat, lon: g.lon } : null);
    }
    const g = geoCache.get(e.address);
    if (g) { e.lat = g.lat; e.lon = g.lon; }
  }
}

function attachStation(e: BostonEvent) {
  if (e.lat == null || e.lon == null) return e;
  const n = nearestStations(e.lat, e.lon, 1)[0];
  e.station = n && n.distanceM < 3000
    ? { id: n.station.id, name: n.station.name, distanceM: n.distanceM, lines: n.station.routes.map((r) => routeById.get(r)).filter(Boolean).map((r) => ({ id: r!.id, short: r!.short, color: r!.color })) }
    : null;
  return e;
}

interface Snapshot { at: number; events: BostonEvent[]; sources: SourceStatus[] }
let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;
const TTL = 15 * 60_000;

async function refresh(): Promise<Snapshot> {
  const src = loadSources();
  const token = process.env.EVENTBRITE_TOKEN;
  const jobs: { source: EventSource; name: string; run: () => Promise<BostonEvent[]> }[] = [
    ...src.meetup.map((g) => ({ source: "meetup" as const, name: g.name, run: async () => fromIcs(await (await get(`https://www.meetup.com/${encodeURIComponent(g.urlname)}/events/ical/`)).text(), "meetup", g.name) })),
    ...src.luma.map((c) => ({ source: "luma" as const, name: c.name, run: async () => fromIcs(await (await get(`https://api.lu.ma/ics/get?entity=calendar&id=${encodeURIComponent(c.id)}`)).text(), "luma", c.name) })),
    ...src.campus.map((c) => ({ source: "campus" as const, name: c.name, run: async () => fromLocalist(await (await get(`${c.base}/api/2/events?days=14&pp=100`)).json(), c.name) })),
    ...(token
      ? src.eventbrite.organizers.map((o) => ({
          source: "eventbrite" as const, name: o.name,
          run: async () => fromEventbrite(await (await get(`https://www.eventbriteapi.com/v3/organizers/${encodeURIComponent(o.id)}/events/?status=live&order_by=start_asc&expand=venue,ticket_availability`, { Authorization: `Bearer ${token}` })).json(), o.name),
        }))
      : []),
  ];
  const results = await Promise.allSettled(jobs.map((j) => j.run()));
  const sources: SourceStatus[] = [];
  let events: BostonEvent[] = [];
  results.forEach((r, i) => {
    const j = jobs[i];
    if (r.status === "fulfilled") { sources.push({ source: j.source, name: j.name, ok: true, count: r.value.length }); events.push(...r.value); }
    else sources.push({ source: j.source, name: j.name, ok: false, count: 0, error: String((r.reason as Error)?.message ?? r.reason).slice(0, 120) });
  });
  if (!token) sources.push({ source: "eventbrite", name: "Eventbrite", ok: false, count: 0, error: "Add EVENTBRITE_TOKEN and organizer IDs to turn this on" });

  const now = Date.now(), horizon = now + 14 * 86_400_000;
  const seen = new Set<string>();
  events = events
    .filter((e) => { const t = new Date(e.start).getTime(); const end = e.end ? new Date(e.end).getTime() : t + 2 * 3_600_000; return end >= now && t <= horizon; })
    .filter((e) => { const k = `${e.title.toLowerCase()}|${e.start.slice(0, 13)}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.start.localeCompare(b.start));
  await geocodeSome(events);
  events.forEach(attachStation);
  return { at: Date.now(), events, sources };
}

export async function getBostonEvents(): Promise<Snapshot> {
  if (cache && Date.now() - cache.at < TTL) return cache;
  if (!inflight) inflight = refresh().then((c) => { cache = c; return c; }).finally(() => { inflight = null; });
  return inflight;
}

/** Every word of the query appears somewhere in the event (title, group, venue, tags, description). */
export function matchesQuery(e: BostonEvent, q: string) {
  const hay = `${e.title} ${e.sourceName} ${e.venue ?? ""} ${e.address ?? ""} ${e.tags.join(" ")} ${e.freeFood ? "free food pizza" : ""} ${e.summary ?? ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
