/**
 * Track 03 — Telegraph V2 Evaluator Adapter (`lora-v1`) Package Parser,
 * Stage-1 Validator, Keccak-256 Packager & BatchInputRoot Codec.
 *
 * 100% parity with Telegraph node's `pkg/wasm/runtime/lora_adapter.go`
 * and `telegraph-examples/evaluator-adapter/package.ts` (updated Nov 2026):
 *  - Shared Foundation Model: modernbert-base-lora16-v1
 *    foundation_hash: 0a49b325304bb4cf292e683929689d0457966be264f60bfc94d0072b614bf8e6
 *    tokenizer_hash:  67bc76f8b9386efba1a761c1c8e5ad439fd0eaf1c2826e9dd1a205c7af4dc456
 *  - 178 F32 tensors tiled contiguously across 22 layers + reward head (head.weight [768,1], head.bias [1])
 *  - Keccak-256 hash (`wasmHash`) for `registerWasm(bytes32,string,string,address,string)`
 *  - Exact `EncodeFloatInput` + `batchInputRoot` matching `remote.BatchInputRoot`
 */

import { keccak256Hex, sha256Hex } from "../shared/crypto.mjs";
import { TELEGRAPH_NETWORK } from "../shared/schemas.mjs";

export const R_MAX = 16;
export const MAX_TOKENS = 512;
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB
export const ALLOWED_TARGET_MODULES = ["Wi", "Wo", "Wqkv"];
export const LORA_TARGETS = ["attn.Wqkv", "attn.Wo", "mlp.Wi", "mlp.Wo"];

export const MODERNBERT_BASE_LAYOUT = Object.freeze({
  numLayers: 22,
  hiddenSize: 768,
  targets: Object.freeze({
    "attn.Wqkv": [768, 2304],
    "attn.Wo": [768, 768],
    "mlp.Wi": [768, 2304],
    "mlp.Wo": [1152, 768],
  }),
});

const KNOWN_META_KEYS = new Set([
  "format_version", "abi", "class", "intent", "foundation_hash", "foundation_version",
  "tokenizer_hash", "rank", "alpha", "target_modules", "max_tokens", "training",
]);
const REQUIRED_META_KEYS = [...KNOWN_META_KEYS].filter((k) => k !== "training");

export class Stage1Rejection extends Error {
  constructor(reason, detail) {
    super(`lora adapter: ${reason}: ${detail}`);
    this.name = "Stage1Rejection";
    this.reason = reason;
    this.detail = detail;
  }
}

export function readSafetensorsPackage(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 9) {
    throw new Stage1Rejection("bad_container", `${buf.length} bytes, shorter than safetensors header`);
  }
  const headerLen = Number(buf.readBigUInt64LE(0));
  if (headerLen === 0 || headerLen > (1 << 20)) {
    throw new Stage1Rejection("bad_container", `invalid safetensors header length ${headerLen}`);
  }
  if (buf.length < 8 + headerLen) {
    throw new Stage1Rejection("truncated", "safetensors header extends past EOF");
  }
  let header;
  try {
    header = JSON.parse(buf.subarray(8, 8 + headerLen).toString("utf8"));
  } catch (err) {
    throw new Stage1Rejection("bad_container", `safetensors header not valid JSON: ${err.message}`);
  }
  const meta = header.__metadata__;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    throw new Stage1Rejection("missing_metadata", "missing __metadata__ object in safetensors header");
  }
  const tensors = Object.entries(header)
    .filter(([k]) => k !== "__metadata__")
    .map(([name, v]) => ({
      name,
      dtype: v.dtype,
      shape: v.shape,
      begin: v.data_offsets?.[0],
      end: v.data_offsets?.[1],
    }))
    .sort((a, b) => a.begin - b.begin || (a.name < b.name ? -1 : 1));

  return { bytes: buf, meta, tensors, dataStart: 8 + headerLen };
}

