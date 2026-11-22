/** Small clients for Open-Meteo (weather), the Census geocoder, Resend (email) and Solana devnet. */
import { config } from "../config.js";

// ---- weather ---------------------------------------------------------------
export interface Weather { tempF: number | null; feelsLikeF: number | null; snowing: boolean; code: number | null; fetchedAt: string; warmUp: boolean }
let weatherCache: { at: number; value: Weather } | null = null;

export async function getWeather(): Promise<Weather | null> {
  if (weatherCache && Date.now() - weatherCache.at < 10 * 60_000) return weatherCache.value;
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=42.3601&longitude=-71.0589" +
      "&current=temperature_2m,apparent_temperature,snowfall,weather_code&temperature_unit=fahrenheit&timezone=America%2FNew_York";
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j: any = await res.json();
    const c = j.current || {};
    const code = c.weather_code ?? null;
    const snowing = (c.snowfall ?? 0) > 0 || [71, 73, 75, 77, 85, 86].includes(code);
    const value: Weather = {
      tempF: c.temperature_2m ?? null,
      feelsLikeF: c.apparent_temperature ?? null,
      snowing,
      code,
      fetchedAt: new Date().toISOString(),
      warmUp: snowing || (c.apparent_temperature != null && c.apparent_temperature <= 25),
    };
    weatherCache = { at: Date.now(), value };
    return value;
  } catch {
    return weatherCache?.value ?? null;
  }
}

// ---- geocoding ---------------------------------------------------------------
export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number; zip: string | null; matched: string } | null> {
  try {
    const url = `${config.geocoderUrl}/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const j: any = await res.json();
    const m = j.result?.addressMatches?.[0];
    if (!m) return null;
    return { lat: m.coordinates.y, lon: m.coordinates.x, zip: m.addressComponents?.zip || null, matched: m.matchedAddress };
  } catch {
    return null;
  }
}

export async function zipForPoint(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `${config.geocoderUrl}/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const j: any = await res.json();
    const z = j.result?.geographies?.["2020 Census ZIP Code Tabulation Areas"]?.[0];
    return z?.ZCTA5 || z?.GEOID || null;
  } catch {
    return null;
  }
}

// ---- email -------------------------------------------------------------------
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!config.email.resendKey) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.email.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.email.from, to, subject, html }),
  });
  if (!res.ok) console.error("[email] send failed", res.status, await res.text());
  return res.ok;
}

// ---- Solana devnet memo --------------------------------------------------------
export const solanaEnabled = () => !!config.solana.secretKey;

/** Writes a memo transaction to devnet; returns the signature. */
export async function recordOnSolana(memo: string): Promise<string> {
  const web3 = await import("@solana/web3.js");
  const secret = Uint8Array.from(JSON.parse(config.solana.secretKey));
  const payer = web3.Keypair.fromSecretKey(secret);
  const conn = new web3.Connection(config.solana.rpc, "confirmed");
  const ix = new web3.TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
    programId: new web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    data: Buffer.from(memo, "utf8"),
  });
  const tx = new web3.Transaction().add(ix);
  return web3.sendAndConfirmTransaction(conn, tx, [payer]);
}

export const solanaExplorerUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
