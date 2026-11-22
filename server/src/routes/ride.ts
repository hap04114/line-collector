/** Ride: live trains, line chaos and reliability (Tiger Data), and the Late-Night Ride Split. */
import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { requireUser } from "../auth.js";
import { schoolById } from "../data/schools.js";
import { getWeather } from "../lib/external.js";
import { routeById, stationById, ROUTE_IDS } from "../lib/static.js";
import { HttpError, firstName, newId, rateLimit } from "../lib/util.js";
import { NEIGHBORHOODS } from "../data/neighborhoods.js";
import { lastDepartures, lineStatuses, live } from "../services/transit.js";

export const rideRoutes = Router();

rideRoutes.get("/trains", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ at: live.vehiclesAt, vehicles: live.vehicles });
});

rideRoutes.get("/lines/status", async (_req, res) => {
  res.json({ lines: lineStatuses(), weather: await getWeather(), updatedAt: live.metricsAt, pollerError: live.lastError });
});

rideRoutes.get("/weather", async (_req, res) => res.json(await getWeather()));

/** Delay by hour of day, from the 15-minute continuous aggregate. */
rideRoutes.get("/lines/:id/reliability", async (req, res) => {
  const id = req.params.id;
  if (!ROUTE_IDS.includes(id)) throw new HttpError(404, "Unknown line");
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  const db = await getDb();
  const byHour = await db.query(
    `SELECT extract(hour FROM bucket AT TIME ZONE 'America/New_York')::int AS hour,
            avg(avg_delay_s)::float8 AS avg_delay_s, avg(chaos)::float8 AS chaos, count(*)::int AS samples
     FROM line_metrics_15m WHERE route_id=$1 AND bucket > now() - ($2 || ' days')::interval
     GROUP BY 1 ORDER BY 1`,
    [id, String(days)],
  );
  const byDow = await db.query(
    `SELECT extract(dow FROM bucket AT TIME ZONE 'America/New_York')::int AS dow,
            extract(hour FROM bucket AT TIME ZONE 'America/New_York')::int AS hour,
            avg(avg_delay_s)::float8 AS avg_delay_s, count(*)::int AS samples
     FROM line_metrics_15m WHERE route_id=$1 AND bucket > now() - ($2 || ' days')::interval AND avg_delay_s IS NOT NULL
     GROUP BY 1, 2 HAVING count(*) >= 2 ORDER BY avg(avg_delay_s) DESC LIMIT 1`,
    [id, String(days)],
  );
  const span = await db.one(`SELECT min(ts) AS first, count(*)::int AS n FROM line_metrics WHERE route_id=$1`, [id]);
  let honest: string | null = null;
  const w = byDow[0];
  if (w && w.avg_delay_s >= 60) {
    const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][w.dow];
    const part = w.hour < 12 ? "mornings" : w.hour < 17 ? "afternoons" : w.hour < 21 ? "evenings" : "nights";
    honest = `${routeById.get(id)!.short} runs about ${Math.round(w.avg_delay_s / 60)} min late ${dayName} ${part} (around ${((w.hour + 11) % 12) + 1} ${w.hour < 12 ? "AM" : "PM"}).`;
  }
  res.json({ routeId: id, days, byHour, honest, dataSince: span?.first ?? null, samples: span?.n ?? 0, source: db.timescale ? "Tiger Data continuous aggregate line_metrics_15m" : "line_metrics_15m view" });
});

// ---- Late-Night Ride Split ---------------------------------------------------------------------
const AREAS = [...NEIGHBORHOODS.map((n) => n.name), "Brookline", "Newton", "Quincy", "Malden"];

rideRoutes.get("/rides/areas", (_req, res) => res.json({ areas: AREAS }));

