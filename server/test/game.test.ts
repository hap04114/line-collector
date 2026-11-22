import { describe, expect, it } from "vitest";
process.env.TZ = "America/New_York";
import { scoreCheckin, type ScoreInput } from "../src/services/scoring.js";
import { ruleMatches } from "../src/services/events.js";
import { nextStreak, streakStatus, localDate } from "../src/services/checkin.js";
import { extractRent, priceFlag, ruleFlags } from "../src/services/listing.js";
import { parseQuery } from "../src/services/planner.js";
import { chaosScore } from "../src/services/transit.js";
import { hamming } from "../src/lib/photo.js";
import { schoolForEmail } from "../src/data/schools.js";

const base: ScoreInput = {
  hour: 13, spotKind: "food", stationRoutes: ["Green-E"], isNewStop: true, isNewSpot: true, newLines: [], completedLines: [],
  newNeighborhood: null, awaySchool: null, friend: false, shutdownLines: [], chaos: 0, finalsWeek: false, warmUp: false, events: [],
};

describe("scoring", () => {
  it("new stop is 100", () => expect(scoreCheckin(base).points).toBe(100));
  it("new spot at a collected stop is 20", () => expect(scoreCheckin({ ...base, isNewStop: false }).points).toBe(20));
  it("repeat visit scores 0", () => expect(scoreCheckin({ ...base, isNewStop: false, isNewSpot: false }).points).toBe(0));
  it("study check-in adds 50, even on repeat visits", () => {
    expect(scoreCheckin({ ...base, spotKind: "study" }).points).toBe(150);
    expect(scoreCheckin({ ...base, spotKind: "study", isNewStop: false, isNewSpot: false }).points).toBe(50);
  });
  it("adds line, completion and neighborhood bonuses", () => {
    const r = scoreCheckin({ ...base, newLines: ["Green-E"], completedLines: ["Green-E"], newNeighborhood: "Fenway" });
    expect(r.points).toBe(100 + 50 + 500 + 150);
  });
  it("Blue Line is neutral ground +50", () => expect(scoreCheckin({ ...base, stationRoutes: ["Blue"] }).points).toBe(150));
  it("away game and friend multiply, capped at x4", () => {
    expect(scoreCheckin({ ...base, awaySchool: "BU" }).points).toBe(200);
    const r = scoreCheckin({ ...base, awaySchool: "BU", friend: true, shutdownLines: ["Red"], events: [{ id: "e", name: "x2 event", multiplier: 2 }] });
    expect(r.multiplier).toBe(4);
    expect(r.points).toBe(400);
  });
  it("night owl only during finals after 10 PM", () => {
    expect(scoreCheckin({ ...base, hour: 23, finalsWeek: true }).points).toBe(125);
    expect(scoreCheckin({ ...base, hour: 23, finalsWeek: false }).points).toBe(100);
    expect(scoreCheckin({ ...base, hour: 23, finalsWeek: true }).flags.nightOwl).toBe(true);
  });
  it("warm-up +30 and wicked early flag", () => {
    expect(scoreCheckin({ ...base, warmUp: true }).points).toBe(130);
    expect(scoreCheckin({ ...base, hour: 7 }).flags.wickedEarly).toBe(true);
  });
  it("shows reasons", () => {
    const r = scoreCheckin({ ...base, awaySchool: "BU" });
    expect(r.reasons.map((x) => x.label)).toEqual(["new stop", "away game at BU"]);
  });
});

describe("events", () => {
  const ctx = { now: new Date(2026, 11, 4, 15), stationId: "place-kencl", stationRoutes: ["Green-B", "Green-C"], spotId: "s1", spotKind: "food", weather: null };
  it("matches lines", () => {
    expect(ruleMatches({ multiplier: 2, lines: ["Green-B"] }, ctx)).toBe(true);
    expect(ruleMatches({ multiplier: 2, lines: ["Red"] }, ctx)).toBe(false);
  });
  it("matches slow hours on weekdays", () => {
    expect(ruleMatches({ days: [1, 2, 3, 4, 5], startHour: 14, endHour: 17 }, ctx)).toBe(true); // Fri Dec 4, 3 PM
    expect(ruleMatches({ days: [1, 2, 3, 4, 5], startHour: 14, endHour: 17 }, { ...ctx, now: new Date(2026, 11, 4, 18) })).toBe(false);
  });
  it("wraps late-night windows", () => {
    expect(ruleMatches({ startHour: 22, endHour: 4 }, { ...ctx, now: new Date(2026, 11, 5, 1) })).toBe(true);
    expect(ruleMatches({ startHour: 22, endHour: 4 }, { ...ctx, now: new Date(2026, 11, 5, 12) })).toBe(false);
  });
  it("requires snow", () => expect(ruleMatches({ requires: "snow" }, ctx)).toBe(false));
});

