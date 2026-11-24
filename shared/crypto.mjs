/**
 * Pure-JS, zero-dependency Ethereum cryptography for Telegraph Protocol V2:
 * - Ethereum Keccak-256 (0x01 padding, NOT NIST SHA3-256)
 * - secp256k1 elliptic curve arithmetic + RFC 6979 deterministic ECDSA signing
 * - EIP-191 personal_sign & ecrecover (used by Telegraph Escrow X-PAYMENT and EvalPool X-Evalpool-Signature)
 * - SHA-256 helpers (used by Telegraph Miner YAML commitments & batchInputRoot)
 */

import { createHash, createHmac, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// 1. Ethereum Keccak-256 (original Keccak padding 0x01, 1600-bit state)
// ---------------------------------------------------------------------------

const MASK64 = 0xffffffffffffffffn;

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const KECCAK_ROTC = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14,
  27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

const KECCAK_PILN = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
  15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

function rotl64(x, s) {
  const shift = BigInt(s);
  return ((x << shift) | (x >> (64n - shift))) & MASK64;
}

function keccakF1600(st) {
  const bc = new Array(5);
  for (let round = 0; round < 24; round++) {
    // Theta
    for (let i = 0; i < 5; i++) {
      bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
    }
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) {
        st[j + i] ^= t;
      }
    }
    // Rho + Pi
    let t = st[1];
    for (let i = 0; i < 24; i++) {
      const j = KECCAK_PILN[i];
      bc[0] = st[j];
      st[j] = rotl64(t, KECCAK_ROTC[i]);
      t = bc[0];
    }
    // Chi
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) bc[i] = st[j + i];
      for (let i = 0; i < 5; i++) {
        st[j + i] ^= (~bc[(i + 1) % 5] & MASK64) & bc[(i + 2) % 5];
      }
    }
    // Iota
    st[0] ^= KECCAK_RC[round];
  }
}

export function keccak256Bytes(input) {
  const data = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  const rate = 136; // 1088 bits for Keccak-256
  const st = new Array(25).fill(0n);

  let offset = 0;
  while (offset + rate <= data.length) {
    for (let i = 0; i < 17; i++) {
      st[i] ^= data.readBigUInt64LE(offset + i * 8);
    }
    keccakF1600(st);
    offset += rate;
  }

  const block = Buffer.alloc(rate, 0);
  const rem = data.length - offset;
  if (rem > 0) data.copy(block, 0, offset);
  block[rem] ^= 0x01; // Original Keccak domain separator (Ethereum)
  block[rate - 1] ^= 0x80;

  for (let i = 0; i < 17; i++) {
    st[i] ^= block.readBigUInt64LE(i * 8);
  }
  keccakF1600(st);

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) {
    out.writeBigUInt64LE(st[i], i * 8);
  }
  return out;
}

export function keccak256Hex(input, withPrefix = true) {
  const hex = keccak256Bytes(input).toString("hex");
  return withPrefix ? `0x${hex}` : hex;
}

export function sha256Hex(input, withPrefix = false) {
  const hex = createHash("sha256").update(input).digest("hex");
  return withPrefix ? `0x${hex}` : hex;
}

// ---------------------------------------------------------------------------
// 2. secp256k1 Elliptic Curve + RFC 6979 Deterministic ECDSA + EIP-191
// ---------------------------------------------------------------------------

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = N >> 1n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const INF = null;

