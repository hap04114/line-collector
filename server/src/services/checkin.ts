/**
 * How a check-in flows (design doc):
 *  1. phone sends spot, GPS location and photo → POST /api/checkin
 *  2. fair play: distance ≤ 150 m, photo fingerprint unseen, daily cap; Gemini confirms the photo
 *  3. work out what's new, add points, apply multipliers (incl. live shutdown alerts from the poller)
 *  4. write the check-in to the checkins hypertable; the weekly school board follows from the aggregate
 *  5. partner stamp; line badge → Solana devnet (async)
 *  6. return points + reasons for the app to animate
 * If Gemini is slow, the check-in is saved as pending and scored when the check returns.
 */
import { config } from "../config.js";
import type { Db, Queryable } from "../db/index.js";
import { checkPhoto, geminiEnabled } from "../lib/gemini.js";
import { haversineM } from "../lib/geo.js";
import { dHash, hamming, NEAR_DUPLICATE_BITS, normalizePhoto } from "../lib/photo.js";
import { awaySchoolFor, NEIGHBORHOOD_META, routeById, ROUTES, stationById } from "../lib/static.js";
import { levelFor, monthKey, startOfDay, weekStart, weeksBetween, dateKey } from "../lib/time.js";
import { HttpError, newId, withTimeout } from "../lib/util.js";
import { getWeather, recordOnSolana, solanaEnabled } from "../lib/external.js";
import { awardBadges, badgeById } from "./badges.js";
import { activeEvents, evaluateEvents } from "./events.js";
import { formatReasons, scoreCheckin, type ScoreResult } from "./scoring.js";
import { lineStatuses } from "./transit.js";
import { schoolById } from "../data/schools.js";

export interface CheckinRequest {
  spotId: string;
  lat?: number;
  lon?: number;
  demoLocation?: boolean;
  photo?: Buffer;
  at?: Date; // seeding only
  skipPhotoCheck?: boolean; // seeding only
  isDemo?: boolean;
}

export interface CheckinResult {
  status: "scored" | "pending";
  checkinId: string;
  points: number;
  reasons: string[];
  multiplier: number;
  newStop: boolean;
  badges: { id: string; name: string; icon: string }[];
  stamp: { partnerId: string; stamps: number; needed: number; offer: string; isSample: boolean } | null;
  streak: { weeks: number; usedSkip: boolean } | null;
  totalPoints: number;
  level: string;
  verified: string;
  verifyNote: string | null;
}

const LINE_NAMES = Object.fromEntries(ROUTES.map((r) => [r.id, r.short]));