rideRoutes.get("/rides", requireUser, async (req, res) => {
  const db = await getDb();
  const near = req.query.near ? String(req.query.near) : null;
  // only verified students from the same school can see and join a ride
  const rows = await db.query(
    `SELECT r.*, u.display_name,
       (SELECT count(*)::int FROM ride_requests q WHERE q.ride_id=r.id AND q.status='accepted') AS taken,
       (SELECT status FROM ride_requests q WHERE q.ride_id=r.id AND q.user_id=$1) AS my_request,
       (SELECT contact FROM ride_requests q WHERE q.ride_id=r.id AND q.user_id=$1 AND q.status='accepted') AS my_contact_ok
     FROM rides r JOIN users u ON u.id=r.user_id
     WHERE r.school_id=$2 AND r.status='open' AND r.depart_at > now() - interval '30 minutes' AND r.depart_at < now() + interval '12 hours'
       AND r.user_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id=$1)
       AND r.user_id NOT IN (SELECT user_id FROM blocks WHERE blocked_id=$1)
       ${near ? "AND r.from_station = $3" : ""}
     ORDER BY r.depart_at LIMIT 30`,
    near ? [req.user.id, req.user.school_id, near] : [req.user.id, req.user.school_id],
  );
  res.json({
    rides: rows.map((r: any) => ({
      id: r.id, from: stationById.get(r.from_station)?.name, fromStation: r.from_station, toArea: r.to_area, departAt: r.depart_at,
      windowMin: r.window_min, seatsLeft: Math.max(0, r.seats - r.taken), note: r.note, poster: firstName(r.display_name),
      mine: r.user_id === req.user.id, myRequest: r.my_request, contact: r.user_id === req.user.id || r.my_contact_ok ? r.contact : null,
    })),
  });
});

