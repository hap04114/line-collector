/** Local tips, study ratings, partner punch cards, redemption codes and the owner page. */
import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { syncSlowHourEvent } from "../db/seed.js";
import { requireOwner, requireUser } from "../auth.js";
import { schoolById } from "../data/schools.js";
import { geminiEnabled, screenTipAI } from "../lib/gemini.js";
import { stationById } from "../lib/static.js";
import { HttpError, firstName, newId, rateLimit, sixDigitCode } from "../lib/util.js";
import { maybeLocalGuide } from "../services/badges.js";
import { partnerStamps } from "../services/checkin.js";

export const communityRoutes = Router();

// ---- local tips -------------------------------------------------------------------------
const BLOCKLIST = /\b(fuck|shit|bitch|slut|retard|n[i1]gg|kill yourself|kys)\b/i;
const CONTACT = /(\+?\d[\d\s().-]{8,}\d|@[a-z0-9_]{3,}|https?:\/\/)/i;

communityRoutes.get("/tips", async (req, res) => {
  const stop = String(req.query.stop || "");
  const db = await getDb();
  const rows = await db.query(
    `SELECT t.id, t.text, t.helpful_count, t.created_at, t.user_id, u.display_name, u.school_id,
            EXISTS (SELECT 1 FROM tip_votes v WHERE v.tip_id=t.id AND v.user_id=$2) AS voted
     FROM tips t JOIN users u ON u.id=t.user_id WHERE t.station_id=$1 AND t.status='live'
     ORDER BY t.helpful_count DESC, t.created_at DESC LIMIT 20`,
    [stop, req.user?.id ?? null],
  );
  const canPost = req.user ? !!(await db.one("SELECT 1 FROM collections WHERE user_id=$1 AND station_id=$2", [req.user.id, stop])) : false;
  const mine = req.user ? await db.one("SELECT id, status FROM tips WHERE user_id=$1 AND station_id=$2", [req.user.id, stop]) : null;
  res.json({
    tips: rows.map((r: any) => ({ id: r.id, text: r.text, helpful: r.helpful_count, at: r.created_at, author: firstName(r.display_name), school: schoolById(r.school_id)?.short, voted: r.voted, mine: r.user_id === req.user?.id })),
    canPost,
    mine,
  });
});

communityRoutes.post("/tips", requireUser, async (req, res) => {
  const b = z.object({ stationId: z.string(), text: z.string().trim().min(8).max(280) }).parse(req.body);
  if (!stationById.has(b.stationId)) throw new HttpError(400, "Unknown station");
  if (!rateLimit(`tip:${req.user.id}`, 6, 60 * 60_000)) throw new HttpError(429, "Too many tips this hour");
  const db = await getDb();
  if (!(await db.one("SELECT 1 FROM collections WHERE user_id=$1 AND station_id=$2", [req.user.id, b.stationId])))
    throw new HttpError(403, "Collect this stop first, then leave a tip for the next student.");
  if (await db.one("SELECT 1 FROM tips WHERE user_id=$1 AND station_id=$2", [req.user.id, b.stationId])) throw new HttpError(409, "One tip per student per station.");

  let status = "live";
  let note: string | null = null;
  if (BLOCKLIST.test(b.text)) [status, note] = ["rejected", "Language filter"];
  else if (CONTACT.test(b.text)) [status, note] = ["rejected", "No phone numbers, handles or links in tips"];
  else if (geminiEnabled()) {
    try {
      const r = await screenTipAI(b.text);
      if (!r.ok) [status, note] = ["rejected", r.reason];
      else note = "Screened by Gemini";
    } catch {
      note = "Screening unavailable; word filter only";
    }
  }
  const id = newId("tip_");
  await db.query(`INSERT INTO tips (id, user_id, station_id, text, status, screen_note) VALUES ($1,$2,$3,$4,$5,$6)`, [id, req.user.id, b.stationId, b.text, status, note]);
  if (status !== "live") throw new HttpError(422, `Tip not posted: ${note}`);
  res.json({ ok: true, id });
});

communityRoutes.post("/tips/:id/helpful", requireUser, async (req, res) => {
  const db = await getDb();
  const tip = await db.one("SELECT * FROM tips WHERE id=$1 AND status='live'", [req.params.id]);
  if (!tip) throw new HttpError(404, "Tip not found");
  if (tip.user_id === req.user.id) throw new HttpError(400, "You can't vote for your own tip");
  await db.tx(async (q) => {
    const ins = await q.query("INSERT INTO tip_votes (tip_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING tip_id", [tip.id, req.user.id]);
    if (ins.length) {
      await q.query("UPDATE tips SET helpful_count = helpful_count + 1 WHERE id=$1", [tip.id]);
      // tips earn points only when other students mark them helpful
      await q.query("UPDATE users SET total_points = total_points + 10 WHERE id=$1", [tip.user_id]);
      await maybeLocalGuide(q, tip.user_id);
    }
  });
  res.json({ ok: true });
});

