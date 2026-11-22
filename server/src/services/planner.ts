/**
 * Stop Planner (Mastra agent on Gemini).
 * "$10, two hours, spicy food, then somewhere quiet to study" → the agent calls tools for
 * nearest stations, line alerts, food, study spots and rent, then returns one plan.
 * Every tool call is recorded so the app can show the steps. Without a Gemini key the
 * same tools run in a fixed order (rule-based fallback), so the panel still works.
 */
import { z } from "zod";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { geminiEnabled } from "../lib/gemini.js";
import { haversineM } from "../lib/geo.js";
import { nearestStations as nearest, rentCache, stationById, routeById } from "../lib/static.js";
import { findSpots, CRAVINGS } from "./spots.js";
import { lineStatuses } from "./transit.js";
import { getWeather } from "../lib/external.js";

export interface PlanStep { tool: string; input: unknown; output: unknown; ms: number }
export interface Plan { engine: string; text: string; steps: PlanStep[]; stops: { stationId: string; name: string; spot?: any; role: string }[] }

interface Ctx { lat: number; lon: number; budgetCents: number; homeRegions: string[]; userId: string | null }

// ---- tool implementations (shared by agent and fallback) -----------------------
async function tNearestStations(c: Ctx, input: { limit?: number }) {
  return nearest(c.lat, c.lon, Math.min(input.limit ?? 5, 10)).map((x) => ({
    stationId: x.station.id, name: x.station.name, lines: x.station.routes, walkMin: Math.round((x.distanceM * 1.3) / 80),
  }));
}
async function tLineAlerts(_c: Ctx, input: { lines?: string[] }) {
  return lineStatuses()
    .filter((l) => !input.lines?.length || input.lines.includes(l.routeId))
    .map((l) => ({ line: l.name, routeId: l.routeId, chaos: l.chaos, shuttle: l.shuttle, avgDelayMin: l.avgDelayS != null ? +(l.avgDelayS / 60).toFixed(1) : null, alerts: l.alerts.slice(0, 2).map((a) => a.header) }));
}
async function tFindFood(c: Ctx, input: { stationIds: string[]; budgetCents?: number; craving?: string; openNow?: boolean }) {
  const db = await getDb();
  const out: any[] = [];
  for (const id of input.stationIds.slice(0, 8)) {
    const r = await findSpots(db, { stationId: id, budgetCents: input.budgetCents ?? c.budgetCents, craving: input.craving, openNow: input.openNow ?? true, homeRegions: c.homeRegions, userId: c.userId, limit: 2 });
    for (const s of r.food) out.push({ stationId: id, station: stationById.get(id)?.name, spotId: s.id, name: s.name, priceUsd: s.priceCents / 100, priceIsEstimate: s.priceSource === "estimate", cuisines: s.cuisines, open: s.openNow, closes: s.nextChange, walkMin: s.walkMin, local: s.localOwned });
  }
  return out.slice(0, 8);
}
async function tFindStudy(c: Ctx, input: { stationIds: string[]; openLate?: boolean }) {
  const db = await getDb();
  const out: any[] = [];
  for (const id of input.stationIds.slice(0, 6)) {
    const r = await findSpots(db, { stationId: id, openLate: input.openLate, userId: c.userId });
    for (const s of r.study.slice(0, 2)) out.push({ stationId: id, station: stationById.get(id)?.name, spotId: s.id, name: s.name, type: s.kind === "study" ? "library" : "café with wifi", open: s.openNow, closes: s.nextChange, rating: s.study_rating, walkMin: s.walkMin });
  }
  return out.slice(0, 6);
}
async function tRent(_c: Ctx, input: { stationId: string }) {
  const cache = rentCache();
  const zip = cache.stationZip[input.stationId];
  const z = zip ? cache.byZip[zip] : null;
  return z ? { stationId: input.stationId, zip, medianRent: z.median, fetchedAt: z.fetchedAt, source: "RentCast" } : { stationId: input.stationId, zip: zip ?? null, note: "No cached RentCast data for this area yet." };
}
async function tWeather() {
  const w = await getWeather();
  return w ? { tempF: w.tempF, feelsLikeF: w.feelsLikeF, snowing: w.snowing, warmUpQuest: w.warmUp } : { note: "weather unavailable" };
}

function travelMin(a: string, b: string) {
  const s1 = stationById.get(a), s2 = stationById.get(b);
  if (!s1 || !s2 || a === b) return 0;
  return Math.round(haversineM(s1.lat, s1.lon, s2.lat, s2.lon) / 400 + 5);
}

function recorder(steps: PlanStep[]) {
  return <I, O>(tool: string, fn: (input: I) => Promise<O>) =>
    async (input: I) => {
      const t = Date.now();
      const output = await fn(input);
      steps.push({ tool, input, output, ms: Date.now() - t });
      return output;
    };
}

