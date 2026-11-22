import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { requireUser } from "../auth.js";
import { SCHOOLS, schoolById } from "../data/schools.js";
import { NEIGHBORHOODS } from "../data/neighborhoods.js";
import { BOSTON_NEIGHBORHOOD_COUNT, NEIGHBORHOOD_META, ROUTES, SHAPES, STATIONS, nearestSchool, nearestStations, rentCache, stationById } from "../lib/static.js";
import { levelFor, weekStart } from "../lib/time.js";
import { HttpError, firstName, rateLimit } from "../lib/util.js";
import { BADGES } from "../services/badges.js";
import { checkIn, partnerStamps, streakStatus } from "../services/checkin.js";
import { activeEvents } from "../services/events.js";
import { CRAVINGS, VIBES, findSpots, getSpot } from "../services/spots.js";
import { lineStatuses } from "../services/transit.js";

export const gameRoutes = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } });

const bucketHour = (timescale: boolean) => (timescale ? "time_bucket(INTERVAL '1 hour', ts)" : "date_trunc('hour', ts)");

// ---- static map layers (cacheable) ------------------------------------------------
gameRoutes.get("/map/static", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.json({
    routes: ROUTES.map((r) => ({ id: r.id, name: r.name, short: r.short, color: r.color, stopIds: r.stopIds })),
    shapes: {
      type: "FeatureCollection",
      features: SHAPES.map((s) => ({
        type: "Feature",
        properties: { routeId: s.routeId, color: ROUTES.find((r) => r.id === s.routeId)!.color },
        geometry: { type: "LineString", coordinates: s.coords },
      })),
    },
    stations: STATIONS.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, routes: s.routes, neighborhoodId: s.neighborhoodId, municipality: s.municipality })),
    schools: SCHOOLS,
    neighborhoods: NEIGHBORHOODS,
    cravings: Object.entries(CRAVINGS).map(([id, c]) => ({ id, label: c.label })),
    vibes: VIBES,
  });
});

// ---- personal map state: collected stops, weekly owners ---------------------------
gameRoutes.get("/map", async (req, res) => {
  const db = await getDb();
  const ws = weekStart();
  const owners = await db.query(
    `SELECT DISTINCT ON (station_id) station_id, school_id, count(*)::int AS n
     FROM checkins WHERE ts >= $1 AND verified IN ('verified','unchecked') GROUP BY station_id, school_id
     ORDER BY station_id, count(*) DESC`,
    [ws],
  );
  let collected: string[] = [];
  let stamps: string[] = [];
  if (req.user) {
    collected = (await db.query("SELECT station_id FROM collections WHERE user_id=$1", [req.user.id])).map((r: any) => r.station_id);
    stamps = (await db.query("SELECT neighborhood_id FROM user_neighborhoods WHERE user_id=$1", [req.user.id])).map((r: any) => r.neighborhood_id);
  }
  res.json({
    collected,
    stamps,
    weekOwners: Object.fromEntries(owners.map((o: any) => [o.station_id, { school: o.school_id, checkins: o.n }])),
    lines: lineStatuses().map((l) => ({ routeId: l.routeId, chaos: l.chaos, shuttle: l.shuttle, alertCount: l.alertCount })),
  });
});

gameRoutes.get("/nearby", (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, "lat/lon required");
  const st = nearestStations(lat, lon, 3);
  const sc = nearestSchool(lat, lon);
  res.json({
    stations: st.map((s) => ({ id: s.station.id, name: s.station.name, routes: s.station.routes, distanceM: s.distanceM })),
    campus: { id: sc.school.id, name: sc.school.name, distanceM: sc.distanceM },
  });
});

gameRoutes.get("/stations/:id", async (req, res) => {
  const st = stationById.get(req.params.id);
  if (!st) throw new HttpError(404, "Unknown station");
  const db = await getDb();
  const ws = weekStart();
  const [tips, week, mine] = await Promise.all([
    db.one("SELECT count(*)::int AS n FROM tips WHERE station_id=$1 AND status='live'", [st.id]),
    db.query(
      `SELECT school_id, count(*)::int AS n FROM checkins WHERE station_id=$1 AND ts >= $2 AND verified IN ('verified','unchecked') GROUP BY school_id ORDER BY n DESC`,
      [st.id, ws],
    ),
    req.user ? db.one("SELECT first_ts FROM collections WHERE user_id=$1 AND station_id=$2", [req.user.id, st.id]) : null,
  ]);
  const cache = rentCache();
  const zip = cache.stationZip[st.id];
  const rent = zip && cache.byZip[zip] ? { zip, ...cache.byZip[zip], source: "RentCast" } : zip ? { zip, median: null } : null;
  const nb = st.neighborhoodId ? NEIGHBORHOOD_META.get(st.neighborhoodId) : null;
  const away = req.user ? SCHOOLS.find((s) => s.id !== req.user.school_id && s.homeStations.includes(st.id)) : null;
  res.json({
    station: st,
    neighborhood: nb,
    lines: lineStatuses().filter((l) => st.routes.includes(l.routeId)),
    tipsCount: tips?.n ?? 0,
    thisWeek: week,
    collectedAt: mine?.first_ts ?? null,
    rent,
    awayGame: away ? { school: away.short } : null,
    neutralGround: st.routes.includes("Blue"),
  });
});

