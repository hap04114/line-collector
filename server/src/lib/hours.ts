import opening_hours from "opening_hours";

const cache = new Map<string, opening_hours | null>();

function parse(hours: string | null | undefined): opening_hours | null {
  if (!hours) return null;
  if (cache.has(hours)) return cache.get(hours)!;
  let oh: opening_hours | null = null;
  try {
    // address hint makes public-holiday rules resolve for Massachusetts
    oh = new opening_hours(hours, { lat: 42.36, lon: -71.06, address: { country_code: "us", state: "Massachusetts" } } as any, {
      mode: 0,
      tag_key: "opening_hours",
    } as any);
  } catch {
    oh = null;
  }
  cache.set(hours, oh);
  return oh;
}

/** true / false / null (unknown hours) */
export function isOpenAt(hours: string | null | undefined, at = new Date()): boolean | null {
  const oh = parse(hours);
  if (!oh) return null;
  try {
    return oh.getState(at);
  } catch {
    return null;
  }
}

/** Open past midnight tonight: open at 00:30 after the current evening. */
export function isOpenLate(hours: string | null | undefined, now = new Date()): boolean | null {
  const t = new Date(now);
  if (t.getHours() >= 5) t.setDate(t.getDate() + 1);
  t.setHours(0, 30, 0, 0);
  return isOpenAt(hours, t);
}

/** Next open/close change as a short label, e.g. "closes 11 PM" */
export function nextChangeLabel(hours: string | null | undefined, now = new Date()): string | null {
  const oh = parse(hours);
  if (!oh) return null;
  try {
    const open = oh.getState(now);
    const next = oh.getNextChange(now);
    if (!next) return open ? "open 24/7" : null;
    const label = next.toLocaleTimeString("en-US", { hour: "numeric", minute: next.getMinutes() ? "2-digit" : undefined });
    const day = next.toDateString() === now.toDateString() ? "" : ` ${next.toLocaleDateString("en-US", { weekday: "short" })}`;
    return `${open ? "closes" : "opens"} ${label}${day}`;
  } catch {
    return null;
  }
}
