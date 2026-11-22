/**
 * Listing check: paste any listing (or a screenshot) → broker-fee and scam flags.
 * Rules run first and always; Gemini adds what rules miss. Not legal advice.
 */
import { geminiEnabled, scanListingAI, type ListingFlag } from "../lib/gemini.js";
import { rentCache } from "../lib/static.js";

export const BROKER_FEE_GUIDANCE = "https://www.mass.gov/search?q=broker%20fee";

interface Rule { type: ListingFlag["type"]; severity: ListingFlag["severity"]; re: RegExp; explanation: string }

const RULES: Rule[] = [
  {
    type: "broker_fee", severity: "high",
    re: /\b(broker(?:'?s)?\s*fee|finder'?s?\s*fee|realtor\s*fee|placement\s*fee|(?:one|1|full|half)[\s-]*month(?:'s)?\s*(?:broker\s*)?fee|fee\s*:\s*(?:one|1)\s*month)\b/i,
    explanation: "Since Aug 1, 2025, Massachusetts law says whoever hires the broker pays the fee. If the landlord hired this broker, you may not owe it. Ask who hired them.",
  },
  {
    type: "payment_method", severity: "high",
    re: /\b(wire\s*(?:transfer|the|me|money)?|western\s*union|moneygram|gift\s*cards?|bitcoin|crypto|usdt|zelle|cash\s*app|venmo)\b/i,
    explanation: "Scammers ask for wire, gift card, crypto or instant app payments because they can't be reversed. Pay only after a viewing, by a traceable method, to a verified landlord.",
  },
  {
    type: "owner_abroad", severity: "high",
    re: /\b(out of (?:the )?country|overseas|abroad|missionary|deployed|military\s+(?:assignment|deployment)|relocated\s+to|traveling\s+for\s+work|working\s+offshore)\b/i,
    explanation: "\"Owner is abroad\" is one of the most common rental scam stories. Insist on an in-person or live video viewing with someone who can open the door.",
  },
  {
    type: "no_viewing", severity: "high",
    re: /\b(no\s+viewings?|can'?t\s+(?:show|meet)|cannot\s+(?:show|meet)|keys?\s+(?:will\s+be\s+)?(?:mailed|shipped|sent)|mail\s+(?:you\s+)?the\s+keys?|drive\s+by\s+(?:only|the\s+outside)|without\s+(?:a\s+)?(?:viewing|showing))\b/i,
    explanation: "If you can't see inside before paying, treat it as a scam until proven otherwise.",
  },
  {
    type: "pressure", severity: "medium",
    re: /\b(first\s+come,?\s+first\s+serve|act\s+fast|won'?t\s+last|many\s+(?:applicants|people\s+interested)|today\s+only|pay\s+(?:now|today|immediately)|deposit\s+(?:now|today)\s+to\s+(?:hold|secure)|within\s+24\s+hours)\b/i,
    explanation: "Pressure to pay fast is designed to stop you from checking. A real landlord will wait for a viewing.",
  },
  {
    type: "no_viewing", severity: "high",
    re: /\b(deposit|payment|pay)\b[^.]{0,40}\bbefore\b[^.]{0,30}\b(viewing|showing|tour|seeing|you\s+see)\b/i,
    explanation: "Never pay before an in-person or live video viewing.",
  },
  {
    type: "upfront_costs", severity: "medium",
    re: /\b(application\s+fee|holding\s+fee|admin(?:istrative)?\s+fee|move[\s-]in\s+fee|key\s+fee|pet\s+fee|cleaning\s+fee)\b/i,
    explanation: "Massachusetts generally limits what a landlord can collect upfront to first month, last month, a security deposit up to one month's rent, and the cost of a new lock. Ask what this fee is for.",
  },
  {
    type: "upfront_costs", severity: "medium",
    re: /\b(?:security\s+deposit|deposit)\b[^.]{0,30}\b(two|2|three|3|double)\s+months?\b/i,
    explanation: "In Massachusetts a security deposit can't be more than one month's rent.",
  },
  {
    type: "identity", severity: "medium",
    re: /\b(whats\s*app|telegram|signal\s+me|text\s+me\s+(?:at|on)|email\s+me\s+(?:directly|privately)|contact\s+me\s+off)\b/i,
    explanation: "Moving the conversation off the platform right away is a common scam step. Keep records and verify who you're dealing with.",
  },
];

const NO_FEE = /\b(no[\s-]*fee|no\s+broker\s+fee|fee[\s-]*free|landlord\s+pays\s+(?:the\s+)?(?:broker\s+)?fee)\b/i;

export function extractRent(text: string): number | null {
  const m = text.match(/\$\s?(\d{1,2}[,.]?\d{3})(?:\s*(?:\/|per|a)\s*(?:mo|month))?/i) || text.match(/(\d{1,2},\d{3})\s*(?:\/|per)\s*mo/i);
  if (!m) return null;
  const v = Number(m[1].replace(/[,.]/g, ""));
  return v >= 300 && v <= 20000 ? v : null;
}

export function extractBedrooms(text: string): number | null {
  if (/\bstudio\b/i.test(text)) return 0;
  const m = text.match(/\b(\d)\s*(?:br|bd|bed(?:room)?s?)\b/i);
  return m ? Number(m[1]) : null;
}

export function extractZip(text: string): string | null {
  const m = text.match(/\b(0[12]\d{3})\b/);
  return m ? m[1] : null;
}

/** Typical rent from the cached RentCast data, if we have this ZIP. */
export function typicalRent(zip: string | null, bedrooms: number | null): { median: number; source: string } | null {
  if (!zip) return null;
  const z = rentCache().byZip[zip];
  if (!z) return null;
  const key = bedrooms == null ? "all" : String(Math.min(bedrooms, 3));
  const median = z.median?.[key] ?? z.median?.all;
  return median ? { median, source: `RentCast market data for ${zip} (cached ${String(z.fetchedAt).slice(0, 10)})` } : null;
}

export function ruleFlags(text: string): ListingFlag[] {
  const out: ListingFlag[] = [];
  const seen = new Set<string>();
  for (const r of RULES) {
    const m = text.match(r.re);
    if (!m) continue;
    if (r.type === "broker_fee" && NO_FEE.test(text) && !/\bbroker\s+fee\s*:\s*(?:one|1|full|half)/i.test(text)) continue;
    const key = `${r.type}|${m[0].toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: r.type, severity: r.severity, quote: m[0], explanation: r.explanation });
  }
  return out;
}

export function priceFlag(rent: number | null, zip: string | null, bedrooms: number | null): { flag: ListingFlag | null; typical: ReturnType<typeof typicalRent> } {
  const typical = typicalRent(zip, bedrooms);
  if (!rent || !typical) return { flag: null, typical };
  if (rent < typical.median * 0.6)
    return {
      typical,
      flag: {
        type: "price", severity: "high", quote: `$${rent.toLocaleString()}/mo`,
        explanation: `That's under 60% of the typical $${Math.round(typical.median).toLocaleString()} for this area. Too good to be true is a classic scam sign.`,
      },
    };
  return { flag: null, typical };
}

export async function checkListing(text: string, image?: { mime: string; data: Buffer }) {
  const flags = ruleFlags(text);
  let summary: string | null = null;
  let ai = false;
  let extracted: any = {};
  if (geminiEnabled()) {
    try {
      const r = await scanListingAI(text, image);
      ai = true;
      summary = r.summary;
      extracted = r.extracted || {};
      for (const f of r.flags || []) {
        if (!flags.some((x) => x.type === f.type)) flags.push(f);
      }
    } catch (e) {
      summary = null;
      console.warn("[listing] Gemini scan failed:", (e as Error).message);
    }
  }
  const rent = extractRent(text) ?? extracted.monthlyRent ?? null;
  const bedrooms = extractBedrooms(text) ?? extracted.bedrooms ?? null;
  const zip = extractZip(text) ?? extracted.zip ?? null;
  const price = priceFlag(rent, zip, bedrooms);
  if (price.flag) flags.push(price.flag);

  const order = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  const hasFee = flags.some((f) => f.type === "broker_fee");
  return {
    flags,
    summary:
      summary ||
      (flags.length
        ? `${flags.length} thing${flags.length > 1 ? "s" : ""} to check before you pay anything.`
        : "No red flags found by our checks. Still: never pay before a viewing."),
    extracted: { rent, bedrooms, zip, noFeeClaimed: NO_FEE.test(text) },
    typicalRent: price.typical,
    checkedBy: ai ? "rules + Gemini" : "rules (add GEMINI_API_KEY for AI review)",
    guidance: hasFee ? BROKER_FEE_GUIDANCE : null,
    disclaimer: "Not legal advice. Flags are likely issues to ask about, not verdicts.",
  };
}