describe("weekly streak", () => {
  const user = (last: string | null, weeks = 1, skips = 1, month: string | null = "2026-11") => ({ streak_weeks: weeks, streak_last_week: last, skips_left: skips, skips_month: month });
  const now = new Date(2026, 10, 21, 12); // Sat Nov 21, week of Mon Nov 16
  it("starts at 1", () => expect(nextStreak(user(null, 0), now).weeks).toBe(1));
  it("same week keeps it", () => expect(nextStreak(user("2026-11-16", 3), now).weeks).toBe(3));
  it("next week adds one", () => expect(nextStreak(user("2026-11-09", 3), now).weeks).toBe(4));
  it("a missed week uses the monthly skip", () => {
    const r = nextStreak(user("2026-11-02", 3), now);
    expect(r).toMatchObject({ weeks: 4, usedSkip: true, skipsLeft: 0 });
  });
  it("no skip left resets", () => expect(nextStreak(user("2026-11-02", 3, 0), now).weeks).toBe(1));
  it("skips refill each month", () => expect(nextStreak(user("2026-11-02", 3, 0, "2026-10"), now).usedSkip).toBe(true));
  it("status reads date-only strings in Boston time", () => {
    expect(localDate("2026-11-16").getDate()).toBe(16);
    expect(streakStatus(user("2026-11-16", 2), now).state).toBe("safe");
    expect(streakStatus(user("2026-11-09", 2), now).state).toBe("due");
  });
});

describe("listing check rules", () => {
  const scam =
    "Sunny 1BR near Northeastern, $950/mo! Broker fee: one month. I'm overseas so I can't show the apartment, keys will be mailed. Wire the deposit today to hold it.";
  it("flags broker fee, payment, owner abroad, no viewing, pressure", () => {
    const types = ruleFlags(scam).map((f) => f.type);
    for (const t of ["broker_fee", "payment_method", "owner_abroad", "no_viewing", "pressure"]) expect(types).toContain(t);
  });
  it("respects no-fee listings", () => expect(ruleFlags("Great 2BR, no fee, landlord pays broker fee").map((f) => f.type)).not.toContain("broker_fee"));
  it("flags deposits over one month", () => expect(ruleFlags("Security deposit of two months required").map((f) => f.type)).toContain("upfront_costs"));
  it("extracts rent", () => expect(extractRent("only $1,850/mo")).toBe(1850));
  it("no price flag without rent data", () => expect(priceFlag(950, "99999", 1).flag).toBeNull());
});

describe("misc", () => {
  it("parses planner queries", () => {
    expect(parseQuery("$10, two hours, spicy food, then somewhere quiet to study")).toMatchObject({ budgetCents: 1000, minutes: 120, craving: "spicy", study: true });
  });
  it("chaos score grows with delay, alerts and shutdowns", () => {
    expect(chaosScore(0, 0, false)).toBe(0);
    expect(chaosScore(300, 7, true)).toBe(40 + 28 + 25);
    expect(chaosScore(10_000, 10, true)).toBe(100);
  });
  it("hamming distance", () => expect(hamming("ff00000000000000", "0f00000000000000")).toBe(4));
  it("school email domains include subdomains", () => {
    expect(schoolForEmail("a@g.harvard.edu")?.id).toBe("harvard");
    expect(schoolForEmail("a@northeastern.edu")?.id).toBe("neu");
    expect(schoolForEmail("a@gmail.com")).toBeNull();
    expect(schoolForEmail("a@notbu.edu")).toBeNull();
  });
});