function validateTrainingRecord(rawStr, family) {
  let rec;
  try {
    rec = JSON.parse(rawStr);
  } catch (err) {
    throw new Stage1Rejection("training_record", `invalid JSON: ${err.message}`);
  }
  if (!rec || typeof rec !== "object" || !rec.family || typeof rec.family !== "string") {
    throw new Stage1Rejection("training_record", "training.family must be a non-empty string");
  }
  if (family && rec.family !== family) {
    throw new Stage1Rejection("training_record", `training.family "${rec.family}" does not match intent "${family}"`);
  }
  if (!Array.isArray(rec.children) || rec.children.length === 0) {
    throw new Stage1Rejection("training_record", "training.children must be a non-empty array");
  }
  const seen = new Set();
  for (const ch of rec.children) {
    if (!ch || typeof ch.intent !== "string") {
      throw new Stage1Rejection("training_record", "child entry missing intent");
    }
    if (ch.intent !== rec.family && !ch.intent.startsWith(`${rec.family}_`)) {
      throw new Stage1Rejection("training_record", `child "${ch.intent}" is not ${rec.family} or a _-child`);
    }
    if (seen.has(ch.intent)) {
      throw new Stage1Rejection("training_record", `duplicate child "${ch.intent}"`);
    }
    seen.add(ch.intent);
    if (typeof ch.pairs !== "number" || ch.pairs < 0) {
      throw new Stage1Rejection("training_record", `negative pairs for ${ch.intent}`);
    }
    if (typeof ch.accuracy !== "number" || ch.accuracy < 0 || ch.accuracy > 1) {
      throw new Stage1Rejection("training_record", `accuracy out of [0,1] for ${ch.intent}`);
    }
    if (typeof ch.spearman !== "number" || ch.spearman < -1 || ch.spearman > 1) {
      throw new Stage1Rejection("training_record", `spearman out of [-1,1] for ${ch.intent}`);
    }
  }
}