// ---- Mastra agent -----------------------------------------------------------------
async function planWithMastra(query: string, c: Ctx): Promise<Plan> {
  const { Agent } = await import("@mastra/core/agent");
  const { createTool } = await import("@mastra/core/tools");
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const steps: PlanStep[] = [];
  const rec = recorder(steps);

  const tools = {
    nearestStations: createTool({
      id: "nearestStations",
      description: "T stations nearest the student's current location, with lines and walking minutes.",
      inputSchema: z.object({ limit: z.number().optional() }),
      execute: rec("nearestStations", (i: any) => tNearestStations(c, i)),
    }),
    lineAlerts: createTool({
      id: "lineAlerts",
      description: "Live MBTA status per line: Chaos Score 0-100, shutdown/shuttle, average delay, alert headlines.",
      inputSchema: z.object({ lines: z.array(z.string()).optional().describe("route ids like Red, Orange, Blue, Green-B") }),
      execute: rec("lineAlerts", (i: any) => tLineAlerts(c, i)),
    }),
    findFood: createTool({
      id: "findFood",
      description: `Cheap food near given stations, under a budget (cents), optional craving (${Object.keys(CRAVINGS).join(", ")}, home, or free text). Prices are often estimates.`,
      inputSchema: z.object({ stationIds: z.array(z.string()), budgetCents: z.number().optional(), craving: z.string().optional(), openNow: z.boolean().optional() }),
      execute: rec("findFood", (i: any) => tFindFood(c, i)),
    }),
    findStudySpots: createTool({
      id: "findStudySpots",
      description: "Libraries and cafés with wifi near given stations, with student ratings for outlets/noise/wifi.",
      inputSchema: z.object({ stationIds: z.array(z.string()), openLate: z.boolean().optional() }),
      execute: rec("findStudySpots", (i: any) => tFindStudy(c, i)),
    }),
    rentSnapshot: createTool({
      id: "rentSnapshot",
      description: "Typical rent near a station from cached RentCast data (use only if the student asks about living/rent).",
      inputSchema: z.object({ stationId: z.string() }),
      execute: rec("rentSnapshot", (i: any) => tRent(c, i)),
    }),
    weatherNow: createTool({
      id: "weatherNow",
      description: "Current Boston weather; cold or snow means prefer indoor spots.",
      inputSchema: z.object({}),
      execute: rec("weatherNow", () => tWeather()),
    }),
  };

  const google = createGoogleGenerativeAI({ apiKey: config.gemini.apiKey });
  const agent = new Agent({
    id: "stop-planner",
    name: "Stop Planner",
    instructions:
      "You plan short outings by T for Boston college students on a budget. Always: call nearestStations first, " +
      "then lineAlerts for those lines, then findFood (respect the budget and craving), then findStudySpots if they want to study, " +
      "rentSnapshot only if they mention living or rent. Prefer lines without shutdowns. Return a short plan: numbered steps with " +
      "station, spot, price (say 'about' for estimates), and rough times that fit their time budget. Mention one stop they haven't collected yet if possible. " +
      "Plain text, under 120 words. Never invent spots: only use tool results.",
    model: google(config.gemini.model) as any,
    tools,
  });
  const out: any = await agent.generate(query, { maxSteps: 8 } as any);
  return { engine: `Mastra agent · Gemini (${config.gemini.model})`, text: String(out.text || "").trim(), steps, stops: stopsFromSteps(steps) };
}

function stopsFromSteps(steps: PlanStep[]) {
  const stops: Plan["stops"] = [];
  const food = steps.find((s) => s.tool === "findFood")?.output as any[] | undefined;
  if (food?.[0]) stops.push({ stationId: food[0].stationId, name: food[0].station, spot: food[0], role: "eat" });
  const study = steps.find((s) => s.tool === "findStudySpots")?.output as any[] | undefined;
  if (study?.[0]) stops.push({ stationId: study[0].stationId, name: study[0].station, spot: study[0], role: "study" });
  return stops;
}

// ---- rule-based fallback ------------------------------------------------------------
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, half: 0.5 };

export function parseQuery(q: string) {
  const s = q.toLowerCase();
  const budget = s.match(/\$\s?(\d+(?:\.\d+)?)/);
  const hours = s.match(/(\d+(?:\.\d+)?|one|two|three|four|half)\s*(?:hours?|hrs?|h)\b/);
  const mins = s.match(/(\d+)\s*(?:minutes?|mins?)\b/);
  const craving =
    (/home|from home|taste of home/.test(s) && "home") ||
    Object.keys(CRAVINGS).find((k) => s.includes(k) || s.includes(CRAVINGS[k].label.toLowerCase())) ||
    (/ramen|pho|dumpling/.test(s) && "noodles") ||
    (/dessert|bubble tea|boba|ice cream|cake/.test(s) && "sweet") ||
    undefined;
  return {
    budgetCents: budget ? Math.round(Number(budget[1]) * 100) : null,
    minutes: hours ? (WORD_NUM[hours[1]] ?? Number(hours[1])) * 60 : mins ? Number(mins[1]) : 120,
    craving,
    study: /study|quiet|focus|library|homework|work on|laptop/.test(s),
    late: /late|tonight|midnight|night/.test(s),
    rent: /rent|apartment|live|move|sublet|housing/.test(s),
  };
}

