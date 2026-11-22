/**
 * Creates a Solana devnet wallet for recording line badges as memo transactions,
 * requests a devnet airdrop, and prints the SOLANA_SECRET_KEY line for .env.
 * The key file is gitignored. Devnet SOL has no value.
 *
 *   npm run solana:wallet
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ROOT } from "./lib.js";

const path = resolve(ROOT, "solana-wallet.json");
const kp = existsSync(path) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))) : Keypair.generate();
if (!existsSync(path)) writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));

const conn = new Connection(process.env.SOLANA_RPC || "https://api.devnet.solana.com", "confirmed");
console.log(`Wallet: ${kp.publicKey.toBase58()}`);
try {
  const sig = await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
  console.log("Airdropped 1 devnet SOL.");
} catch (e) {
  console.warn(`Airdrop failed (devnet faucet is rate limited): ${(e as Error).message}\nUse https://faucet.solana.com with the address above.`);
}
console.log(`Balance: ${(await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL} SOL`);
console.log(`\nAdd to .env:\nSOLANA_SECRET_KEY=${JSON.stringify(Array.from(kp.secretKey))}`);
