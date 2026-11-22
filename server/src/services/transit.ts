/**
 * MBTA poller. Runs on its own timers, independent of requests:
 *  - vehicles every 10–15 s → train_positions (hypertable) + in-memory snapshot for the map
 *  - predictions every 30 s → train_predictions + line_metrics (delay, chaos) hypertables
 *  - alerts every 2 min → alerts_current (shutdowns, shuttles, delays)
 * If the MBTA API is down, the app keeps serving the last known data.
 */
import { config } from "../config.js";
import type { Db } from "../db/index.js";
import { ROUTE_IDS, routeById } from "../lib/static.js";
import { clamp } from "../lib/util.js";

const BASE = "https://api-v3.mbta.com";

export interface Vehicle { id: string; routeId: string; lat: number; lon: number; bearing: number; directionId: number; stopId: string | null; status: string; label: string; updatedAt: string }
export interface Alert { id: string; routes: string[]; stops: string[]; effect: string; severity: number; header: string; description: string | null; lifecycle: string; activeFrom: string | null; activeTo: string | null }
export interface LineStatus { routeId: string; name: string; color: string; vehicles: number; avgDelayS: number | null; p90DelayS: number | null; maxSeverity: number; alertCount: number; shuttle: boolean; chaos: number; alerts: Alert[]; updatedAt: string | null }

const DISRUPTIVE = new Set(["SHUTTLE", "SUSPENSION", "STATION_CLOSURE", "STOP_CLOSURE", "DETOUR", "DELAY", "SERVICE_CHANGE", "SNOW_ROUTE", "TRACK_CHANGE"]);
const SHUTDOWN = new Set(["SHUTTLE", "SUSPENSION"]);

export const live = {
  vehicles: [] as Vehicle[],
  vehiclesAt: null as string | null,
  alerts: [] as Alert[],
  alertsAt: null as string | null,
  delays: {} as Record<string, { avg: number | null; p90: number | null; n: number }>,
  metricsAt: null as string | null,
  lastError: null as string | null,
};

async function mbta(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${config.mbta.apiKey ? `${sep}api_key=${config.mbta.apiKey}` : ""}`, {
    headers: { Accept: "application/vnd.api+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`MBTA ${res.status} ${path.slice(0, 60)}`);
  return res.json() as Promise<any>;
}

/** Chaos Score 0–100 from live delays, alert severity and active shutdowns. */
export function chaosScore(avgDelayS: number | null, maxSeverity: number, shuttle: boolean): number {
  const delayPart = clamp(((avgDelayS ?? 0) / 60) * 8, 0, 40);
  const alertPart = clamp(maxSeverity * 4, 0, 40);
  const shutdownPart = shuttle ? 25 : 0;
  return Math.round(clamp(delayPart + alertPart + shutdownPart, 0, 100));
}

export function lineStatuses(): LineStatus[] {
  return ROUTE_IDS.map((id) => {
    const r = routeById.get(id)!;
    const alerts = live.alerts.filter((a) => a.routes.includes(id) && DISRUPTIVE.has(a.effect));
    const maxSeverity = alerts.reduce((m, a) => Math.max(m, a.severity || 0), 0);
    const shuttle = alerts.some((a) => SHUTDOWN.has(a.effect));
    const d = live.delays[id];
    return {
      routeId: id,
      name: r.short,
      color: r.color,
      vehicles: live.vehicles.filter((v) => v.routeId === id).length,
      avgDelayS: d?.avg ?? null,
      p90DelayS: d?.p90 ?? null,
      maxSeverity,
      alertCount: alerts.length,
      shuttle,
      chaos: chaosScore(d?.avg ?? null, maxSeverity, shuttle),
      alerts,
      updatedAt: live.metricsAt || live.alertsAt,
    };
  });
}

export const shutdownLines = () => lineStatuses().filter((l) => l.shuttle).map((l) => l.routeId);

async function pollVehicles(db: Db) {
  const j = await mbta(
    `/vehicles?filter[route]=${ROUTE_IDS.join(",")}&fields[vehicle]=latitude,longitude,bearing,current_status,direction_id,label,updated_at`,
  );
  const now = new Date();
  live.vehicles = j.data
    .filter((v: any) => v.attributes.latitude != null)
    .map((v: any) => ({
      id: v.id,
      routeId: v.relationships.route.data.id,
      lat: v.attributes.latitude,
      lon: v.attributes.longitude,
      bearing: v.attributes.bearing ?? 0,
      directionId: v.attributes.direction_id,
      stopId: v.relationships.stop?.data?.id ?? null,
      status: v.attributes.current_status,
      label: v.attributes.label,
      updatedAt: v.attributes.updated_at,
    }));
  live.vehiclesAt = now.toISOString();
  if (live.vehicles.length) {
    const values: unknown[] = [];
    const rows = live.vehicles.map((v, i) => {
      values.push(now, v.routeId, v.id, v.directionId, v.lat, v.lon, v.bearing, v.stopId, v.status);
      const o = i * 9;
      return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9})`;
    });
    await db.query(
      `INSERT INTO train_positions (ts, route_id, vehicle_id, direction_id, lat, lon, bearing, stop_id, status) VALUES ${rows.join(",")}`,
      values,
    );
  }
}