async function planFallback(query: string, c: Ctx): Promise<Plan> {
  const steps: PlanStep[] = [];
  const rec = recorder(steps);
  const p = parseQuery(query);
  const budget = p.budgetCents ?? c.budgetCents;

  const near = await rec("nearestStations", (i: { limit: number }) => tNearestStations(c, i))({ limit: 6 });
  const lines = [...new Set(near.flatMap((n) => n.lines))];
  const status = await rec("lineAlerts", (i: { lines: string[] }) => tLineAlerts(c, i))({ lines });
  await rec("weatherNow", () => tWeather())({});
  const shut = new Set(status.filter((s) => s.shuttle).map((s) => s.routeId));
  const usable = near.filter((n) => n.lines.some((l) => !shut.has(l)));
  const candidates = (usable.length ? usable : near).map((n) => n.stationId);

  const findFood = rec("findFood", (i: any) => tFindFood(c, i));
  let note = "";
  let food = await findFood({ stationIds: candidates, budgetCents: budget, craving: p.craving, openNow: true });
  if (!food.length) {
    food = await findFood({ stationIds: candidates, budgetCents: budget, craving: p.craving, openNow: false });
    if (food.length) note = "Nothing confirmed open right now; check hours before you go.";
  }
  if (!food.length) {
    food = await findFood({ stationIds: candidates, budgetCents: Math.round(budget * 1.5), craving: p.craving, openNow: false });
    if (food.length) note = `Nothing under $${(budget / 100).toFixed(0)} for that craving nearby; this is the closest match.`;
  }
  const pick = food.find((f) => f.priceUsd * 100 <= budget) ?? food[0];
  let study: any[] = [];
  if (p.study) {
    const from = pick?.stationId ?? candidates[0];
    const nearFood = nearest(stationById.get(from)!.lat, stationById.get(from)!.lon, 4).map((x) => x.station.id);
    study = await rec("findStudySpots", (i: any) => tFindStudy(c, i))({ stationIds: nearFood, openLate: p.late });
  }
  if (p.rent && pick) await rec("rentSnapshot", (i: any) => tRent(c, i))({ stationId: pick.stationId });

  const lines2: string[] = [];
  const start = near[0];
  if (!pick) {
    lines2.push(`Nothing open under $${(budget / 100).toFixed(0)}${p.craving ? ` for "${p.craving}"` : ""} near you right now. Try a bigger budget or another craving.`);
  } else {
    const ride = travelMin(start.stationId, pick.stationId);
    const via = stationById.get(pick.stationId)!.routes.map((r) => routeById.get(r)?.short).join("/");
    lines2.push(
      `1. ${ride ? `Ride the ${via} to ${pick.station} (about ${ride} min)` : `Walk to ${pick.station}`}, then ${pick.walkMin} min to ${pick.name}: ${pick.priceIsEstimate ? "about " : ""}$${pick.priceUsd.toFixed(2)}${pick.closes ? `, ${pick.closes}` : ""}.`,
    );
    const s = study.find((x) => x.open !== false) ?? study[0];
    if (s) {
      const r2 = travelMin(pick.stationId, s.stationId);
      lines2.push(`2. ${r2 ? `Then ${r2} min to ${s.station}` : "Then stay nearby"}: study at ${s.name} (${s.type}${s.closes ? `, ${s.closes}` : ""}).`);
    }
    const used = ride + pick.walkMin * 2 + 35;
    lines2.push(`Fits in about ${Math.min(p.minutes, used + (s ? 60 : 0))} of your ${p.minutes} minutes.`);
    if (note) lines2.push(note);
    const alerts = status.filter((x) => x.shuttle || x.chaos >= 40);
    if (alerts.length) lines2.push(`Heads up: ${alerts.map((a) => `${a.line} chaos ${a.chaos}${a.shuttle ? " (shuttle)" : ""}`).join(", ")}.`);
  }
  return { engine: "Rule-based fallback (set GEMINI_API_KEY for the Mastra agent)", text: lines2.join("\n"), steps, stops: stopsFromSteps(steps) };
}

export async function plan(query: string, c: Ctx): Promise<Plan> {
  if (geminiEnabled()) {
    try {
      return await planWithMastra(query, c);
    } catch (e) {
      console.warn("[planner] Mastra agent failed, using fallback:", (e as Error).message);
      const p = await planFallback(query, c);
      p.engine += ` · agent error: ${(e as Error).message.slice(0, 80)}`;
      return p;
    }
  }
  return planFallback(query, c);
}