const boolQ = (v: unknown) => v === "1" || v === "true";

gameRoutes.get("/spots", async (req, res) => {
  const db = await getDb();
  const stop = String(req.query.stop || "");
  if (!stationById.has(stop)) throw new HttpError(400, "Unknown stop");
  const budget = req.query.budget ? Math.round(Number(req.query.budget) * 100) : req.user?.budget_cents ?? config.game.defaultBudgetCents;
  res.json(
    await findSpots(db, {
      stationId: stop,
      budgetCents: budget,
      craving: req.query.craving ? String(req.query.craving) : undefined,
      vibe: req.query.vibe ? String(req.query.vibe) : undefined,
      openNow: boolQ(req.query.openNow),
      openLate: boolQ(req.query.openLate),
      homeRegions: req.user?.home_regions ?? [],
      userId: req.user?.id ?? null,
      limit: req.query.limit ? Math.min(20, Number(req.query.limit)) : 3,
    }),
  );
});

gameRoutes.get("/spots/:id", async (req, res) => {
  const db = await getDb();
  const spot = await getSpot(db, req.params.id, req.user?.id ?? null);
  if (!spot) throw new HttpError(404, "Spot not found");
  const stamp = req.user ? await partnerStamps(db, req.user.id, spot.id) : null;
  res.json({ spot, stamp, neighborhood: spot.neighborhoodId ? NEIGHBORHOOD_META.get(spot.neighborhoodId) : null });
});

// ---- check-in -------------------------------------------------------------------------
gameRoutes.post("/checkin", requireUser, upload.single("photo"), async (req, res) => {
  if (!rateLimit(`checkin:${req.user.id}`, 12, 10 * 60_000)) throw new HttpError(429, "Slow down: too many check-in attempts.");
  const body = z
    .object({
      spotId: z.string(),
      lat: z.coerce.number().optional(),
      lon: z.coerce.number().optional(),
      demoLocation: z.string().optional(),
    })
    .parse(req.body);
  const db = await getDb();
  const result = await checkIn(db, req.user, {
    spotId: body.spotId,
    lat: body.lat,
    lon: body.lon,
    demoLocation: body.demoLocation === "true",
    photo: req.file?.buffer,
  });
  res.json(result);
});

gameRoutes.get("/checkins/:id", requireUser, async (req, res) => {
  const db = await getDb();
  const c = await db.one("SELECT id, points, reasons, verified, verify_note, is_new_stop FROM checkins WHERE user_id=$1 AND id=$2", [req.user.id, req.params.id]);
  if (!c) return res.json({ status: "rejected", verifyNote: "Photo not accepted." });
  res.json({ status: c.verified === "pending" ? "pending" : c.verified === "rejected" ? "rejected" : "scored", ...c });
});

