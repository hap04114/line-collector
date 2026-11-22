/**
 * Photo fingerprints: a 64-bit difference hash (dHash). Near-identical photos
 * (re-uploads, small crops, recompression) land within a few bits of each other.
 */
import sharp from "sharp";

export async function normalizePhoto(buf: Buffer, maxSide = 1280): Promise<Buffer> {
  // rotate() applies EXIF orientation; sharp drops EXIF (incl. GPS) unless asked to keep it
  return sharp(buf).rotate().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}

export async function dHash(buf: Buffer): Promise<string> {
  const raw = await sharp(buf).rotate().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export const NEAR_DUPLICATE_BITS = 5;
