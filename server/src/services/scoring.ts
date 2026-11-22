/**
 * The one scoring function. Pure: everything it needs is in the input, so it is
 * unit-tested and can be re-run later (pending photo checks, bring-a-friend top-ups).
 *
 * Points table (design doc):
 *   new stop 100 · new spot at a collected stop 20 · first stop on a new line +50 ·
 *   complete a line +500 · new neighborhood +150 · study check-in 50 · neutral ground (Blue) +50 ·
 *   night owl +25 (after 10 PM, finals week) · warm-up +30 (feels like ≤25°F or snow)
 *   multipliers: away game x2 · bring a friend x2 · shutdown x1.5 · events — stacked, capped at x4
 */
export interface ActiveEventEffect {
  id: string;
  name: string;
  multiplier?: number;
  bonus?: number;
}

export interface ScoreInput {
  hour: number; // Boston local hour 0-23
  spotKind: "food" | "study" | "hangout" | "landmark";
  stationRoutes: string[];
  isNewStop: boolean;
  isNewSpot: boolean;
  newLines: string[];
  completedLines: string[];
  newNeighborhood: string | null;
  awaySchool: string | null;
  friend: boolean;
  shutdownLines: string[];
  chaos: number; // 0-100, worst line at this station
  finalsWeek: boolean;
  warmUp: boolean;
  events: ActiveEventEffect[];
  lineNames?: Record<string, string>;
}

export interface Reason {
  label: string;
  points?: number;
  mult?: number;
}

export interface ScoreResult {
  points: number;
  base: number;
  multiplier: number;
  reasons: Reason[];
  flags: { nightOwl: boolean; shutdown: boolean; wickedEarly: boolean; neutralGround: boolean };
}

export const POINTS = {
  newStop: 100,
  newSpot: 20,
  newLine: 50,
  completeLine: 500,
  newNeighborhood: 150,
  study: 50,
  neutralGround: 50,
  nightOwl: 25,
  warmUp: 30,
  awayMult: 2,
  friendMult: 2,
  shutdownMult: 1.5,
  multiplierCap: 4,
};

export function scoreCheckin(i: ScoreInput): ScoreResult {
  const reasons: Reason[] = [];
  const name = (r: string) => i.lineNames?.[r] ?? r;
  let base = 0;

  if (i.isNewStop) {
    base += POINTS.newStop;
    reasons.push({ label: "new stop", points: POINTS.newStop });
  } else if (i.isNewSpot) {
    base += POINTS.newSpot;
    reasons.push({ label: "new spot at a stop you have", points: POINTS.newSpot });
  }
  if (i.spotKind === "study") {
    base += POINTS.study;
    reasons.push({ label: "study check-in", points: POINTS.study });
  }

  const flags = {
    nightOwl: false,
    shutdown: false,
    wickedEarly: i.hour >= 4 && i.hour < 8,
    neutralGround: i.stationRoutes.includes("Blue"),
  };

  if (base === 0) {
    reasons.push({ label: "repeat visit: stamps and streak only", points: 0 });
    return { points: 0, base: 0, multiplier: 1, reasons, flags };
  }

  for (const line of i.newLines) {
    base += POINTS.newLine;
    reasons.push({ label: `first ${name(line)} stop`, points: POINTS.newLine });
  }
  for (const line of i.completedLines) {
    base += POINTS.completeLine;
    reasons.push({ label: `completed the ${name(line)}`, points: POINTS.completeLine });
  }
  if (i.newNeighborhood) {
    base += POINTS.newNeighborhood;
    reasons.push({ label: `new neighborhood: ${i.newNeighborhood}`, points: POINTS.newNeighborhood });
  }
  if (flags.neutralGround) {
    base += POINTS.neutralGround;
    reasons.push({ label: "neutral ground (Blue Line)", points: POINTS.neutralGround });
  }
  if (i.finalsWeek && (i.hour >= 22 || i.hour < 4)) {
    flags.nightOwl = true;
    base += POINTS.nightOwl;
    reasons.push({ label: "night owl (finals week)", points: POINTS.nightOwl });
  }
  if (i.warmUp) {
    base += POINTS.warmUp;
    reasons.push({ label: "warm-up quest (cold or snow)", points: POINTS.warmUp });
  }
  if (i.chaos >= 40) {
    const b = Math.min(25, Math.round(i.chaos / 4));
    base += b;
    reasons.push({ label: `chaos bonus (score ${i.chaos})`, points: b });
  }
  for (const e of i.events) {
    if (e.bonus) {
      base += e.bonus;
      reasons.push({ label: e.name, points: e.bonus });
    }
  }

  let mult = 1;
  if (i.awaySchool) {
    mult *= POINTS.awayMult;
    reasons.push({ label: `away game at ${i.awaySchool}`, mult: POINTS.awayMult });
  }
  if (i.friend) {
    mult *= POINTS.friendMult;
    reasons.push({ label: "brought a friend", mult: POINTS.friendMult });
  }
  if (i.shutdownLines.length) {
    flags.shutdown = true;
    mult *= POINTS.shutdownMult;
    reasons.push({ label: `shutdown bonus (${i.shutdownLines.map(name).join(", ")})`, mult: POINTS.shutdownMult });
  }
  for (const e of i.events) {
    if (e.multiplier && e.multiplier !== 1) {
      mult *= e.multiplier;
      reasons.push({ label: e.name, mult: e.multiplier });
    }
  }
  const capped = Math.min(POINTS.multiplierCap, mult);
  if (capped < mult) reasons.push({ label: `multipliers capped at x${POINTS.multiplierCap}` });

  return { points: Math.round(base * capped), base, multiplier: capped, reasons, flags };
}

/** Short reason strings for the UI, e.g. "+100 new stop", "x2 away game at BU" */
export const formatReasons = (r: Reason[]) =>
  r.map((x) => (x.mult ? `x${x.mult} ${x.label}` : x.points ? `+${x.points} ${x.label}` : x.label));