// ---- me / Your Boston ---------------------------------------------------------------------
gameRoutes.get("/me", requireUser, async (req, res) => {
  const db = await getDb();
  const u = req.user;
  const [collections, stamps, badges, money, local, recent, friends, rank] = await Promise.all([
    db.query("SELECT station_id, first_ts FROM collections WHERE user_id=$1", [u.id]),
    db.query("SELECT neighborhood_id, first_ts FROM user_neighborhoods WHERE user_id=$1", [u.id]),
    db.query("SELECT badge_id, earned_at, solana_sig, solana_status FROM badges WHERE user_id=$1", [u.id]),
    db.one(
      `SELECT coalesce(sum(greatest(0, $2::int - s.price_cents)),0)::int AS saved, count(*)::int AS meals
       FROM checkins c JOIN spots s ON s.id=c.spot_id WHERE c.user_id=$1 AND c.kind='food' AND c.verified IN ('verified','unchecked')`,
      [u.id, u.baseline_cents],
    ),
    db.one(
      `SELECT count(DISTINCT c.spot_id)::int AS spots, count(*)::int AS visits FROM checkins c JOIN spots s ON s.id=c.spot_id
       WHERE c.user_id=$1 AND s.local_owned AND s.kind='food' AND c.verified IN ('verified','unchecked')`,
      [u.id],
    ),
    db.query(
      `SELECT c.id, c.ts, c.points, c.reasons, c.verified, c.is_new_stop, s.name AS spot_name, c.station_id
       FROM checkins c JOIN spots s ON s.id=c.spot_id WHERE c.user_id=$1 ORDER BY c.ts DESC LIMIT 12`,
      [u.id],
    ),
    db.query(
      `SELECT u.id, u.display_name, u.school_id, u.friend_code FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=$1`,
      [u.id],
    ),
    db.one(`SELECT points FROM weekly_user_points WHERE user_id=$1 AND week <= now() AND week > now() - interval '7 days'`, [u.id]),
  ]);
  const weekStops = await db.one(`SELECT count(*)::int AS n FROM collections WHERE user_id=$1 AND first_ts >= $2`, [u.id, weekStart()]);
  const collected = new Set(collections.map((c: any) => c.station_id));
  const lines = ROUTES.map((r) => ({ id: r.id, short: r.short, color: r.color, have: r.stopIds.filter((s) => collected.has(s)).length, total: r.stopIds.length }));
  const earned = new Map(badges.map((b: any) => [b.badge_id, b]));
  const school = schoolById(u.school_id)!;
  const bostonStamps = stamps.filter((s: any) => NEIGHBORHOOD_META.get(s.neighborhood_id)?.kind === "boston").length;
  res.json({
    user: {
      id: u.id, name: u.display_name, email: u.email, school: { id: school.id, short: school.short, name: school.name, color: school.color },
      friendCode: u.friend_code, lang: u.lang, homeRegions: u.home_regions, budgetCents: u.budget_cents, baselineCents: u.baseline_cents,
      contact: u.contact, isDemo: u.is_demo,
    },
    points: u.total_points,
    weekPoints: rank?.points ?? 0,
    weekStops: weekStops?.n ?? 0,
    level: levelFor(u.total_points),
    streak: streakStatus(u),
    stops: { collected: collected.size, total: STATIONS.length },
    lines,
    yourBoston: {
      moneySavedCents: money?.saved ?? 0,
      meals: money?.meals ?? 0,
      baselineCents: u.baseline_cents,
      neighborhoods: { explored: bostonStamps, total: BOSTON_NEIGHBORHOOD_COUNT, bonus: stamps.length - bostonStamps },
      localSpots: local?.spots ?? 0,
      localVisits: local?.visits ?? 0,
    },
    stamps: stamps.map((s: any) => s.neighborhood_id),
    badges: BADGES.map((b) => ({ ...b, earnedAt: earned.get(b.id)?.earned_at ?? null, solanaSig: earned.get(b.id)?.solana_sig ?? null, solanaStatus: earned.get(b.id)?.solana_status ?? null })),
    recent,
    friends: friends.map((f: any) => ({ id: f.id, name: f.display_name, school: f.school_id, code: f.friend_code })),
  });
});

gameRoutes.post("/me", requireUser, async (req, res) => {
  const b = z
    .object({
      name: z.string().min(1).max(40).optional(),
      lang: z.string().min(2).max(10).optional(),
      homeRegions: z.array(z.string()).max(6).optional(),
      budgetCents: z.number().int().min(300).max(5000).optional(),
      baselineCents: z.number().int().min(500).max(5000).optional(),
      contact: z.string().max(120).optional(),
    })
    .parse(req.body);
  const db = await getDb();
  const u = req.user;
  await db.query(
    `UPDATE users SET display_name=$2, lang=$3, home_regions=$4, budget_cents=$5, baseline_cents=$6, contact=$7 WHERE id=$1`,
    [u.id, b.name ?? u.display_name, b.lang ?? u.lang, b.homeRegions ?? u.home_regions, b.budgetCents ?? u.budget_cents, b.baselineCents ?? u.baseline_cents, b.contact ?? u.contact],
  );
  res.json({ ok: true });
});

gameRoutes.post("/friends", requireUser, async (req, res) => {
  const { code } = z.object({ code: z.string().min(4).max(10) }).parse(req.body);
  const db = await getDb();
  const f = await db.one("SELECT id, display_name FROM users WHERE friend_code=$1", [code.toUpperCase()]);
  if (!f) throw new HttpError(404, "No student with that friend code");
  if (f.id === req.user.id) throw new HttpError(400, "That's your own code");
  await db.query("INSERT INTO friendships (user_id, friend_id) VALUES ($1,$2),($2,$1) ON CONFLICT DO NOTHING", [req.user.id, f.id]);
  res.json({ ok: true, friend: { id: f.id, name: f.display_name } });
});