communityRoutes.post("/tips/:id/report", requireUser, async (req, res) => {
  const db = await getDb();
  const { reason } = z.object({ reason: z.string().max(200).optional() }).parse(req.body ?? {});
  await db.query("INSERT INTO tip_reports (tip_id, user_id, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [req.params.id, req.user.id, reason ?? null]);
  await db.query("UPDATE tips SET status='hidden' WHERE id=$1", [req.params.id]); // one report hides it until reviewed
  res.json({ ok: true, hidden: true });
});

// ---- study ratings ---------------------------------------------------------------------------
communityRoutes.post("/study/:spotId/rate", requireUser, async (req, res) => {
  const b = z.object({ outlets: z.number().int().min(1).max(5), noise: z.number().int().min(1).max(5), wifi: z.number().int().min(1).max(5) }).parse(req.body);
  const db = await getDb();
  const visited = await db.one("SELECT 1 FROM checkins WHERE user_id=$1 AND spot_id=$2 AND verified IN ('verified','unchecked')", [req.user.id, req.params.spotId]);
  if (!visited) throw new HttpError(403, "Check in here first, then rate it.");
  await db.query(
    `INSERT INTO study_ratings (spot_id, user_id, outlets, noise, wifi) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (spot_id, user_id) DO UPDATE SET outlets=EXCLUDED.outlets, noise=EXCLUDED.noise, wifi=EXCLUDED.wifi, created_at=now()`,
    [req.params.spotId, req.user.id, b.outlets, b.noise, b.wifi],
  );
  res.json({ ok: true });
});

// ---- punch cards and redemption -------------------------------------------------------------
communityRoutes.get("/rewards", requireUser, async (req, res) => {
  const db = await getDb();
  const partners = await db.query(
    `SELECT p.id, p.spot_id, p.is_sample, s.name, s.station_id, o.id AS offer_id, o.title, o.stamps_needed, o.slow_hours
     FROM partners p JOIN spots s ON s.id=p.spot_id JOIN offers o ON o.partner_id=p.id AND o.active ORDER BY s.name`,
  );
  const cards = [];
  for (const p of partners) {
    const st = await partnerStamps(db, req.user.id, p.spot_id);
    const active = await db.one(
      `SELECT code, expires_at FROM redemptions WHERE user_id=$1 AND offer_id=$2 AND redeemed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, p.offer_id],
    );
    cards.push({
      partnerId: p.id, spotId: p.spot_id, name: p.name, stationId: p.station_id, station: stationById.get(p.station_id)?.name,
      offerId: p.offer_id, offer: p.title, needed: p.stamps_needed, stamps: Math.max(0, st?.stamps ?? 0), isSample: p.is_sample,
      slowHours: p.slow_hours, activeCode: active ? { code: active.code, expiresAt: active.expires_at } : null,
    });
  }
  res.json({ cards });
});

communityRoutes.post("/redeem", requireUser, async (req, res) => {
  const { offerId } = z.object({ offerId: z.string() }).parse(req.body);
  if (!rateLimit(`redeem:${req.user.id}`, 10, 10 * 60_000)) throw new HttpError(429, "Too many redeem attempts");
  const db = await getDb();
  const o = await db.one("SELECT o.*, p.spot_id FROM offers o JOIN partners p ON p.id=o.partner_id WHERE o.id=$1 AND o.active", [offerId]);
  if (!o) throw new HttpError(404, "Offer not found");
  const st = await partnerStamps(db, req.user.id, o.spot_id);
  if (!st || st.stamps < o.stamps_needed) throw new HttpError(400, `You need ${o.stamps_needed} stamps (you have ${st?.stamps ?? 0}).`);
  const existing = await db.one(
    `SELECT code, expires_at FROM redemptions WHERE user_id=$1 AND offer_id=$2 AND redeemed_at IS NULL AND expires_at > now()`,
    [req.user.id, offerId],
  );
  if (existing) return res.json({ code: existing.code, expiresAt: existing.expires_at });
  let code = sixDigitCode();
  for (let i = 0; i < 5 && (await db.one("SELECT 1 FROM redemptions WHERE code=$1 AND redeemed_at IS NULL AND expires_at > now()", [code])); i++) code = sixDigitCode();
  const expiresAt = new Date(Date.now() + 2 * 60_000);
  await db.query(`INSERT INTO redemptions (id, user_id, offer_id, code, expires_at) VALUES ($1,$2,$3,$4,$5)`, [newId("rd_"), req.user.id, offerId, code, expiresAt]);
  res.json({ code, expiresAt });
});

// ---- owner page -------------------------------------------------------------------------------
communityRoutes.get("/partners/me", requireOwner, async (req, res) => {
  const db = await getDb();
  const p = await db.one(
    `SELECT p.*, s.name AS spot_name, s.station_id, s.address FROM partners p JOIN spots s ON s.id=p.spot_id WHERE p.id=$1`,
    [req.ownerPartnerId],
  );
  if (!p) throw new HttpError(404, "Partner not found");
  const offers = await db.query("SELECT * FROM offers WHERE partner_id=$1 ORDER BY created_at", [p.id]);
  res.json({ partner: { id: p.id, spotId: p.spot_id, name: p.spot_name, station: stationById.get(p.station_id)?.name, ownerName: p.owner_name, isSample: p.is_sample, address: p.address }, offers });
});

communityRoutes.get("/partners/stats", requireOwner, async (req, res) => {
  const db = await getDb();
  const p = await db.one("SELECT spot_id FROM partners WHERE id=$1", [req.ownerPartnerId]);
  if (!p) throw new HttpError(404, "Partner not found");
  // visits by hour of day (Boston time) from the spot_visits_hourly aggregate
  const byHour = await db.query(
    `SELECT extract(hour FROM bucket AT TIME ZONE 'America/New_York')::int AS hour, sum(visits)::int AS visits
     FROM spot_visits_hourly WHERE spot_id=$1 AND bucket > now() - interval '30 days' GROUP BY 1 ORDER BY 1`,
    [p.spot_id],
  );
  const totals = await db.one(
    `SELECT count(*)::int AS visits, count(DISTINCT user_id)::int AS students FROM checkins WHERE spot_id=$1 AND ts > now() - interval '30 days' AND verified IN ('verified','unchecked')`,
    [p.spot_id],
  );
  const red = await db.one(
    `SELECT count(*)::int AS n FROM redemptions r JOIN offers o ON o.id=r.offer_id WHERE o.partner_id=$1 AND r.redeemed_at IS NOT NULL`,
    [req.ownerPartnerId],
  );
  res.json({ byHour, visits30d: totals?.visits ?? 0, students30d: totals?.students ?? 0, redemptions: red?.n ?? 0, source: db.timescale ? "Tiger Data continuous aggregate (spot_visits_hourly)" : "spot_visits_hourly view" });
});

communityRoutes.post("/partners/offers", requireOwner, async (req, res) => {
  const b = z
    .object({
      id: z.string().optional(),
      title: z.string().min(3).max(80),
      stampsNeeded: z.number().int().min(2).max(20),
      active: z.boolean().default(true),
      slowHours: z
        .object({ days: z.array(z.number().int().min(0).max(6)).min(1), startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24), multiplier: z.number().min(1).max(3) })
        .nullable()
        .optional(),
    })
    .parse(req.body);
  const db = await getDb();
  const p = await db.one("SELECT p.*, s.name FROM partners p JOIN spots s ON s.id=p.spot_id WHERE p.id=$1", [req.ownerPartnerId]);
  let id = b.id;
  if (id) {
    const o = await db.one("SELECT id FROM offers WHERE id=$1 AND partner_id=$2", [id, p.id]);
    if (!o) throw new HttpError(404, "Offer not found");
    await db.query("UPDATE offers SET title=$2, stamps_needed=$3, slow_hours=$4, active=$5 WHERE id=$1", [id, b.title, b.stampsNeeded, b.slowHours ? JSON.stringify(b.slowHours) : null, b.active]);
  } else {
    id = newId("of_");
    await db.query("INSERT INTO offers (id, partner_id, title, stamps_needed, slow_hours, active) VALUES ($1,$2,$3,$4,$5,$6)", [id, p.id, b.title, b.stampsNeeded, b.slowHours ? JSON.stringify(b.slowHours) : null, b.active]);
  }
  // slow hours are just an event row: no new code needed
  await syncSlowHourEvent(db, id, p.spot_id, p.name, b.slowHours ?? null, b.active);
  res.json({ ok: true, id });
});

communityRoutes.post("/partners/confirm", requireOwner, async (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  if (!rateLimit(`confirm:${req.ownerPartnerId}`, 30, 10 * 60_000)) throw new HttpError(429, "Too many attempts");
  const db = await getDb();
  const r = await db.one(
    `SELECT r.*, o.title, u.display_name FROM redemptions r JOIN offers o ON o.id=r.offer_id JOIN users u ON u.id=r.user_id
     WHERE r.code=$1 AND o.partner_id=$2 ORDER BY r.created_at DESC LIMIT 1`,
    [code, req.ownerPartnerId],
  );
  if (!r) throw new HttpError(404, "Code not found for your offers");
  if (r.redeemed_at) throw new HttpError(409, "Code already used");
  if (new Date(r.expires_at) < new Date()) throw new HttpError(410, "Code expired. Ask the student to tap Redeem again.");
  await db.query("UPDATE redemptions SET redeemed_at=now() WHERE id=$1", [r.id]);
  res.json({ ok: true, reward: r.title, student: firstName(r.display_name) });
});
