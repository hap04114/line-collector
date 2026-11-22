/**
 * "Search all of Boston": Gemini with Grounding with Google Search finds events on the open web.
 * Only events Gemini can tie to a real search result are kept, and each one links to its source.
 * Google requires apps using grounding to show its Search Suggestions, so we return that HTML too.
 */
import { config } from "../config.js";
import { geminiEnabled } from "../lib/gemini.js";

export interface WebSource { title: string; uri: string }
export interface WebEvent {
  title: string;
  date: string | null; // YYYY-MM-DD, Boston time
  time: string | null;
  venue: string | null;
  neighborhood: string | null;
  price: string | null;
  free: boolean | null;
  /** the event page, only when its domain matches a page Google actually returned */
  url: string | null;
  why: string | null;
  sources: WebSource[];
}
export interface WebSearch {
  events: WebEvent[];
  /** false when Gemini answered but none of its events could be tied to a source */
  verified: boolean;
  sources: WebSource[];
  suggestionsHtml: string | null;
  searchQueries: string[];
}

const str = (v: unknown, max = 160) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };

/** Turn a grounded generateContent response into checked events. Pure, so it's unit-tested. */
export function parseGrounded(json: any, window: { from: string; to: string }): WebSearch {
  const cand = json?.candidates?.[0];
  const text: string = (cand?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("");
  const gm = cand?.groundingMetadata ?? {};
  const chunks: WebSource[] = (gm.groundingChunks ?? [])
    .map((c: any) => c?.web)
    .filter((w: any) => typeof w?.uri === "string" && /^https:\/\//.test(w.uri))
    .map((w: any) => ({ title: String(w.title ?? host(w.uri) ?? "source").slice(0, 80), uri: w.uri }));
  const supports: any[] = gm.groundingSupports ?? [];
  const domains = chunks.map((c) => c.title.replace(/^www\./, "").toLowerCase());

  let raw: any = null;
  try { raw = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { raw = JSON.parse(m[0]); } catch { /* not JSON */ } }
  }
  const list: any[] = Array.isArray(raw?.events) ? raw.events : Array.isArray(raw) ? raw : [];

  const all = list.slice(0, 12).flatMap((e): (WebEvent & { linked: boolean })[] => {
    const title = str(e?.title, 140);
    if (!title) return [];
    const date = typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null;
    if (date && (date < window.from || date > window.to)) return [];
    // sources: grounding supports whose text mentions this event
    const idx = new Set<number>();
    const probe = title.length > 24 ? title.slice(0, 24) : title;
    for (const s of supports) {
      const t = s?.segment?.text;
      if (typeof t === "string" && t.includes(probe)) for (const i of s.groundingChunkIndices ?? []) idx.add(i);
    }
    const sources = [...idx].map((i) => chunks[i]).filter(Boolean).slice(0, 3);
    const h = typeof e.url === "string" ? host(e.url) : null;
    const direct = !!h && /^https?:\/\//.test(e.url) && domains.some((d) => h === d || h.endsWith(`.${d}`) || d.endsWith(`.${h}`));
    return [{
      title, date, time: str(e.time, 40), venue: str(e.venue, 120), neighborhood: str(e.neighborhood, 60), price: str(e.price, 40),
      free: typeof e.free === "boolean" ? e.free : null, url: direct ? e.url : null, why: str(e.why, 200), sources, linked: direct || sources.length > 0,
    }];
  });
  const linked = all.filter((e) => e.linked);
  const pick = linked.length ? linked : chunks.length ? all : [];
  return {
    events: pick.slice(0, 8).map(({ linked: _l, ...e }) => e),
    verified: linked.length > 0,
    sources: chunks.slice(0, 8),
    suggestionsHtml: typeof gm.searchEntryPoint?.renderedContent === "string" ? gm.searchEntryPoint.renderedContent : null,
    searchQueries: Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.slice(0, 5) : [],
  };
}

export const cleanQuery = (q: string) => q.replace(/[\r\n\t"`]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export async function searchBostonWeb(opt: { q: string; from: string; to: string; budget: number; timeoutMs?: number }): Promise<WebSearch & { model: string }> {
  if (!geminiEnabled()) throw new Error("GEMINI_API_KEY not set");
  const q = cleanQuery(opt.q);
  const system = [
    "You find real, upcoming in-person events in Boston, Cambridge, Somerville and Brookline for college students, using Google Search.",
    "Only list events you saw on a web page in your search results. Never invent or guess events, dates or prices.",
    `Only include events happening between ${opt.from} and ${opt.to} (America/New_York).`,
    'Reply with JSON only, no prose: {"events":[{"title":string,"date":"YYYY-MM-DD","time":string|null,"venue":string|null,"neighborhood":string|null,"price":string|null,"free":boolean|null,"url":string|null,"why":string}]}',
    "Use at most 8 events. url is the event's own page from your results. why is one short line on why a student would like it.",
    'If you find nothing that fits, reply {"events":[]}.',
  ].join("\n");
  const prompt = `Search: ${q}\nBudget: ${opt.budget === 0 ? "free events only" : `free, or up to $${opt.budget}`}\nToday in Boston: ${new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  });
  const models = [config.gemini.model, ...config.gemini.fallbacks.filter((m) => m !== config.gemini.model)];
  const deadline = Date.now() + (opt.timeoutMs ?? 25_000);
  let lastErr = "";
  for (const model of models) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": config.gemini.apiKey },
        body,
        signal: AbortSignal.timeout(left),
      });
      if (res.ok) return { ...parseGrounded(await res.json(), { from: opt.from, to: opt.to }), model };
      lastErr = `Gemini ${model} ${res.status}`;
      if (![429, 500, 503, 404].includes(res.status)) break;
    } catch (e) {
      lastErr = `Gemini ${model}: ${(e as Error).message}`;
    }
  }
  throw new Error(lastErr || "Web search timed out");
}