// ---- leaderboards ---------------------------------------------------------------------------
gameRoutes.get("/leaderboard/schools", async (req, res) => {
  const view = req.query.view === "stops" ? "stops" : "average";
  const db = await getDb();
  const rows = await db.query(
    `SELECT school_id, total_points, active_players, avg_points, stops FROM weekly_school_points
     WHERE week <= now() AND week > now() - interval '7 days'`,
  );
  const demo = await db.query(
    `SELECT w.school_id, count(*)::int AS n FROM weekly_user_points w JOIN users u ON u.id=w.user_id
     WHERE u.is_demo AND w.week <= now() AND w.week > now() - interval '7 days' AND w.checkins > 0 GROUP BY w.school_id`,
  );
  const demoBy = new Map(demo.map((d: any) => [d.school_id, d.n]));
  const MIN = 10;
  const board = SCHOOLS.map((s) => {
    const r: any = rows.find((x: any) => x.school_id === s.id) || { total_points: 0, active_players: 0, avg_points: 0, stops: 0 };
    return {
      school: { id: s.id, short: s.short, color: s.color },
      totalPoints: r.total_points, activePlayers: r.active_players, avgPoints: Math.round(r.avg_points * 10) / 10, stops: r.stops,
      demoPlayers: demoBy.get(s.id) ?? 0,
      eligible: view === "stops" || r.active_players >= MIN,
    };
  }).sort((a, b) =>
    view === "stops" ? b.stops - a.stops : Number(b.eligible) - Number(a.eligible) || b.avgPoints - a.avgPoints,
  );
  const ws = weekStart();
  res.json({ view, minPlayers: MIN, weekStart: ws, resetsAt: new Date(ws.getTime() + 7 * 86400_000), board, source: db.timescale ? "Tiger Data continuous aggregate (weekly_user_points)" : "weekly_school_points view" });
});

/** The school board over this week, hour by hour: cumulative points per school. */
gameRoutes.get("/leaderboard/schools/timeline", async (_req, res) => {
  const db = await getDb();
  const rows = await db.query(
    `SELECT ${bucketHour(db.timescale)} AS hour, school_id, sum(points)::int AS points
     FROM checkins WHERE ts >= $1 AND verified IN ('verified','unchecked') GROUP BY 1, 2 ORDER BY 1`,
    [weekStart()],
  );
  res.json({ weekStart: weekStart(), rows });
});

gameRoutes.get("/leaderboard/players", requireUser, async (req, res) => {
  const scope = req.query.scope === "friends" ? "friends" : "school";
  const db = await getDb();
  const rows =
    scope === "friends"
      ? await db.query(
          `SELECT u.id, u.display_name, u.school_id, u.is_demo, coalesce(w.points,0)::int AS points, coalesce(w.new_stops,0)::int AS stops
           FROM users u LEFT JOIN weekly_user_points w ON w.user_id=u.id AND w.week <= now() AND w.week > now() - interval '7 days'
           WHERE u.id=$1 OR u.id IN (SELECT friend_id FROM friendships WHERE user_id=$1) ORDER BY points DESC`,
          [req.user.id],
        )
      : await db.query(
          `SELECT u.id, u.display_name, u.school_id, u.is_demo, w.points::int AS points, w.new_stops::int AS stops
           FROM weekly_user_points w JOIN users u ON u.id=w.user_id
           WHERE w.school_id=$1 AND w.week <= now() AND w.week > now() - interval '7 days' ORDER BY w.points DESC LIMIT 25`,
          [req.user.school_id],
        );
  res.json({ scope, players: rows.map((r: any) => ({ id: r.id, name: r.id === req.user.id ? `${r.display_name} (you)` : firstName(r.display_name) + (r.is_demo && !r.display_name.includes("(demo)") ? " (demo)" : r.display_name.includes("(demo)") ? " (demo)" : ""), school: r.school_id, points: r.points, stops: r.stops, me: r.id === req.user.id })) });
});

gameRoutes.get("/events", async (_req, res) => {
  const db = await getDb();
  const active = await activeEvents(db);
  const upcoming = await db.query("SELECT * FROM events WHERE starts_at > now() AND kind <> 'partner' ORDER BY starts_at LIMIT 6");
  res.json({ active: active.filter((e) => e.kind !== "partner" || true), upcoming });
});
