/**
 * Events are data, not code: a start, an end and a rule. Seasonal events, Boston's
 * calendar, shutdown weekends and partner slow-hour bonuses all use this shape.
 *
 * rule: {
 *   multiplier?: number, bonus?: number,
 *   lines?: string[], stations?: string[], spotIds?: string[], kinds?: string[],
 *   days?: number[] (0=Sun..6=Sat), startHour?: number, endHour?: number (local, end exclusive),
 *   requires?: "snow" | "cold", flag?: "finals" | "first-week"
 * }
 */
import type { Queryable } from "../db/index.js";
import type { ActiveEventEffect } from "./scoring.js";

export interface EventRule {
  multiplier?: number;
  bonus?: number;
  lines?: string[];
  stations?: string[];
  spotIds?: string[];
  kinds?: string[];
  days?: number[];
  startHour?: number;
  endHour?: number;
  requires?: "snow" | "cold";
  flag?: string;
}

export interface EventRow {
  id: string;
  name: string;
  description?: string | null;
  kind: string;
  starts_at: Date;
  ends_at: Date;
  rule: EventRule;
  partner_id?: string | null;
  needs_confirmation?: boolean;
}

export interface EventContext {
  now: Date;
  stationId: string;
  stationRoutes: string[];
  spotId: string;
  spotKind: string;
  weather: { snowing: boolean; warmUp: boolean } | null;
}

export function ruleMatches(rule: EventRule, c: EventContext): boolean {
  if (rule.lines?.length && !rule.lines.some((l) => c.stationRoutes.includes(l))) return false;
  if (rule.stations?.length && !rule.stations.includes(c.stationId)) return false;
  if (rule.spotIds?.length && !rule.spotIds.includes(c.spotId)) return false;
  if (rule.kinds?.length && !rule.kinds.includes(c.spotKind)) return false;
  if (rule.days?.length && !rule.days.includes(c.now.getDay())) return false;
  const h = c.now.getHours();
  if (rule.startHour != null && rule.endHour != null) {
    const inWindow = rule.startHour <= rule.endHour ? h >= rule.startHour && h < rule.endHour : h >= rule.startHour || h < rule.endHour;
    if (!inWindow) return false;
  }
  if (rule.requires === "snow" && !c.weather?.snowing) return false;
  if (rule.requires === "cold" && !c.weather?.warmUp) return false;
  return true;
}

export async function activeEvents(q: Queryable, now = new Date()): Promise<EventRow[]> {
  return q.query<EventRow>("SELECT * FROM events WHERE starts_at <= $1 AND ends_at > $1 ORDER BY starts_at", [now]);
}

export function evaluateEvents(events: EventRow[], c: EventContext) {
  const effects: ActiveEventEffect[] = [];
  const flags = new Set<string>();
  for (const e of events) {
    if (!ruleMatches(e.rule, c)) continue;
    if (e.rule.flag) flags.add(e.rule.flag);
    if (e.rule.multiplier || e.rule.bonus) effects.push({ id: e.id, name: e.name, multiplier: e.rule.multiplier, bonus: e.rule.bonus });
  }
  return { effects, flags };
}
