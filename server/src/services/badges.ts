import type { Queryable } from "../db/index.js";
import { ROUTES, routeById, stationById } from "../lib/static.js";

export interface BadgeDef { id: string; name: string; icon: string; description: string }

export const BADGES: BadgeDef[] = [
  { id: "first-stop", name: "First Stop", icon: "🚉", description: "Collected your first T stop." },
  ...ROUTES.map((r) => ({ id: `line-${r.id}`, name: `${r.short} Line Complete`, icon: "🏅", description: `Collected every stop on the ${r.name}.` })),
  { id: "night-owl", name: "Night Owl", icon: "🦉", description: "3 late-night check-ins during finals week." },
  { id: "taste-of-home", name: "Taste of Home", icon: "🏠", description: "3 spots serving food from home." },
  { id: "neutral-ground", name: "Neutral Ground", icon: "🔵", description: "Collected 5 Blue Line stops." },
  { id: "shutdown-survivor", name: "Shutdown Survivor", icon: "🚌", description: "Checked in on a line with an active shutdown." },
  { id: "study-nomad", name: "Study Nomad", icon: "📚", description: "Studied at 5 different spots." },
  { id: "good-company", name: "Good Company", icon: "🤝", description: "5 bring-a-friend check-ins." },
  { id: "wicked-early", name: "Wicked Early", icon: "🌅", description: "A check-in before 8 AM." },
  { id: "local-guide", name: "Local Guide", icon: "🧭", description: "5 of your tips marked helpful." },
  { id: "bostonian", name: "Bostonian in a Week", icon: "🦞", description: "Finished all five First Week in Boston quests." },
];
export const badgeById = new Map(BADGES.map((b) => [b.id, b]));

const VALID = `verified IN ('verified','unchecked')`;

/** Checks every badge rule that this check-in could have changed; returns newly earned ids. */
export async function awardBadges(
  q: Queryable,
  userId: string,
  ctx: { isNewStop: boolean; completedLines: string[]; flags: { nightOwl: boolean; shutdown: boolean; wickedEarly: boolean }; friend: boolean },
): Promise<string[]> {
  const candidates: string[] = [];
  const has = new Set((await q.query<{ badge_id: string }>("SELECT badge_id FROM badges WHERE user_id=$1", [userId])).map((r) => r.badge_id));
  const want = (id: string, ok: boolean) => ok && !has.has(id) && candidates.push(id);

  if (ctx.isNewStop) want("first-stop", true);
  for (const l of ctx.completedLines) want(`line-${l}`, true);
  want("shutdown-survivor", ctx.flags.shutdown);
  want("wicked-early", ctx.flags.wickedEarly);

  if (ctx.flags.nightOwl && !has.has("night-owl")) {
    const r = await q.query(`SELECT count(*)::int AS n FROM checkins WHERE user_id=$1 AND ${VALID} AND (context->>'nightOwl')::boolean`, [userId]);
    want("night-owl", r[0].n >= 3);
  }
  if (!has.has("taste-of-home")) {
    const r = await q.query(
      `SELECT count(DISTINCT c.spot_id)::int AS n FROM checkins c JOIN spots s ON s.id=c.spot_id JOIN users u ON u.id=c.user_id
       WHERE c.user_id=$1 AND c.${VALID} AND s.region IS NOT NULL AND s.region = ANY(u.home_regions)`,
      [userId],
    );
    want("taste-of-home", r[0].n >= 3);
  }
  if (!has.has("neutral-ground") && ctx.isNewStop) {
    const blue = routeById.get("Blue")!.stopIds;
    const r = await q.query(`SELECT count(*)::int AS n FROM collections WHERE user_id=$1 AND station_id = ANY($2)`, [userId, blue]);
    want("neutral-ground", r[0].n >= 5);
  }
  if (!has.has("study-nomad")) {
    const r = await q.query(`SELECT count(DISTINCT spot_id)::int AS n FROM checkins WHERE user_id=$1 AND kind='study' AND ${VALID}`, [userId]);
    want("study-nomad", r[0].n >= 5);
  }
  if (ctx.friend && !has.has("good-company")) {
    const r = await q.query(`SELECT count(*)::int AS n FROM checkins WHERE user_id=$1 AND ${VALID} AND (context->>'friend')::boolean`, [userId]);
    want("good-company", r[0].n >= 5);
  }

  for (const id of candidates) {
    await q.query("INSERT INTO badges (user_id, badge_id, meta) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [userId, id, "{}"]);
  }
  return candidates;
}

export async function maybeLocalGuide(q: Queryable, userId: string) {
  const r = await q.query(`SELECT count(*)::int AS n FROM tips WHERE user_id=$1 AND status='live' AND helpful_count >= 1`, [userId]);
  if (r[0].n >= 5) await q.query("INSERT INTO badges (user_id, badge_id, meta) VALUES ($1,'local-guide','{}') ON CONFLICT DO NOTHING", [userId]);
}

export const stationLines = (stationId: string) => stationById.get(stationId)?.routes ?? [];