export function validateLoraPackageStage1(bytes, {
  foundationHash = TELEGRAPH_NETWORK.foundationHash,
  tokenizerHash = TELEGRAPH_NETWORK.tokenizerHash,
  expectedClass = null,
  layout = MODERNBERT_BASE_LAYOUT,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  try {
    const pkg = readSafetensorsPackage(bytes);
    if (pkg.bytes.length > maxBytes) {
      throw new Stage1Rejection("too_large", `${pkg.bytes.length} > ${maxBytes} bytes`);
    }
    const m = pkg.meta;
    for (const k of REQUIRED_META_KEYS) {
      if (!(k in m) || typeof m[k] !== "string") {
        throw new Stage1Rejection("missing_metadata", `__metadata__ missing string key "${k}"`);
      }
    }
    for (const k of Object.keys(m)) {
      if (!KNOWN_META_KEYS.has(k) && !k.startsWith("x-")) {
        throw new Stage1Rejection("bad_header", `unknown metadata key "${k}"`);
      }
    }
    if (m.format_version !== "1") throw new Stage1Rejection("bad_version", `format_version="${m.format_version}"`);
    if (m.abi !== "lora-v1") throw new Stage1Rejection("bad_abi", `abi="${m.abi}"`);
    if (foundationHash && m.foundation_hash.toLowerCase() !== foundationHash.toLowerCase()) {
      throw new Stage1Rejection("foundation_mismatch", `${m.foundation_hash} != ${foundationHash}`);
    }
    if (tokenizerHash && m.tokenizer_hash.toLowerCase() !== tokenizerHash.toLowerCase()) {
      throw new Stage1Rejection("tokenizer_mismatch", `${m.tokenizer_hash} != ${tokenizerHash}`);
    }
    if (m.class !== "judgment" && m.class !== "hybrid") {
      throw new Stage1Rejection("class_mismatch", `class="${m.class}" (must be judgment or hybrid)`);
    }
    if (expectedClass && m.class !== expectedClass) {
      throw new Stage1Rejection("class_mismatch", `class="${m.class}" != expected "${expectedClass}"`);
    }
    if (!m.intent.trim()) throw new Stage1Rejection("bad_header", "intent is empty");

    const rank = Number(m.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > R_MAX) {
      throw new Stage1Rejection("rank_too_large", `rank=${m.rank} outside 1..${R_MAX}`);
    }
    const alpha = Number(m.alpha);
    if (!Number.isFinite(alpha) || alpha <= 0) {
      throw new Stage1Rejection("bad_header", `alpha=${m.alpha} must be positive finite`);
    }
    let targetMods;
    try {
      targetMods = JSON.parse(m.target_modules);
    } catch {
      targetMods = null;
    }
    if (!Array.isArray(targetMods) || targetMods.length === 0 || new Set(targetMods).size !== targetMods.length || targetMods.some((x) => !ALLOWED_TARGET_MODULES.includes(x))) {
      throw new Stage1Rejection("bad_target_module", `target_modules=${m.target_modules}`);
    }
    const maxTok = Number(m.max_tokens);
    if (!Number.isInteger(maxTok) || maxTok < 1 || maxTok > MAX_TOKENS) {
      throw new Stage1Rejection("bad_max_tokens", `max_tokens=${m.max_tokens} outside 1..${MAX_TOKENS}`);
    }
    if ("training" in m) {
      validateTrainingRecord(m.training, m.intent);
    }

    // Validate exact 178 F32 tensors tiled contiguously, all finite
    const expectedShapes = new Map();
    for (let l = 0; l < layout.numLayers; l++) {
      for (const t of LORA_TARGETS) {
        const [inDim, outDim] = layout.targets[t];
        expectedShapes.set(`lora.${l}.${t}.A`, [inDim, rank]);
        expectedShapes.set(`lora.${l}.${t}.B`, [rank, outDim]);
      }
    }
    expectedShapes.set("head.weight", [layout.hiddenSize, 1]);
    expectedShapes.set("head.bias", [1]);

    if (pkg.tensors.length !== expectedShapes.size) {
      throw new Stage1Rejection("bad_shape", `got ${pkg.tensors.length} tensors, expected ${expectedShapes.size}`);
    }

    const data = pkg.bytes.subarray(pkg.dataStart);
    let offset = 0;
    const seen = new Set();
    for (const t of pkg.tensors) {
      const shape = expectedShapes.get(t.name);
      if (!shape || seen.has(t.name)) {
        throw new Stage1Rejection("bad_shape", `unexpected or duplicate tensor "${t.name}"`);
      }
      seen.add(t.name);
      if (t.dtype !== "F32") throw new Stage1Rejection("bad_dtype", `tensor ${t.name} dtype=${t.dtype}`);
      if (JSON.stringify(t.shape) !== JSON.stringify(shape)) {
        throw new Stage1Rejection("bad_shape", `tensor ${t.name} shape=${JSON.stringify(t.shape)} != ${JSON.stringify(shape)}`);
      }
      const byteLen = 4 * shape.reduce((a, b) => a * b, 1);
      if (t.begin !== offset || t.end - t.begin !== byteLen) {
        throw new Stage1Rejection("bad_offsets", `tensor ${t.name} offsets [${t.begin},${t.end}] expected [${offset},${offset + byteLen}]`);
      }
      if (t.end > data.length) {
        throw new Stage1Rejection("truncated", `tensor ${t.name} end ${t.end} > data length ${data.length}`);
      }
      offset = t.end;
    }
    if (offset !== data.length) {
      throw new Stage1Rejection("trailing_bytes", `${data.length - offset} trailing bytes after last tensor`);
    }
    for (let i = 0; i + 4 <= data.length; i += 4) {
      if (!Number.isFinite(data.readFloatLE(i))) {
        throw new Stage1Rejection("non_finite", `non-finite F32 at data byte offset ${i}`);
      }
    }

    const wasmHash = keccak256Hex(pkg.bytes, true);
    const sha256 = sha256Hex(pkg.bytes, false);
    return {
      valid: true,
      rejection: null,
      bytes: pkg.bytes.length,
      tensor_count: pkg.tensors.length,
      keccak256: wasmHash,
      adapter_hash_no_prefix: wasmHash.slice(2),
      sha256,
      meta: m,
    };
  } catch (err) {
    if (err instanceof Stage1Rejection) {
      return { valid: false, rejection: { reason: err.reason, detail: err.detail, message: err.message } };
    }
    throw err;
  }
}

/**
 * Exact node input encoding (runtime.EncodeFloatInput) & batchInputRoot (remote.BatchInputRoot).
 */
export function encodeFloatInput(tokenIds) {
  return `{"input_ids":[${tokenIds.join(",")}],"attention_mask":[${tokenIds.map(() => "1").join(",")}]}`;
}

export function computeBatchInputRoot(batchTokenLists) {
  if (!Array.isArray(batchTokenLists) || batchTokenLists.length === 0) return "";
  const leaves = batchTokenLists
    .map((ids, i) => `${i}:${sha256Hex(encodeFloatInput(ids))}`)
    .sort();
  return sha256Hex(leaves.join("\n"));
}

/**
 * Encodes a finite JS number into IEEE-754 float32 unsigned 32-bit integer bit pattern
 * (exact format returned by Telegraph V2 runnable executors).
 */
export function floatToF32BitsU32(num) {
  if (!Number.isFinite(num)) throw new Error(`Cannot encode non-finite score: ${num}`);
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, num, true);
  return dv.getUint32(0, true);
}