async function pollAlerts(db: Db) {
  const j = await mbta(
    `/alerts?filter[route]=${ROUTE_IDS.join(",")}&filter[datetime]=NOW&fields[alert]=effect,severity,header,description,lifecycle,active_period,informed_entity`,
  );
  const alerts: Alert[] = j.data.map((a: any) => {
    const ents = a.attributes.informed_entity || [];
    const period = (a.attributes.active_period || [])[0] || {};
    return {
      id: a.id,
      routes: [...new Set(ents.map((e: any) => e.route).filter((r: string) => ROUTE_IDS.includes(r)))] as string[],
      stops: [...new Set(ents.map((e: any) => e.stop).filter(Boolean))] as string[],
      effect: a.attributes.effect,
      severity: a.attributes.severity ?? 0,
      header: a.attributes.header,
      description: a.attributes.description,
      lifecycle: a.attributes.lifecycle,
      activeFrom: period.start ?? null,
      activeTo: period.end ?? null,
    };
  });
  live.alerts = alerts.filter((a) => a.routes.length);
  live.alertsAt = new Date().toISOString();
  await db.tx(async (q) => {
    await q.query("DELETE FROM alerts_current");
    for (const a of live.alerts) {
      await q.query(
        `INSERT INTO alerts_current (id, routes, stops, effect, severity, header, description, lifecycle, active_from, active_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [a.id, a.routes, a.stops.slice(0, 200), a.effect, a.severity, a.header, a.description, a.lifecycle, a.activeFrom, a.activeTo],
      );
    }
  });
}

async function pollPredictions(db: Db) {
  const j = await mbta(
    `/predictions?filter[route]=${ROUTE_IDS.join(",")}&include=schedule` +
      `&fields[prediction]=arrival_time,departure_time,direction_id,schedule_relationship&fields[schedule]=arrival_time,departure_time`,
  );
  const sched = new Map<string, any>();
  for (const inc of j.included || []) if (inc.type === "schedule") sched.set(inc.id, inc.attributes);
  const now = new Date();
  const horizon = now.getTime() + 30 * 60_000;
  const byTrip = new Map<string, any>(); // keep each trip's next stop only
  for (const p of j.data) {
    const at = p.attributes.departure_time || p.attributes.arrival_time;
    if (!at) continue;
    const t = new Date(at).getTime();
    if (t < now.getTime() - 60_000 || t > horizon) continue;
    const tripId = p.relationships.trip?.data?.id;
    if (!tripId) continue;
    const prev = byTrip.get(tripId);
    if (prev && prev.t <= t) continue;
    // added/reverse trips have no real schedule to be late against
    const rel = p.attributes.schedule_relationship;
    const s = rel && rel !== "SCHEDULED" ? null : sched.get(p.relationships.schedule?.data?.id);
    const sAt = s ? s.departure_time || s.arrival_time : null;
    byTrip.set(tripId, {
      t,
      routeId: p.relationships.route.data.id,
      tripId,
      stopId: p.relationships.stop?.data?.id ?? null,
      directionId: p.attributes.direction_id,
      predicted: new Date(at),
      scheduled: sAt ? new Date(sAt) : null,
      delay: sAt ? Math.round((t - new Date(sAt).getTime()) / 1000) : null,
    });
  }
  const rows = [...byTrip.values()];
  const delays: typeof live.delays = {};
  for (const id of ROUTE_IDS) {
    const ds = rows
      .filter((r) => r.routeId === id && r.delay != null && Math.abs(r.delay) <= 1800)
      .map((r) => Math.max(0, r.delay as number))
      .sort((a, b) => a - b);
    delays[id] = {
      avg: ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null,
      p90: ds.length ? ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.9))] : null,
      n: ds.length,
    };
  }
  live.delays = delays;
  live.metricsAt = now.toISOString();

  if (rows.length) {
    const values: unknown[] = [];
    const sql = rows.map((r, i) => {
      values.push(now, r.routeId, r.tripId, r.stopId, r.directionId, r.predicted, r.scheduled, r.delay);
      const o = i * 8;
      return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`;
    });
    await db.query(
      `INSERT INTO train_predictions (ts, route_id, trip_id, stop_id, direction_id, predicted_at, scheduled_at, delay_s) VALUES ${sql.join(",")}`,
      values,
    );
  }
  for (const l of lineStatuses()) {
    await db.query(
      `INSERT INTO line_metrics (ts, route_id, vehicles, avg_delay_s, p90_delay_s, max_severity, alert_count, shuttle, chaos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [now, l.routeId, l.vehicles, l.avgDelayS, l.p90DelayS, l.maxSeverity, l.alertCount, l.shuttle, l.chaos],
    );
  }
}

/** Warm the in-memory state from the database (last known data) at boot. */
async function warmFromDb(db: Db) {
  const alerts = await db.query("SELECT * FROM alerts_current");
  live.alerts = alerts.map((a: any) => ({
    id: a.id, routes: a.routes, stops: a.stops, effect: a.effect, severity: a.severity, header: a.header,
    description: a.description, lifecycle: a.lifecycle, activeFrom: a.active_from, activeTo: a.active_to,
  }));
  const last = await db.query(
    `SELECT DISTINCT ON (route_id) route_id, avg_delay_s, p90_delay_s, ts FROM line_metrics ORDER BY route_id, ts DESC`,
  );
  for (const m of last) live.delays[m.route_id] = { avg: m.avg_delay_s, p90: m.p90_delay_s, n: 0 };
}

export async function startPoller(db: Db) {
  await warmFromDb(db).catch(() => {});
  if (!config.mbta.pollerEnabled) {
    console.log("[poller] disabled (POLLER_ENABLED=false)");
    return;
  }
  const loop = (name: string, fn: () => Promise<void>, every: number) => {
    const run = async () => {
      try {
        await fn();
        live.lastError = null;
      } catch (e) {
        live.lastError = `${name}: ${(e as Error).message}`;
        console.warn(`[poller] ${live.lastError}`);
      } finally {
        setTimeout(run, every).unref();
      }
    };
    run();
  };
  loop("alerts", () => pollAlerts(db), config.mbta.alertsEveryMs);
  setTimeout(() => loop("vehicles", () => pollVehicles(db), config.mbta.vehiclesEveryMs), 1500).unref();
  setTimeout(() => loop("predictions", () => pollPredictions(db), config.mbta.metricsEveryMs), 3000).unref();
  // PGlite has no retention policies: prune raw position rows older than 2 days hourly.
  if (!db.timescale) {
    setInterval(() => {
      db.query("DELETE FROM train_positions WHERE ts < now() - interval '2 days'").catch(() => {});
      db.query("DELETE FROM train_predictions WHERE ts < now() - interval '7 days'").catch(() => {});
    }, 3600_000).unref();
  }
  console.log("[poller] MBTA poller running");
}

/** Last train today from a station on a route (scheduled), for the ride-split nudge. */
export async function lastDepartures(stationId: string): Promise<{ routeId: string; directionId: number; headsign: string; at: string }[]> {
  try {
    const now = new Date();
    // MBTA service day runs past midnight; before 3 AM use yesterday's service date
    const svc = new Date(now);
    if (now.getHours() < 3) svc.setDate(svc.getDate() - 1);
    const date = `${svc.getFullYear()}-${String(svc.getMonth() + 1).padStart(2, "0")}-${String(svc.getDate()).padStart(2, "0")}`;
    const j = await mbta(
      `/schedules?filter[stop]=${stationId}&filter[date]=${date}&filter[route]=${ROUTE_IDS.join(",")}&include=trip&fields[schedule]=departure_time,direction_id&fields[trip]=headsign`,
    );
    const trips = new Map<string, string>();
    for (const inc of j.included || []) if (inc.type === "trip") trips.set(inc.id, inc.attributes.headsign);
    const last = new Map<string, any>();
    for (const s of j.data) {
      const at = s.attributes.departure_time;
      if (!at) continue;
      const key = `${s.relationships.route.data.id}|${s.attributes.direction_id}`;
      const prev = last.get(key);
      if (!prev || new Date(at) > new Date(prev.at))
        last.set(key, { routeId: s.relationships.route.data.id, directionId: s.attributes.direction_id, headsign: trips.get(s.relationships.trip.data.id) || "", at });
    }
    return [...last.values()];
  } catch {
    return [];
  }
}
