/**
 * Stop Planner as a Mastra WORKFLOW (not a one-shot agent). Six visible steps:
 *   understand → remember → propose → check → study → write
 * - understand: Gemini turns the sentence into filters (rule parser without a key)
 * - remember:   what this student has collected, where home is, what they usually eat, what they did recently
 * - propose:    candidate spots near the student, favoring stops they haven't collected
 * - check:      every candidate is verified: open now, no shutdown/chaos on its line, in budget, not a repeat
 * - study:      a study spot near the chosen food stop (only if they asked to study)
 * - write:      Gemini writes the plan from checked facts only (template without a key)
 * Every step's input/output is recorded so the app shows the workflow thinking, step by step.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { generateJson, geminiEnabled } from "../lib/gemini.js";
import { haversineM } from "../lib/geo.js";
import { nearestStations, routeById, stationById } from "../lib/static.js";
import { findSpots } from "./spots.js";
import { lineStatuses } from "./transit.js";
import { parseQuery, type Plan, type PlanStep } from "./planner.js";

interface Ctx { lat: number; lon: number; budgetCents: number; homeRegions: string[]; userId: string | null }

export const lastRuns: { at: string; query: string; engine: string; steps: PlanStep[] }[] = [];

const travelMin = (a: string, b: string) => {
  const s1 = stationById.get(a), s2 = stationById.get(b);
  if (!s1 || !s2 || a === b) return 0;
  return Math.round(haversineM(s1.lat, s1.lon, s2.lat, s2.lon) / 400 + 5);
};

export async function planWorkflow(query: string, c: Ctx): Promise<Plan> {
  const steps: PlanStep[] = [];
  const record = async <T,>(id: string, input: unknown, fn: () => Promise<T>) => {
    const t = Date.now();
    const output = await fn();
    steps.push({ tool: id, input, output, ms: Date.now() - t });
    return output;
  };
  const any = z.any();

  const understand = createStep({
    id: "understand", description: "Turn the request into filters", inputSchema: any, outputSchema: any,
    execute: async ({ inputData }) =>
      record("understand", { query: inputData.query }, async () => {
        const rule = parseQuery(inputData.query);
        if (!geminiEnabled()) return { ...rule, budgetCents: rule.budgetCents ?? c.budgetCents, parsedBy: "rules" };
        try {
          const g = await generateJson<any>({
            prompt:
              `Extract filters from a Boston student's request. Return JSON {"budgetUsd": number|null, "minutes": number|null, "craving": one of ["pizza","noodles","spicy","coffee","sweet","sandwich","burger","asian","latin","middle_eastern","halal","vegetarian","vegan","home"] or null, "study": boolean, "late": boolean, "rent": boolean}.\nRequest: ${inputData.query}`,
            timeoutMs: 8000,
          });
          return {
            budgetCents: g.budgetUsd ? Math.round(g.budgetUsd * 100) : rule.budgetCents ?? c.budgetCents,
            minutes: g.minutes ?? rule.minutes, craving: g.craving ?? rule.craving, study: !!g.study, late: !!g.late, rent: !!g.rent,
            parsedBy: `Gemini (${config.gemini.model})`,
          };
        } catch {
          return { ...rule, budgetCents: rule.budgetCents ?? c.budgetCents, parsedBy: "rules (Gemini unavailable)" };
        }
      }),
  });

  const remember = createStep({
    id: "remember", description: "Load what this student has collected and likes", inputSchema: any, outputSchema: any,
    execute: async ({ inputData }) =>
      record("remember", { userId: c.userId ? "signed in" : "guest" }, async () => {
        if (!c.userId) return { ...inputData, memory: { collected: [], homeRegions: c.homeRegions, favCuisines: [], recentSpots: [] } };
        const db = await getDb();
        const collected = (await db.query(`SELECT station_id FROM collections WHERE user_id=$1`, [c.userId])).map((r: any) => r.station_id);
        const fav = await db.query(
          `SELECT unnest(s.cuisines) AS c, count(*)::int AS n FROM checkins k JOIN spots s ON s.id=k.spot_id WHERE k.user_id=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT 3`,
          [c.userId],
        );
        const recent = (await db.query(`SELECT spot_id FROM checkins WHERE user_id=$1 ORDER BY ts DESC LIMIT 10`, [c.userId])).map((r: any) => r.spot_id);
        return { ...inputData, memory: { collected, homeRegions: c.homeRegions, favCuisines: fav.map((f: any) => f.c), recentSpots: recent } };
      }),
  });

  const propose = createStep({
    id: "propose", description: "Find candidate spots, favoring uncollected stops", inputSchema: any, outputSchema: any,
    execute: async ({ inputData }) =>
      record("propose", { budgetCents: inputData.budgetCents, craving: inputData.craving ?? null }, async () => {
        const db = await getDb();
        const collected = new Set<string>(inputData.memory.collected);
        const cands: any[] = [];
        // widen the search (budget, then distance) until there is something to check
        for (const [budget, count] of [[inputData.budgetCents, 8], [Math.round(inputData.budgetCents * 1.6), 8], [Math.round(inputData.budgetCents * 1.6), 16]] as const) {
          if (cands.length) break;
        for (const n of nearestStations(c.lat, c.lon, count)) {
          const r = await findSpots(db, { stationId: n.station.id, budgetCents: budget, craving: inputData.craving, homeRegions: c.homeRegions, userId: c.userId, limit: 3 });
          for (const s of r.food) {
            let score = 100 - n.distanceM / 40;
            const why: string[] = [];
            if (!collected.has(n.station.id)) { score += 40; why.push("stop you haven't collected"); }
            if (s.region && c.homeRegions.includes(s.region)) { score += 25; why.push("food from home"); }
            if (s.cuisines.some((x: string) => inputData.memory.favCuisines.includes(x))) { score += 10; why.push("you usually like this"); }
            if (s.partner) { score += 8; why.push("local partner"); }
            cands.push({ spotId: s.id, name: s.name, stationId: n.station.id, station: n.station.name, priceCents: s.priceCents, priceIsEstimate: s.priceSource === "estimate", hours: s.hours, openNow: s.openNow, nextChange: s.nextChange, lines: n.station.routes, walkMin: s.walkMin, score: Math.round(score), why });
          }
        }
        }
        cands.sort((a, b) => b.score - a.score);
        return { ...inputData, candidates: cands.slice(0, 12) };
      }),
  });

  const check = createStep({
    id: "check", description: "Verify hours, line status, budget and repeats", inputSchema: any, outputSchema: any,
    execute: async ({ inputData }) =>
      record("check", { candidates: inputData.candidates.length }, async () => {
        const status = new Map(lineStatuses().map((l) => [l.routeId, l]));
        const checked = inputData.candidates.map((cand: any) => {
          const fails: string[] = [];
          if (cand.openNow === false) fails.push("closed now");
          const bad = cand.lines.map((r: string) => status.get(r)).filter((l: any) => l && (l.shuttle || l.chaos >= 60));
          if (bad.length === cand.lines.length && bad.length) fails.push(`${bad.map((l: any) => l.name).join("/")} disrupted`);
          if (cand.priceCents > inputData.budgetCents) fails.push("over budget");
          if (inputData.memory.recentSpots.includes(cand.spotId)) fails.push("you went recently");
          return { ...cand, pass: fails.length === 0, fails, hoursKnown: cand.openNow !== null };
        });
        let pick = checked.find((x: any) => x.pass && x.hoursKnown) ?? checked.find((x: any) => x.pass);
        let relaxed = false;
        if (!pick) { pick = checked.find((x: any) => x.fails.every((f: string) => f === "you went recently")) ?? checked[0]; relaxed = !!pick; }
        return { ...inputData, checked: checked.map((x: any) => ({ name: x.name, station: x.station, pass: x.pass, fails: x.fails, score: x.score })), pick, relaxed };
      }),
  });

  const study = createStep({
    id: "study", description: "Find a study spot near the food stop", inputSchema: any, outputSchema: any,
    execute: async ({ inputData }) => {
      if (!inputData.study || !inputData.pick) return { ...inputData, studyPick: null };
      return record("study", { near: inputData.pick.station, late: inputData.late }, async () => {
        const db = await getDb();
        const base = stationById.get(inputData.pick.stationId)!;
        for (const n of nearestStations(base.lat, base.lon, 4)) {
          const r = await findSpots(db, { stationId: n.station.id, openLate: inputData.late, userId: c.userId });
          const s = r.study.find((x: any) => x.openNow !== false) ?? r.study[0];
          if (s) return { ...inputData, studyPick: { spotId: s.id, name: s.name, stationId: n.station.id, station: n.station.name, type: s.kind === "study" ? "library" : "café with wifi", nextChange: s.nextChange } };
        }
        return { ...inputData, studyPick: null };
      });
    },
  });

  const write = createStep({
    id: "write", description: "Write the plan from checked facts only", inputSchema: any, outputSchema: any,
    execute: async ({ inputData }) =>
      record("write", { pick: inputData.pick?.name ?? null, study: inputData.studyPick?.name ?? null }, async () => {
        const p = inputData.pick;
        const start = nearestStations(c.lat, c.lon, 1)[0];
        if (!p) return { ...inputData, text: "Nothing passed the checks near you right now. Try a bigger budget or another craving.", writtenBy: "template" };
        const ride = travelMin(start.station.id, p.stationId);
        const via = stationById.get(p.stationId)!.routes.map((r) => routeById.get(r)?.short).join("/");
        const facts = {
          from: start.station.name, rideMin: ride, line: via, spot: p.name, station: p.station, price: `${p.priceIsEstimate ? "about " : ""}$${(p.priceCents / 100).toFixed(2)}`,
          closes: p.nextChange, why: p.why, study: inputData.studyPick, minutes: inputData.minutes, budget: `$${(inputData.budgetCents / 100).toFixed(0)}`,
          caveat: inputData.relaxed ? (p.priceCents > inputData.budgetCents ? "closest match is over the budget" : "hours could not be confirmed") : null,
        };
        if (geminiEnabled()) {
          try {
            const g = await generateJson<{ text: string }>({
              prompt: `Write a friendly plan (max 70 words, numbered steps) for a Boston student using ONLY these checked facts. Order: ride, eat at the spot, then study (if any). If caveat is set, say it plainly in one short sentence. Don't add places, prices or times that aren't in the facts. Return JSON {"text": string}.\n${JSON.stringify(facts)}`,
              timeoutMs: 9000,
            });
            if (g.text) return { ...inputData, text: g.text, writtenBy: `Gemini (${config.gemini.model})` };
          } catch { /* fall through to template */ }
        }
        const lines = [
          `1. ${ride ? `Ride the ${via} from ${start.station.name} to ${p.station} (about ${ride} min)` : `Walk to ${p.station}`}, then ${p.walkMin} min to ${p.name}: ${facts.price}${p.nextChange ? `, ${p.nextChange}` : ""}.`,
        ];
        if (p.why?.length) lines.push(`   Why: ${p.why.join(", ")}.`);
        if (inputData.studyPick) lines.push(`2. Then study at ${inputData.studyPick.name} near ${inputData.studyPick.station} (${inputData.studyPick.type}).`);
        if (inputData.relaxed) lines.push("Heads up: nothing passed every check, so this is the closest match. Check hours before you go.");
        return { ...inputData, text: lines.join("\n"), writtenBy: "template" };
      }),
  });

  const wf = createWorkflow({ id: "stop-planner", inputSchema: z.object({ query: z.string() }), outputSchema: any })
    .then(understand)
    .then(remember)
    .then(propose)
    .then(check)
    .then(study)
    .then(write)
    .commit();
  const run = await wf.createRun();
  const result: any = await run.start({ inputData: { query } });
  if (result.status !== "success") throw new Error(`workflow ${result.status}: ${result.error?.message ?? ""}`);
  const out = result.result;
  const stops: Plan["stops"] = [];
  if (out.pick) stops.push({ stationId: out.pick.stationId, name: out.pick.station, spot: out.pick, role: "eat" });
  if (out.studyPick) stops.push({ stationId: out.studyPick.stationId, name: out.studyPick.station, spot: out.studyPick, role: "study" });
  const engine = `Mastra workflow · understand: ${out.parsedBy} · write: ${out.writtenBy}`;
  lastRuns.unshift({ at: new Date().toISOString(), query, engine, steps });
  lastRuns.length = Math.min(lastRuns.length, 5);
  return { engine, text: out.text, steps, stops };
}