export function f32BitsU32ToFloat(u32) {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint32(0, u32 >>> 0, true);
  return dv.getFloat32(0, true);
}

/**
 * Builds a syntactically and structurally valid Stage-1 `lora-v1` safetensors package
 * (all 178 F32 tensors tiled contiguously, pinned foundation & tokenizer hashes, valid training record).
 * Rank=1 uses ~847 KiB (fast for automated Stage-1 & executor verification tests).
 */
export function buildValidLoraPackageBuffer({
  intent = "LIQUIDITY_DEPTH_VERIFY",
  cls = "judgment",
  rank = 1,
  alpha = 4,
  maxTokens = 512,
  layout = MODERNBERT_BASE_LAYOUT,
  training = null,
} = {}) {
  const header = {
    __metadata__: {
      format_version: "1",
      abi: "lora-v1",
      class: cls,
      intent,
      foundation_hash: TELEGRAPH_NETWORK.foundationHash,
      foundation_version: TELEGRAPH_NETWORK.foundationVersion,
      tokenizer_hash: TELEGRAPH_NETWORK.tokenizerHash,
      rank: String(rank),
      alpha: String(alpha),
      target_modules: JSON.stringify(["Wqkv", "Wo", "Wi"]),
      max_tokens: String(maxTokens),
      ...(training ? { training: JSON.stringify(training) } : {}),
    },
  };

  const specs = [];
  let offset = 0;
  for (let l = 0; l < layout.numLayers; l++) {
    for (const t of LORA_TARGETS) {
      const [inDim, outDim] = layout.targets[t];
      for (const [suffix, shape] of [["A", [inDim, rank]], ["B", [rank, outDim]]]) {
        const name = `lora.${l}.${t}.${suffix}`;
        const byteLen = 4 * shape[0] * shape[1];
        header[name] = { dtype: "F32", shape, data_offsets: [offset, offset + byteLen] };
        specs.push({ name, byteLen });
        offset += byteLen;
      }
    }
  }
  const headWBytes = 4 * layout.hiddenSize;
  header["head.weight"] = { dtype: "F32", shape: [layout.hiddenSize, 1], data_offsets: [offset, offset + headWBytes] };
  offset += headWBytes;
  header["head.bias"] = { dtype: "F32", shape: [1], data_offsets: [offset, offset + 4] };
  offset += 4;

  const headerBuf = Buffer.from(JSON.stringify(header), "utf8");
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(headerBuf.length), 0);

  const dataBuf = Buffer.alloc(offset);
  // Seed small deterministic finite F32 values for head.weight / head.bias
  dataBuf.writeFloatLE(0.0125, offset - 8);
  dataBuf.writeFloatLE(0.05, offset - 4);

  return Buffer.concat([lenBuf, headerBuf, dataBuf]);
}