export async function checkIn(db: Db, user: any, req: CheckinRequest): Promise<CheckinResult> {
  const now = req.at ?? new Date();
  const spot = await db.one("SELECT * FROM spots WHERE id = $1", [req.spotId]);
  if (!spot) throw new HttpError(404, "Spot not found");
  const station = stationById.get(spot.station_id);
  if (!station) throw new HttpError(400, "Spot has no station");

  // --- fair play: location -----------------------------------------------------
  let distanceM: number;
  if (req.demoLocation) {
    if (!config.demoMode && !req.isDemo) throw new HttpError(400, "Demo location is only allowed in demo mode");
    distanceM = 0;
  } else {
    if (req.lat == null || req.lon == null) throw new HttpError(400, "Location is needed to check in");
    distanceM = Math.round(haversineM(req.lat, req.lon, spot.lat, spot.lon));
    if (distanceM > spot.checkin_radius_m)
      throw new HttpError(422, `You're about ${distanceM} m from ${spot.name}. Get within ${spot.checkin_radius_m} m to check in.`, { distanceM });
  }

  // --- fair play: caps ---------------------------------------------------------
  const dayStart = startOfDay(now);
  const today = await db.query(
    `SELECT spot_id FROM checkins WHERE user_id=$1 AND ts >= $2 AND ts < $3 AND verified <> 'rejected'`,
    [user.id, dayStart, new Date(dayStart.getTime() + 86400_000)],
  );
  if (today.some((r: any) => r.spot_id === spot.id)) throw new HttpError(429, `You already checked in at ${spot.name} today.`);
  if (today.length >= config.game.dailyCap) throw new HttpError(429, `Daily limit reached: ${config.game.dailyCap} scored check-ins a day. Back tomorrow!`);

  // --- fair play: photo fingerprint -------------------------------------------
  let photo: Buffer | null = null;
  let photoHash: string | null = null;
  if (req.photo) {
    photo = await normalizePhoto(req.photo);
    photoHash = await dHash(photo);
    const hashes = await db.query<{ photo_hash: string }>(
      "SELECT DISTINCT photo_hash FROM checkins WHERE photo_hash IS NOT NULL AND verified <> 'rejected'",
    );
    if (hashes.some((h) => h.photo_hash === photoHash || hamming(h.photo_hash, photoHash!) <= NEAR_DUPLICATE_BITS))
      throw new HttpError(422, "That photo (or one almost identical) was already used. Snap a fresh one.");
  } else if (!req.skipPhotoCheck) {
    throw new HttpError(400, "A photo is needed to check in");
  }

  // --- Gemini photo check ------------------------------------------------------
  let verified = "unchecked";
  let verifyNote: string | null = geminiEnabled() ? null : "Photo check skipped: Gemini not configured (dev mode).";
  if (photo && geminiEnabled() && !req.skipPhotoCheck) {
    const call = checkPhoto(photo, { name: spot.name, kind: spot.kind, cuisines: spot.cuisines }, config.gemini.timeoutMs + 20_000);
    const r = await withTimeout(call, config.gemini.timeoutMs);
    if (!r.ok) {
      // Slow: save as pending; score when Gemini answers.
      const id = newId("ci_");
      await db.query(
        `INSERT INTO checkins (id, ts, user_id, school_id, spot_id, station_id, lines, neighborhood_id, kind, points, reasons, context, photo_hash, verified, distance_m, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'[]',$10,$11,'pending',$12,$13)`,
        [id, now, user.id, user.school_id, spot.id, station.id, station.routes, spot.neighborhood_id, spot.kind, JSON.stringify({ pending: true }), photoHash, distanceM, !!req.isDemo],
      );
      r.promise
        .then((v) => finalizePending(db, id, user, spot, now, photoHash, distanceM, v))
        .catch((e) => finalizePending(db, id, user, spot, now, photoHash, distanceM, { ok: true, isScreenOrScreenshot: false, reason: `Photo check unavailable (${e.message}); accepted.` }));
      return {
        status: "pending", checkinId: id, points: 0, reasons: ["Photo check running: points land in a moment"], multiplier: 1, newStop: false,
        badges: [], stamp: null, streak: null, totalPoints: user.total_points, level: user.level, verified: "pending", verifyNote: null,
      };
    }
    const v = r.value;
    if (!v.ok || v.isScreenOrScreenshot) throw new HttpError(422, `Photo not accepted: ${v.reason}`, { verdict: v });
    verified = "verified";
    verifyNote = v.reason;
  }

  return db.tx((q) => scoreAndSave(q, { user, spot, now, photoHash, verified, verifyNote, distanceM, isDemo: !!req.isDemo }));
}

async function finalizePending(db: Db, id: string, user: any, spot: any, ts: Date, photoHash: string | null, distanceM: number, v: { ok: boolean; isScreenOrScreenshot: boolean; reason: string }) {
  try {
    if (!v.ok || v.isScreenOrScreenshot) {
      await db.query(`UPDATE checkins SET verified='rejected', verify_note=$2 WHERE id=$1`, [id, v.reason]);
      return;
    }
    await db.tx(async (q) => {
      await q.query(`DELETE FROM checkins WHERE id=$1`, [id]);
      const fresh = await q.query("SELECT * FROM users WHERE id=$1", [user.id]);
      await scoreAndSave(q, { user: fresh[0], spot, now: ts, photoHash, verified: "verified", verifyNote: v.reason, distanceM, isDemo: false, id });
    });
  } catch (e) {
    console.error("[checkin] finalize failed", e);
  }
}

interface SaveArgs {
  user: any;
  spot: any;
  now: Date;
  photoHash: string | null;
  verified: string;
  verifyNote: string | null;
  distanceM: number;
  isDemo: boolean;
  id?: string;
}

