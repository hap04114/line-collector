// process.env.TZ is America/New_York (set in config.ts), so local getters are Boston time.

/** Monday 00:00 Boston time of the week containing d */
export function weekStart(d = new Date()): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  return x;
}

export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function startOfDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Whole weeks between two Monday week-starts */
export function weeksBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / (7 * 86400_000));
}

export const LEVELS = [
  { name: "Newcomer", min: 0 },
  { name: "Explorer", min: 1000 },
  { name: "Regular", min: 5000 },
  { name: "Local", min: 15000 },
  { name: "Townie", min: 40000 },
];

export function levelFor(points: number) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i].min) idx = i;
  const next = LEVELS[idx + 1] || null;
  return {
    name: LEVELS[idx].name,
    min: LEVELS[idx].min,
    next: next ? { name: next.name, min: next.min } : null,
    progress: next ? (points - LEVELS[idx].min) / (next.min - LEVELS[idx].min) : 1,
  };
}
