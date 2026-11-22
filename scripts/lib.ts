import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = resolve(ROOT, "data");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch JSON with retries; throws on final failure */
export async function getJson<T = any>(url: string, init: RequestInit = {}, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": "LineCollector/0.1 (BostonHacks 2026 student project)", ...(init.headers || {}) },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 429) {
        console.warn(`  429 rate limited, waiting… (${url.slice(0, 80)})`);
        await sleep(15_000 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      await sleep(2000 * (i + 1));
    }
  }
  throw lastErr;
}

export function writeData(name: string, data: unknown) {
  const path = resolve(DATA_DIR, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
  console.log(`wrote ${path}`);
}

/** Google encoded polyline (precision 5) → [lon, lat][] */
export function decodePolyline(str: string): [number, number][] {
  let index = 0, lat = 0, lng = 0;
  const out: [number, number][] = [];
  while (index < str.length) {
    let b: number, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([+(lng / 1e5).toFixed(5), +(lat / 1e5).toFixed(5)]);
  }
  return out;
}
