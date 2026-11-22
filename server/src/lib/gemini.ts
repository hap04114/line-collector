/**
 * Gemini over its REST API (Google AI Studio key). Every call returns parsed JSON.
 * Callers always have a non-AI fallback, so the app still works without a key.
 */
import { config } from "../config.js";

export const geminiEnabled = () => !!config.gemini.apiKey;

interface GenOpts {
  system?: string;
  prompt: string;
  images?: { mime: string; data: Buffer }[];
  temperature?: number;
  timeoutMs?: number;
}

export async function generateJson<T = any>(opts: GenOpts): Promise<T> {
  if (!geminiEnabled()) throw new Error("GEMINI_API_KEY not set");
  const parts: any[] = [{ text: opts.prompt }];
  for (const img of opts.images || []) parts.push({ inline_data: { mime_type: img.mime, data: img.data.toString("base64") } });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemini.model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.gemini.apiKey },
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature: opts.temperature ?? 0.2 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  const text = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error("Gemini returned non-JSON");
  }
}

// ---------------------------------------------------------------------------

export interface PhotoVerdict {
  ok: boolean;
  confidence: number;
  isScreenOrScreenshot: boolean;
  reason: string;
}

export function checkPhoto(photo: Buffer, spot: { name: string; kind: string; cuisines?: string[] }, timeoutMs?: number) {
  const what =
    spot.kind === "food" ? `food, a drink, a menu, a counter or the inside/outside of "${spot.name}"${spot.cuisines?.length ? ` (${spot.cuisines.join(", ")})` : ""}`
    : spot.kind === "study" ? `a study setting: a library, a café table with a laptop or books, or "${spot.name}"`
    : `an outdoor place, park, landmark or view consistent with "${spot.name}"`;
  return generateJson<PhotoVerdict>({
    system:
      "You verify check-in photos for a student exploration game. Be fair but skeptical. " +
      "Reject photos of screens, screenshots, stock-looking images, blank or black frames, and selfies with no place visible.",
    prompt:
      `A student says they are at "${spot.name}" (${spot.kind}). The photo should plausibly show ${what}. ` +
      `You can't confirm the exact business; judge whether it plausibly fits. ` +
      `Return JSON: {"ok": boolean, "confidence": number 0..1, "isScreenOrScreenshot": boolean, "reason": "one short sentence"}`,
    images: [{ mime: "image/jpeg", data: photo }],
    timeoutMs,
  });
}

export interface ListingFlag {
  type: "broker_fee" | "payment_method" | "owner_abroad" | "no_viewing" | "pressure" | "upfront_costs" | "price" | "identity" | "other";
  severity: "high" | "medium" | "low";
  quote: string;
  explanation: string;
}

export function scanListingAI(text: string, image?: { mime: string; data: Buffer }) {
  return generateJson<{ flags: ListingFlag[]; summary: string; extracted?: { monthlyRent?: number; bedrooms?: number; zip?: string; brokerFee?: string } }>({
    system:
      "You help college students in Massachusetts spot rental scams and fees they may not owe. You are not a lawyer; " +
      "flag likely issues plainly. Context: since Aug 1, 2025 Massachusetts law says whoever hires the broker pays the broker fee, " +
      "so a tenant usually does not owe a fee for a broker the landlord hired. Massachusetts generally limits upfront charges " +
      "to first month, last month, a security deposit up to one month's rent, and the cost of a new lock. " +
      "Common scam signs: owner abroad/traveling, can't show the unit, keys by mail, wire/Zelle/gift card/crypto payment, " +
      "pressure to pay now, deposit before viewing, price far below market, moving the conversation off-platform.",
    prompt:
      `Review this rental or sublet listing${image ? " (text and/or screenshot)" : ""}. ` +
      `Return JSON {"flags":[{"type":"broker_fee|payment_method|owner_abroad|no_viewing|pressure|upfront_costs|price|identity|other","severity":"high|medium|low","quote":"short exact phrase from the listing","explanation":"one sentence for a student"}],` +
      `"summary":"one sentence","extracted":{"monthlyRent":number|null,"bedrooms":number|null,"zip":"string|null","brokerFee":"string|null"}}. ` +
      `Only flag what the listing actually says or implies.\n\nLISTING:\n${text.slice(0, 6000)}`,
    images: image ? [image] : [],
  });
}

export function vibeTagsAI(spots: { id: string; name: string; amenity: string; cuisines: string[] }[]) {
  return generateJson<Record<string, string[]>>({
    system: "You tag Boston food and hangout spots for students. Use only these tags: cozy, photogenic, good for groups, quiet, late-night, quick bite.",
    prompt:
      "For each spot return 1-3 tags you are reasonably confident about from its name and type. " +
      'Return JSON object {"<id>": ["tag", ...]}.\n' +
      JSON.stringify(spots.map((s) => ({ id: s.id, name: s.name, type: s.amenity, cuisine: s.cuisines.join(",") }))),
  });
}

export function translateAI(texts: string[], lang: string) {
  return generateJson<string[]>({
    system: "You translate short UI strings and descriptions for a student app. Keep emoji, numbers, $ amounts, place names and {placeholders} unchanged.",
    prompt: `Translate each string into the language with code "${lang}". Return a JSON array of strings in the same order.\n${JSON.stringify(texts)}`,
    temperature: 0.1,
  });
}

export function screenTipAI(text: string) {
  return generateJson<{ ok: boolean; reason: string }>({
    system: "You moderate short tips students leave for each other about T stations and food spots.",
    prompt:
      "Reject harassment, hate, sexual content, personal info about private people, spam/ads, or dangerous advice. " +
      `Allow ordinary opinions and practical tips. Return JSON {"ok": boolean, "reason": "short"}.\nTIP: ${text.slice(0, 500)}`,
    timeoutMs: 8000,
  });
}

// ---- embeddings (search by meaning) -------------------------------------------------
export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
export const EMBED_DIM = 768;

/** Batch-embeds texts; vectors are L2-normalized (needed below 3072 dims). */
export async function embedTexts(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[][]> {
  if (!geminiEnabled()) throw new Error("GEMINI_API_KEY not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.gemini.apiKey },
    body: JSON.stringify({
      requests: texts.map((text) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] }, taskType, outputDimensionality: EMBED_DIM })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  return j.embeddings.map((e: any) => {
    const v: number[] = e.values;
    const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
    return v.map((x) => x / n);
  });
}

export interface MenuItem { name: string; price: number }
/** Reads a menu photo into structured items and prices. */
export function readMenuAI(photo: Buffer, spotName: string) {
  return generateJson<{ items: MenuItem[]; currency: string; confidence: number }>({
    system: "You read restaurant menu photos and extract items with prices exactly as printed. Never guess a price that isn't visible.",
    prompt:
      `This is a menu photo from "${spotName}" in Boston. Return JSON {"items":[{"name": string, "price": number}], "currency": "USD", "confidence": 0..1}. ` +
      `Include up to 40 items with a clearly visible price. Skip items without a price. Use the base price if several sizes are listed.`,
    images: [{ mime: "image/jpeg", data: photo }],
    timeoutMs: 30_000,
  });
}
