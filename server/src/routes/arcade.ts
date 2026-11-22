/**
 * Line Runner arcade scores. Kept separate from the real game on purpose:
 * school-board points only come from real check-ins, so the arcade can't be farmed.
 * The server recomputes the score from distance, tokens and stations, capped by run time.
 */
import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { requireUser } from "../auth.js";
import { schoolById } from "../data/schools.js";
import { ROUTE_IDS } from "../lib/static.js";
import { HttpError, firstName, newId, rateLimit } from "../lib/util.js";

export const arcadeRoutes = Router();

const MAX_SPEED = 45; // m/s, the runner's top speed
export function arcadeScore(distance: number, tokens: number, stations: number) {
  return Math.round(distance) + tokens * 10 + stations * 50;
}

arcadeRoutes.post("/arcade/score", requireUser, async (req, res) => {
  const b = z
    .object({
      routeId: z.string(),
      distance: z.number().min(0),
      tokens: z.number().int().min(0),
      stations: z.number().int().min(0),
      durationMs: z.number().int().min(1000).max(60 * 60_000),
    })
    .parse(req.body);
  if (!ROUTE_IDS.includes(b.routeId)) throw new HttpError(400, "Unknown line");
  if (!rateLimit(`arcade:${req.user.id}`, 30, 10 * 60_000)) throw new HttpError(429, "Too many runs, take a break");
  const distance = Math.min(b.distance, (b.durationMs / 1000) * MAX_SPEED);
  const tokens = Math.min(b.tokens, Math.floor(distance / 6));
  const stations = Math.min(b.stations, Math.floor(distance / 120) + 2);
  const score = arcadeScore(distance, tokens, stations);
  const db = await getDb();
  const best = await db.one(`SELECT max(score)::int AS best FROM arcade_scores WHERE user_id=$1 AND route_id=$2`, [req.user.id, b.routeId]);
  await db.query(
    `INSERT INTO arcade_scores (id, user_id, school_id, route_id, score, distance_m, tokens, stations, duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [newId("ar_"), req.user.id, req.user.school_id, b.routeId, score, Math.round(distance), tokens, stations, b.durationMs],
  );
  const rank = await db.one(
    `SELECT count(*)::int + 1 AS rank FROM (SELECT user_id, max(score) AS s FROM arcade_scores WHERE route_id=$1 GROUP BY user_id) t WHERE t.s > $2`,
    [b.routeId, score],
  );
  res.json({ score, personalBest: Math.max(score, best?.best ?? 0), newBest: score > (best?.best ?? 0), rank: rank?.rank ?? 1 });
});

arcadeRoutes.get("/arcade/top", async (req, res) => {
  const routeId = String(req.query.line || "Green-B");
  const db = await getDb();
  const rows = await db.query(
    `SELECT DISTINCT ON (a.user_id) a.user_id, a.score, a.school_id, u.display_name
     FROM arcade_scores a JOIN users u ON u.id=a.user_id WHERE a.route_id=$1 ORDER BY a.user_id, a.score DESC`,
    [routeId],
  );
  rows.sort((x: any, y: any) => y.score - x.score);
  const schools = await db.query(
    `SELECT school_id, max(score)::int AS best FROM arcade_scores WHERE route_id=$1 GROUP BY school_id ORDER BY best DESC`,
    [routeId],
  );
  res.json({
    routeId,
    players: rows.slice(0, 10).map((r: any) => ({ name: firstName(r.display_name), school: schoolById(r.school_id)?.short, score: r.score, me: r.user_id === req.user?.id })),
    schools: schools.map((r: any) => ({ school: schoolById(r.school_id)?.short, color: schoolById(r.school_id)?.color, best: r.best })),
  });
});