function mod(a, m = P) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base, exp, m = P) {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function modInv(a, m = P) {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = mod(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error("Value is not invertible");
  return t < 0n ? t + m : t;
}

function pointAdd(p1, p2) {
  if (p1 === INF) return p2;
  if (p2 === INF) return p1;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (x1 === x2) {
    if (mod(y1 + y2, P) === 0n) return INF;
    const lam = mod(3n * x1 * x1 * modInv(2n * y1, P), P);
    const x3 = mod(lam * lam - 2n * x1, P);
    const y3 = mod(lam * (x1 - x3) - y1, P);
    return [x3, y3];
  }
  const lam = mod((y2 - y1) * modInv(x2 - x1, P), P);
  const x3 = mod(lam * lam - x1 - x2, P);
  const y3 = mod(lam * (x1 - x3) - y1, P);
  return [x3, y3];
}

function pointMul(k, point = [Gx, Gy]) {
  let scalar = mod(k, N);
  let res = INF;
  let addend = point;
  while (scalar > 0n) {
    if (scalar & 1n) res = pointAdd(res, addend);
    addend = pointAdd(addend, addend);
    scalar >>= 1n;
  }
  return res;
}

function bigIntTo32Bytes(n) {
  const hex = n.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

function bytesToBigInt(buf) {
  return BigInt("0x" + Buffer.from(buf).toString("hex"));
}

function parsePrivateKey(privateKeyHex) {
  const clean = String(privateKeyHex || "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error("Invalid 32-byte secp256k1 private key hex");
  }
  const d = BigInt("0x" + clean);
  if (d <= 0n || d >= N) throw new Error("Private key out of secp256k1 range");
  return d;
}

function publicKeyPointToAddress(point) {
  const pubBytes = Buffer.concat([bigIntTo32Bytes(point[0]), bigIntTo32Bytes(point[1])]);
  const hash = keccak256Bytes(pubBytes);
  return "0x" + hash.subarray(12).toString("hex");
}

export function toChecksumAddress(address) {
  const clean = String(address || "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error(`Invalid Ethereum address: ${address}`);
  const hash = keccak256Bytes(clean).toString("hex");
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? clean[i].toUpperCase() : clean[i];
  }
  return out;
}

export function privateKeyToAddress(privateKeyHex) {
  const d = parsePrivateKey(privateKeyHex);
  const pub = pointMul(d);
  return toChecksumAddress(publicKeyPointToAddress(pub));
}

export function generateEphemeralPrivateKey() {
  while (true) {
    const buf = randomBytes(32);
    const d = bytesToBigInt(buf);
    if (d > 0n && d < N) return "0x" + buf.toString("hex");
  }
}

/**
 * RFC 6979 deterministic nonce generation with HMAC-SHA256.
 */
function rfc6979GenerateK(privateKeyBigInt, msgHash32) {
  const x = bigIntTo32Bytes(privateKeyBigInt);
  const h1 = Buffer.from(msgHash32);
  let V = Buffer.alloc(32, 0x01);
  let K = Buffer.alloc(32, 0x00);

  const hmac = (key, ...parts) => {
    const h = createHmac("sha256", key);
    for (const p of parts) h.update(p);
    return h.digest();
  };

  K = hmac(K, V, Buffer.from([0x00]), x, h1);
  V = hmac(K, V);
  K = hmac(K, V, Buffer.from([0x01]), x, h1);
  V = hmac(K, V);

  while (true) {
    V = hmac(K, V);
    const k = bytesToBigInt(V);
    if (k >= 1n && k < N) return k;
    K = hmac(K, V, Buffer.from([0x00]));
    V = hmac(K, V);
  }
}

export function signDigest(digest32, privateKeyHex) {
  const d = parsePrivateKey(privateKeyHex);
  const z = bytesToBigInt(digest32);
  const k = rfc6979GenerateK(d, digest32);
  const R = pointMul(k);
  if (R === INF) throw new Error("Invalid nonce R=INF");
  const r = mod(R[0], N);
  if (r === 0n) throw new Error("Invalid signature r=0");
  let s = mod(modInv(k, N) * (z + r * d), N);
  if (s === 0n) throw new Error("Invalid signature s=0");

  let recId = Number(R[1] & 1n) | (R[0] >= N ? 2 : 0);
  if (s > HALF_N) {
    s = N - s;
    recId ^= 1;
  }

  const v = 27 + recId;
  const sigBuf = Buffer.concat([
    bigIntTo32Bytes(r),
    bigIntTo32Bytes(s),
    Buffer.from([v]),
  ]);
  return "0x" + sigBuf.toString("hex");
}

export function eip191Digest(message) {
  const msgBytes = typeof message === "string" ? Buffer.from(message, "utf8") : Buffer.from(message);
  const prefix = Buffer.from(`\x19Ethereum Signed Message:\n${msgBytes.length}`, "utf8");
  return keccak256Bytes(Buffer.concat([prefix, msgBytes]));
}

export function personalSign(message, privateKeyHex) {
  return signDigest(eip191Digest(message), privateKeyHex);
}

export function recoverAddressFromDigest(digest32, signatureHex) {
  const clean = String(signatureHex || "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{130}$/.test(clean)) {
    throw new Error("Signature must be 65 bytes (130 hex chars)");
  }
  const buf = Buffer.from(clean, "hex");
  const r = bytesToBigInt(buf.subarray(0, 32));
  const s = bytesToBigInt(buf.subarray(32, 64));
  let v = buf[64];
  if (v >= 27) v -= 27;
  if (v < 0 || v > 3) throw new Error(`Invalid recovery id v=${buf[64]}`);
  if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error("Signature r/s out of range");

  const x = r + (v >= 2 ? N : 0n);
  if (x >= P) throw new Error("Recovered x >= P");
  const ySq = mod(modPow(x, 3n, P) + 7n, P);
  // Since P % 4 === 3, sqrt(a) = a^((P+1)/4) mod P
  let y = modPow(ySq, (P + 1n) >> 2n, P);
  if (mod(y * y, P) !== ySq) throw new Error("Point is not on secp256k1");
  if ((y & 1n) !== BigInt(v & 1)) y = P - y;

  const R = [x, y];
  const z = bytesToBigInt(digest32);
  const rInv = modInv(r, N);
  const u1 = mod(-z * rInv, N);
  const u2 = mod(s * rInv, N);
  const Q = pointAdd(pointMul(u1, [Gx, Gy]), pointMul(u2, R));
  if (Q === INF) throw new Error("Recovered public key at infinity");
  return toChecksumAddress(publicKeyPointToAddress(Q));
}

export function recoverPersonalSignAddress(message, signatureHex) {
  return recoverAddressFromDigest(eip191Digest(message), signatureHex);
}
