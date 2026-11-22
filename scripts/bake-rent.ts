/**
 * Neighborhood rent snapshot, cached so judging makes no paid or fragile live calls.
 *  1. Every station gets a ZIP code (US Census geocoder, free, no key).
 *  2. With RENTCAST_API_KEY set, fetches RentCast rental market data once per ZIP and caches it.
 *     The free developer plan allows 50 requests a month, so ZIPs near the seven campuses go first
 *     and --limit caps the calls (default 40). Already-cached ZIPs are skipped unless --refresh.
 *
 *   npm run bake:rent                 # ZIPs only (no key needed)
 *   npm run bake:rent -- --limit 20   # with RENTCAST_API_KEY in .env
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR, writeData, sleep } from "./lib.js";

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1]) || 40;
const refresh = args.includes("--refresh");
const KEY = process.env.RENTCAST_API_KEY;

const mbta = JSON.parse(readFileSync(resolve(DATA_DIR, "mbta.json"), "utf8"));
const cachePath = resolve(DATA_DIR, "rent-cache.json");
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : { byZip: {}, stationZip: {} };

const HOME = ["place-nuniv", "place-rugg", "place-buest", "place-bucen", "place-kencl", "place-lake", "place-jfk", "place-harsq", "place-knncl", "place-mdftf"];

async function zipFor(lat: number, lon: number): Promise<string | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`;
  for (let i = 0; i < 3; i++) {
    try {
      const j: any = await (await fetch(url, { signal: AbortSignal.timeout(20_000) })).json();
      const z = j.result?.geographies?.["2020 Census ZIP Code Tabulation Areas"]?.[0];
      return z?.ZCTA5 || z?.GEOID || null;
    } catch {
      await sleep(1500);
    }
  }
  return null;
}

async function main() {
  let n = 0;
  for (const s of mbta.stations) {
    if (cache.stationZip[s.id] && !refresh) continue;
    const z = await zipFor(s.lat, s.lon);
    if (z) cache.stationZip[s.id] = z;
    if (++n % 20 === 0) console.log(`  ${n} stations geocoded`);
    await sleep(150);
  }
  console.log(`${Object.keys(cache.stationZip).length} stations have a ZIP`);

  if (!KEY) {
    console.log("RENTCAST_API_KEY not set: saved station ZIPs only. Add the key to .env to cache rent data.");
  } else {
    // ZIPs around the seven campuses first, then the rest
    const priority = [...new Set([...HOME.map((h) => cache.stationZip[h]), ...Object.values(cache.stationZip)])].filter(Boolean) as string[];
    const todo = priority.filter((z) => refresh || !cache.byZip[z]).slice(0, limit);
    console.log(`fetching RentCast market data for ${todo.length} ZIPs (limit ${limit})`);
    for (const zip of todo) {
      try {
        const res = await fetch(`https://api.rentcast.io/v1/markets?zipCode=${zip}&dataType=Rental&historyRange=1`, {
          headers: { "X-Api-Key": KEY, Accept: "application/json" },
        });
        if (!res.ok) {
          console.warn(`  ${zip}: ${res.status} ${await res.text()}`);
          if (res.status === 401 || res.status === 429) break;
          continue;
        }
        const j: any = await res.json();
        const r = j.rentalData || {};
        const median: Record<string, number> = {};
        if (r.medianRent) median.all = r.medianRent;
        for (const b of r.dataByBedrooms || []) if (b.medianRent && b.bedrooms <= 3) median[String(b.bedrooms)] = b.medianRent;
        cache.byZip[zip] = { median, average: r.averageRent ?? null, fetchedAt: new Date().toISOString() };
        console.log(`  ${zip}: median ${median.all ?? "?"}`);
      } catch (e) {
        console.warn(`  ${zip}: ${(e as Error).message}`);
      }
      await sleep(300);
    }
  }
  writeData("rent-cache.json", cache);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
