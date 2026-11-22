import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { schoolById } from "../data/schools.js";
import { geminiEnabled, translateAI } from "../lib/gemini.js";
import { stationById } from "../lib/static.js";
import { HttpError, rateLimit, sha256 } from "../lib/util.js";
import { plan } from "../services/planner.js";

export const aiRoutes = Router();

aiRoutes.get("/plan", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 300);
  if (!q) throw new HttpError(400, "Ask something like “$10, two hours, spicy food, then somewhere quiet to study”");
  if (!rateLimit(`plan:${req.user?.id ?? req.ip}`, 15, 10 * 60_000)) throw new HttpError(429, "Planner is busy; try again in a minute");
  let lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    // no GPS: start from the student's home station
    const home = stationById.get(schoolById(req.user?.school_id ?? "neu")!.homeStations[0])!;
    lat = home.lat;
    lon = home.lon;
  }
  res.json(
    await plan(q, {
      lat, lon,
      budgetCents: req.user?.budget_cents ?? config.game.defaultBudgetCents,
      homeRegions: req.user?.home_regions ?? [],
      userId: req.user?.id ?? null,
    }),
  );
});

/** Translate dynamic text (descriptions, quest text) into the student's language, cached per string. */
aiRoutes.post("/translate", async (req, res) => {
  const b = z.object({ lang: z.string().min(2).max(10), texts: z.array(z.string().max(1000)).max(80) }).parse(req.body);
  if (b.lang === "en") return res.json({ texts: b.texts });
  res.json({ texts: await translateCached(b.lang, b.texts.map((t) => [sha256(t).slice(0, 24), t])) });
});

/** Translate the UI string table for languages without a built-in table. */
aiRoutes.post("/i18n", async (req, res) => {
  const b = z.object({ lang: z.string().min(2).max(10), strings: z.record(z.string(), z.string().max(400)) }).parse(req.body);
  const entries = Object.entries(b.strings).slice(0, 400);
  const out = await translateCached(b.lang, entries.map(([k, v]) => [`ui:${k}:${sha256(v).slice(0, 8)}`, v]));
  res.json({ lang: b.lang, strings: Object.fromEntries(entries.map(([k], i) => [k, out[i]])), ai: geminiEnabled() });
});

async function translateCached(lang: string, items: [string, string][]): Promise<string[]> {
  const db = await getDb();
  const keys = items.map(([k]) => k);
  const cached = new Map(
    (await db.query<{ key: string; text: string }>("SELECT key, text FROM translations WHERE lang=$1 AND key = ANY($2)", [lang, keys])).map((r) => [r.key, r.text]),
  );
  const missing = items.filter(([k]) => !cached.has(k));
  if (missing.length && geminiEnabled()) {
    for (let i = 0; i < missing.length; i += 60) {
      const part = missing.slice(i, i + 60);
      try {
        const tr = await translateAI(part.map(([, t]) => t), lang);
        for (const [j, [k]] of part.entries()) {
          if (typeof tr[j] !== "string") continue;
          cached.set(k, tr[j]);
          await db.query("INSERT INTO translations (lang, key, text) VALUES ($1,$2,$3) ON CONFLICT (lang, key) DO UPDATE SET text=EXCLUDED.text", [lang, k, tr[j]]);
        }
      } catch (e) {
        console.warn("[translate] failed:", (e as Error).message);
      }
    }
  }
  return items.map(([k, t]) => cached.get(k) ?? t);
}