async function scoreAndSave(q: Queryable, a: SaveArgs): Promise<CheckinResult> {
  const { user, spot, now } = a;
  const station = stationById.get(spot.station_id)!;
  const id = a.id ?? newId("ci_");

  // --- what's new --------------------------------------------------------------
  const collected = new Set((await q.query<{ station_id: string }>("SELECT station_id FROM collections WHERE user_id=$1", [user.id])).map((r) => r.station_id));
  const isNewStop = !collected.has(station.id);
  const spotBefore = await q.query(
    `SELECT 1 FROM checkins WHERE user_id=$1 AND spot_id=$2 AND verified IN ('verified','unchecked') LIMIT 1`,
    [user.id, spot.id],
  );
  const isNewSpot = !spotBefore.length;

  const linesBefore = new Set<string>();
  for (const sid of collected) for (const r of stationById.get(sid)?.routes ?? []) linesBefore.add(r);
  const after = new Set(collected).add(station.id);
  const newLines = isNewStop ? station.routes.filter((r) => !linesBefore.has(r)) : [];
  const completedLines = isNewStop
    ? station.routes.filter((r) => routeById.get(r)!.stopIds.every((s) => after.has(s)))
    : [];

  let newNeighborhood: string | null = null;
  if (spot.neighborhood_id) {
    const had = await q.query("SELECT 1 FROM user_neighborhoods WHERE user_id=$1 AND neighborhood_id=$2", [user.id, spot.neighborhood_id]);
    if (!had.length) newNeighborhood = NEIGHBORHOOD_META.get(spot.neighborhood_id)?.name ?? spot.neighborhood_id;
  }

  // --- bring a friend: another student at the same spot within 10 minutes --------
  const friendRow = await q.query(
    `SELECT id, ts, user_id, points, context FROM checkins
     WHERE spot_id=$1 AND user_id<>$2 AND ts BETWEEN $3 AND $4 AND verified IN ('verified','unchecked')
     ORDER BY ts DESC LIMIT 1`,
    [spot.id, user.id, new Date(now.getTime() - config.game.friendWindowMin * 60_000), now],
  );
  const friend = friendRow[0] ?? null;

  // --- live context: shutdowns, chaos, events, weather -------------------------
  // seeded demo history ignores today's live conditions
  const statuses = a.isDemo ? [] : lineStatuses().filter((l) => station.routes.includes(l.routeId));
  const shutdown = statuses.filter((l) => l.shuttle).map((l) => l.routeId);
  const chaos = statuses.reduce((m, l) => Math.max(m, l.chaos), 0);
  const weather = a.isDemo ? null : await getWeather();
  const events = await activeEvents(q, now);
  const ev = evaluateEvents(events, {
    now, stationId: station.id, stationRoutes: station.routes, spotId: spot.id, spotKind: spot.kind,
    weather: weather ? { snowing: weather.snowing, warmUp: weather.warmUp } : null,
  });
  const away = awaySchoolFor(station.id, user.school_id);

  const input = {
    hour: now.getHours(),
    spotKind: spot.kind,
    stationRoutes: station.routes,
    isNewStop,
    isNewSpot,
    newLines,
    completedLines,
    newNeighborhood,
    awaySchool: away?.short ?? null,
    friend: !!friend,
    shutdownLines: shutdown,
    chaos,
    finalsWeek: ev.flags.has("finals"),
    warmUp: !!weather?.warmUp,
    events: ev.effects,
    lineNames: LINE_NAMES,
  };
  const score: ScoreResult = scoreCheckin(input);

  await q.query(
    `INSERT INTO checkins (id, ts, user_id, school_id, spot_id, station_id, lines, neighborhood_id, kind, points, reasons, context,
                           photo_hash, verified, verify_note, is_new_stop, friend_checkin_id, distance_m, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      id, now, user.id, user.school_id, spot.id, station.id, station.routes, spot.neighborhood_id, spot.kind, score.points,
      JSON.stringify(score.reasons), JSON.stringify({ input, nightOwl: score.flags.nightOwl, friend: !!friend }), a.photoHash, a.verified,
      a.verifyNote, isNewStop, friend?.id ?? null, a.distanceM, a.isDemo,
    ],
  );
  if (isNewStop) await q.query(`INSERT INTO collections (user_id, station_id, first_ts, checkin_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [user.id, station.id, now, id]);
  if (newNeighborhood) await q.query(`INSERT INTO user_neighborhoods (user_id, neighborhood_id, first_ts) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [user.id, spot.neighborhood_id, now]);

  // --- friend top-up: the first student's check-in doubles too -------------------
  if (friend && !friend.context?.friend && friend.context?.input) {
    const redo = scoreCheckin({ ...friend.context.input, friend: true });
    const delta = redo.points - friend.points;
    if (delta > 0) {
      await q.query(`UPDATE checkins SET points=$2, reasons=$3, context = context || '{"friend": true}'::jsonb WHERE id=$1`, [friend.id, redo.points, JSON.stringify(redo.reasons)]);
      await q.query(`UPDATE users SET total_points = total_points + $2 WHERE id=$1`, [friend.user_id, delta]);
    }
  }

  // --- streak: a new stop each week keeps it alive; one free skip a month --------
  let streak: CheckinResult["streak"] = null;
  let streakSql = "";
  const streakVals: unknown[] = [];
  if (isNewStop) {
    const s = nextStreak(user, now);
    streak = { weeks: s.weeks, usedSkip: s.usedSkip };
    streakSql = `, streak_weeks=$3, streak_last_week=$4, skips_left=$5, skips_month=$6`;
    streakVals.push(s.weeks, s.lastWeek, s.skipsLeft, s.skipsMonth);
  }
  const total = (user.total_points ?? 0) + score.points;
  const level = levelFor(total).name;
  await q.query(`UPDATE users SET total_points=$2${streakSql}, level=$${streakVals.length + 3} WHERE id=$1`, [user.id, total, ...streakVals, level]);

  // --- badges ------------------------------------------------------------------
  const newBadges = await awardBadges(q, user.id, { isNewStop, completedLines, flags: score.flags, friend: !!friend });
  for (const b of newBadges) if (b.startsWith("line-") && solanaEnabled() && !a.isDemo) queueSolana(user, b);

  // --- partner stamp -------------------------------------------------------------
  const stamp = await partnerStamps(q, user.id, spot.id);

  return {
    status: "scored",
    checkinId: id,
    points: score.points,
    reasons: formatReasons(score.reasons),
    multiplier: score.multiplier,
    newStop: isNewStop,
    badges: newBadges.map((b) => ({ id: b, name: badgeById.get(b)?.name ?? b, icon: badgeById.get(b)?.icon ?? "🏅" })),
    stamp,
    streak,
    totalPoints: total,
    level,
    verified: a.verified,
    verifyNote: a.verifyNote,
  };
}

/** 'YYYY-MM-DD' (or a Date) → local midnight, without UTC shifts */
export function localDate(v: string | Date): Date {
  if (v instanceof Date) return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function nextStreak(user: { streak_weeks: number; streak_last_week: Date | string | null; skips_left: number; skips_month: string | null }, now: Date) {
  const wk = weekStart(now);
  const mk = monthKey(now);
  let skipsLeft = user.skips_month === mk ? user.skips_left : 1;
  let usedSkip = false;
  let weeks = 1;
  if (user.streak_last_week) {
    const lastWk = weekStart(localDate(user.streak_last_week));
    const gap = weeksBetween(lastWk, wk);
    if (gap <= 0) weeks = user.streak_weeks || 1;
    else if (gap === 1) weeks = user.streak_weeks + 1;
    else if (gap === 2 && skipsLeft > 0) {
      weeks = user.streak_weeks + 1;
      skipsLeft -= 1;
      usedSkip = true;
    }
  }
  return { weeks, lastWeek: dateKey(wk), skipsLeft, skipsMonth: mk, usedSkip };
}

/** Streak as shown now: alive, covered by a skip, or broken. */
export function streakStatus(user: any, now = new Date()) {
  if (!user.streak_last_week) return { weeks: 0, state: "none" as const, skipsLeft: 1 };
  const gap = weeksBetween(weekStart(localDate(user.streak_last_week)), weekStart(now));
  const skipsLeft = user.skips_month === monthKey(now) ? user.skips_left : 1;
  if (gap <= 0) return { weeks: user.streak_weeks, state: "safe" as const, skipsLeft };
  if (gap === 1) return { weeks: user.streak_weeks, state: "due" as const, skipsLeft };
  if (gap === 2 && skipsLeft > 0) return { weeks: user.streak_weeks, state: "skip" as const, skipsLeft };
  return { weeks: 0, state: "broken" as const, skipsLeft };
}

export async function partnerStamps(q: Queryable, userId: string, spotId: string) {
  const p = await q.query(
    `SELECT p.id, p.is_sample, o.title, o.stamps_needed FROM partners p
     JOIN offers o ON o.partner_id = p.id AND o.active WHERE p.spot_id=$1 ORDER BY o.created_at LIMIT 1`,
    [spotId],
  );
  if (!p.length) return null;
  const total = await q.query(`SELECT count(*)::int AS n FROM checkins WHERE user_id=$1 AND spot_id=$2 AND verified IN ('verified','unchecked')`, [userId, spotId]);
  const used = await q.query(
    `SELECT coalesce(sum(o.stamps_needed),0)::int AS n FROM redemptions r JOIN offers o ON o.id=r.offer_id
     WHERE r.user_id=$1 AND o.partner_id=$2 AND r.redeemed_at IS NOT NULL`,
    [userId, p[0].id],
  );
  return { partnerId: p[0].id, stamps: total[0].n - used[0].n, needed: p[0].stamps_needed, offer: p[0].title, isSample: p[0].is_sample };
}

function queueSolana(user: any, badgeId: string) {
  // fire and forget: the check-in response never waits on the chain
  setTimeout(async () => {
    const { getDb } = await import("../db/index.js");
    const db = await getDb();
    try {
      const school = schoolById(user.school_id);
      const sig = await recordOnSolana(`LineCollector badge ${badgeId} | ${school?.short ?? user.school_id} | player ${user.friend_code}`);
      await db.query(`UPDATE badges SET solana_sig=$3, solana_status='confirmed' WHERE user_id=$1 AND badge_id=$2`, [user.id, badgeId, sig]);
    } catch (e) {
      console.warn("[solana] badge record failed:", (e as Error).message);
      await db.query(`UPDATE badges SET solana_status='failed' WHERE user_id=$1 AND badge_id=$2`, [user.id, badgeId]).catch(() => {});
    }
  }, 10);
}
