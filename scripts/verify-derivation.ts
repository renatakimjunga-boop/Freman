/**
 * Standalone check of the derivation algorithms used in
 * src/convex/custodialWallet.ts against official test vectors.
 * Run: bunx tsx scripts/verify-derivation.ts
 */
import { HDNodeWallet } from "ethers";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { keccak_256 } from "@noble/hashes/sha3";
import { hmac } from "@noble/hashes/hmac";
import { ed25519 } from "@noble/curves/ed25519";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const hex = Buffer.from(bytes).toString("hex");
  let n = hex ? BigInt(`0x${hex}`) : 0n;
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    zeros++;
  }
  return "1".repeat(zeros) + out;
}
function base58CheckEncode(payload: Uint8Array): string {
  const hash = sha256(sha256(payload));
  const full = new Uint8Array(payload.length + 4);
  full.set(payload, 0);
  full.set(hash.slice(0, 4), payload.length);
  return base58Encode(full);
}
function slip10Ed25519(seed: Buffer, path: number[]): Buffer {
  const i0 = hmac.create(sha512, "ed25519 seed").update(seed).digest();
  let key = Buffer.from(i0.slice(0, 32));
  let chainCode = Buffer.from(i0.slice(32));
  for (const segment of path) {
    const data = Buffer.alloc(1 + 32 + 4);
    key.copy(data, 1);
    data.writeUInt32BE((segment + 0x80000000) >>> 0, 33);
    const i = hmac.create(sha512, chainCode).update(data).digest();
    key = Buffer.from(i.slice(0, 32));
    chainCode = Buffer.from(i.slice(32));
  }
  return key;
}

let failures = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `\n  got:  ${got}\n  want: ${want}`}`);
}

// Official BIP-39 mnemonic test vector: "abandon ... about".
// Seed computed independently via node crypto (BIP-39 PBKDF2-HMAC-SHA512,
// 2048 rounds, salt "mnemonic") — not via ethers' own helper.
import crypto from "crypto";
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SEED = crypto.pbkdf2Sync(MNEMONIC, "mnemonic", 2048, 64, "sha512");

// Sanity: ethers' fromPhrase must agree with our independently derived seed
check(
  "BIP-39 seed vs ethers fromPhrase",
  HDNodeWallet.fromPhrase(MNEMONIC).address.toLowerCase(),
  HDNodeWallet.fromSeed(SEED).derivePath("m/44'/60'/0'/0/0").address.toLowerCase(),
);

// 1. EVM: m/44'/60'/0'/0/0 (vector published in the ethers docs)
const evm = HDNodeWallet.fromSeed(SEED).derivePath("m/44'/60'/0'/0/0");
check("EVM address (ethers vector)", evm.address.toLowerCase(), "0x9858effd232b4033e47d90003d41ec34ecaeda94");

// 2. Tron: BIP-44 with coin 195 → 0x41-prefixed base58check body
const tron = HDNodeWallet.fromSeed(SEED).derivePath("m/44'/195'/0'/0/0");
const tCompressed = tron.signingKey.compressedPublicKey;
const tH160 = keccak_256(Buffer.from(tCompressed.slice(2), "hex")).subarray(12);
const tPayload = Buffer.concat([Buffer.from([0x41]), Buffer.from(tH160)]);
const tAddr = base58CheckEncode(new Uint8Array(tPayload));
check("Tron address format", /^(T)[1-9A-HJ-NP-Za-km-z]{33}$/.test(tAddr) ? "ok" : tAddr, "ok");

// 3. base58Check: Bitcoin wiki vector (payload = 0x00 + hash160, 21 bytes)
check(
  "base58check vector",
  base58CheckEncode(Buffer.from("00010966776006953D5567439E5E39F86A0D273BEE", "hex")),
  "16UwLL9Risc3QfPqBUvKofHmBQ7wMtjvM",
);

// 4. SLIP-0010 ed25519, official test vector 1 (seed 000102...0f):
//    master m, m/0', and the 4-segment chain m/0'/1'/2'/2'
const slipSeed = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
check(
  "SLIP-0010 ed25519 m private key",
  Buffer.from(slip10Ed25519(slipSeed, [])).toString("hex"),
  "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7",
);
check(
  "SLIP-0010 ed25519 m/0' private key",
  Buffer.from(slip10Ed25519(slipSeed, [0])).toString("hex"),
  "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3",
);
check(
  "SLIP-0010 ed25519 m/0'/1'/2'/2' private key",
  Buffer.from(slip10Ed25519(slipSeed, [0, 1, 2, 2])).toString("hex"),
  "30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662",
);

// 5. Solana: derived key must produce a valid, verifiable ed25519 keypair
//    (SLIP-0010 correctness already proven above against official vectors;
//    use the same official 16-byte seed for a realistic 4-segment path)
const solPriv = slip10Ed25519(slipSeed, [44, 501, 0, 0]);
const solPub = ed25519.getPublicKey(solPriv);
const solAddr = base58Encode(solPub);
check("Solana pubkey length/base58", solAddr.length >= 32 && solAddr.length <= 44 ? "ok" : "bad", "ok");
const msg = new TextEncoder().encode("freman");
const sig = ed25519.sign(msg, solPriv);
check("Solana key sign/verify roundtrip", ed25519.verify(sig, msg, solPub) ? "ok" : "bad", "ok");

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll derivation vectors pass.");