rideRoutes.post("/rides", requireUser, async (req, res) => {
  if (!rateLimit(`ride:${req.user.id}`, 6, 6 * 3600_000)) throw new HttpError(429, "Too many rides posted");
  const b = z
    .object({
      fromStation: z.string(),
      toArea: z.string().min(2).max(60),
      departAt: z.string(),
      windowMin: z.number().int().min(5).max(60).default(20),
      seats: z.number().int().min(1).max(4).default(2),
      note: z.string().max(200).optional(),
      contact: z.string().trim().min(3).max(120),
    })
    .parse(req.body);
  if (!stationById.has(b.fromStation)) throw new HttpError(400, "Pickup must be a T station");
  const at = new Date(b.departAt);
  if (!(at.getTime() > Date.now() - 10 * 60_000 && at.getTime() < Date.now() + 12 * 3600_000)) throw new HttpError(400, "Pick a time in the next 12 hours");
  const db = await getDb();
  const id = newId("rd_");
  await db.query(
    `INSERT INTO rides (id, user_id, school_id, from_station, to_area, depart_at, window_min, seats, note, contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, req.user.id, req.user.school_id, b.fromStation, b.toArea, at, b.windowMin, b.seats, b.note ?? null, b.contact],
  );
  res.json({ ok: true, id });
});

rideRoutes.post("/rides/:id/join", requireUser, async (req, res) => {
  const { contact } = z.object({ contact: z.string().trim().min(3).max(120) }).parse(req.body);
  const db = await getDb();
  const r = await db.one("SELECT * FROM rides WHERE id=$1 AND status='open'", [req.params.id]);
  if (!r || r.school_id !== req.user.school_id) throw new HttpError(404, "Ride not found");
  if (r.user_id === req.user.id) throw new HttpError(400, "That's your ride");
  await db.query(`INSERT INTO ride_requests (id, ride_id, user_id, contact) VALUES ($1,$2,$3,$4) ON CONFLICT (ride_id, user_id) DO NOTHING`, [newId("rq_"), r.id, req.user.id, contact]);
  res.json({ ok: true });
});

rideRoutes.get("/rides/mine", requireUser, async (req, res) => {
  const db = await getDb();
  const reqs = await db.query(
    `SELECT q.*, u.display_name, r.to_area, r.from_station, r.depart_at FROM ride_requests q JOIN rides r ON r.id=q.ride_id JOIN users u ON u.id=q.user_id
     WHERE r.user_id=$1 AND r.depart_at > now() - interval '2 hours' ORDER BY q.created_at DESC`,
    [req.user.id],
  );
  res.json({
    incoming: reqs.map((q: any) => ({
      id: q.id, rideId: q.ride_id, from: firstName(q.display_name), status: q.status, toArea: q.to_area,
      station: stationById.get(q.from_station)?.name, departAt: q.depart_at, contact: q.status === "accepted" ? q.contact : null, userId: q.user_id,
    })),
  });
});

rideRoutes.post("/ride-requests/:id/:action", requireUser, async (req, res) => {
  const action = String(req.params.action);
  if (!["accept", "decline"].includes(action)) throw new HttpError(404, "Unknown action");
  const db = await getDb();
  const q = await db.one(`SELECT q.*, r.seats FROM ride_requests q JOIN rides r ON r.id=q.ride_id WHERE q.id=$1 AND r.user_id=$2`, [req.params.id, req.user.id]);
  if (!q) throw new HttpError(404, "Request not found");
  await db.query("UPDATE ride_requests SET status=$2 WHERE id=$1", [q.id, action === "accept" ? "accepted" : "declined"]);
  const taken = await db.one("SELECT count(*)::int AS n FROM ride_requests WHERE ride_id=$1 AND status='accepted'", [q.ride_id]);
  if ((taken?.n ?? 0) >= q.seats) await db.query("UPDATE rides SET status='full' WHERE id=$1", [q.ride_id]);
  res.json({ ok: true });
});

rideRoutes.post("/rides/:id/report", requireUser, async (req, res) => {
  const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
  const db = await getDb();
  await db.query("INSERT INTO reports (id, user_id, target_kind, target_id, reason) VALUES ($1,$2,'ride',$3,$4)", [newId("rp_"), req.user.id, req.params.id, reason ?? null]);
  await db.query("UPDATE rides SET status='hidden' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

rideRoutes.post("/block", requireUser, async (req, res) => {
  const b = z.object({ rideId: z.string().optional(), userId: z.string().optional() }).parse(req.body);
  const db = await getDb();
  let target = b.userId;
  if (!target && b.rideId) target = (await db.one("SELECT user_id FROM rides WHERE id=$1", [b.rideId]))?.user_id;
  if (!target || target === req.user.id) throw new HttpError(400, "Nothing to block");
  await db.query("INSERT INTO blocks (user_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [req.user.id, target]);
  res.json({ ok: true });
});

/** The agent's nudge before the last train. */
rideRoutes.get("/rides/nudge", requireUser, async (req, res) => {
  const stationId = String(req.query.station || "");
  const st = stationById.get(stationId);
  if (!st) throw new HttpError(400, "Unknown station");
  const last = await lastDepartures(stationId);
  const now = Date.now();
  const upcoming = last
    .map((l) => ({ ...l, minutes: Math.round((new Date(l.at).getTime() - now) / 60_000) }))
    .filter((l) => l.minutes > -180)
    .sort((a, b) => a.minutes - b.minutes);
  const soonest = upcoming.find((l) => l.minutes >= 0) ?? null;
  const db = await getDb();
  const rides = await db.query(
    `SELECT to_area, depart_at FROM rides WHERE school_id=$1 AND from_station=$2 AND status='open' AND depart_at BETWEEN now() AND now() + interval '3 hours' ORDER BY depart_at`,
    [req.user.school_id, stationId],
  );
  const school = schoolById(req.user.school_id)!;
  const allGone = upcoming.length > 0 && upcoming.every((l) => l.minutes < 0);
  let message: string | null = null;
  if (soonest && soonest.minutes <= 45) {
    const line = routeById.get(soonest.routeId)!.short;
    message = `Your last ${line} toward ${soonest.headsign} leaves in ${soonest.minutes} minutes.`;
  } else if (allGone) {
    message = `The T is done for the night at ${st.name}.`;
  }
  if (message && rides.length) {
    const r = rides[0] as any;
    const t = new Date(r.depart_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    message += ` ${rides.length} ${school.short} student${rides.length > 1 ? "s are" : " is"} heading to ${r.to_area} at ${t}. Split a ride?`;
  } else if (message) {
    message += " Post a ride split for students from your school?";
  }
  res.json({ station: st.name, lastTrains: upcoming, message, rides: rides.length });
});
