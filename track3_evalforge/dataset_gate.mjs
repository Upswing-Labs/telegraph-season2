#!/usr/bin/env node
/**
 * Track 03 — Upswing EvalForge Dataset Quality Gate & Eval-Pool Validator.
 *
 * Implements EVERY check documented in:
 *  - https://anjoman.ai/docs/scoring/train-a-scoring-adapter#what-makes-good-data
 *      1. Unique rejected answers >= 80%
 *      2. Most-repeated rejected answer <= 2%
 *      3. Identical chosen === rejected <= 1%
 *      4. Length heuristic (both "pick longer" & "pick shorter") <= 65%
 *      5. Held-out (15%) leakage of rejected answers from train <= 10%
 *      6. Surface-style unigram classifier (without prompt) accuracy <= 65%
 *  - https://anjoman.ai/docs/scoring/contribute-evaluation-data
 *      - UTF-8, no control chars, row <= 64 KiB
 *      - prompt length 16..16000, chosen/rejected length 8..32000
 *      - Near-duplicate prompt similarity < 85%
 *      - Attested provenance (http(s) source_url + non-synthetic source_kind)
 *      - Truth-source YAML rules (auth.type === "none", public https://, no accepted_fields, <= 32 KiB)
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSimpleYaml } from "../track2_solsignal_miner/yaml_validator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC_SOURCE_KINDS = new Set(["llm", "synthetic", "generated", "model"]);
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const PRIVATE_HOST_RE = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|.*\.local|.*\.internal)/i;

export function normalizeText(str) {
  return String(str || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function tokenizeWords(str) {
  return normalizeText(str)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2);
}

function trigramSet(str) {
  const s = normalizeText(str).toLowerCase();
  const out = new Set();
  for (let i = 0; i <= s.length - 3; i++) {
    out.add(s.slice(i, i + 3));
  }
  return out;
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Deterministic seeded PRNG (mulberry32) for reproducible 85/15 train/val split.
 */
function seededShuffle(items, seed = 20261123) {
  const arr = [...items];
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Unigram bag-of-words logistic classifier trained ONLY on answer text (no prompt)
 * to measure surface-style shortcut learnability (must be <= 65%).
 */
function evalSurfaceStyleAccuracy(trainRows, valRows) {
  if (trainRows.length === 0 || valRows.length === 0) return 0.5;

  const vocab = new Map();
  const addTokens = (text) => {
    for (const tok of new Set(tokenizeWords(text))) {
      vocab.set(tok, (vocab.get(tok) || 0) + 1);
    }
  };
  for (const r of trainRows) {
    addTokens(r.chosen);
    addTokens(r.rejected);
  }
  // Keep informative vocabulary terms (freq >= 2)
  const kept = [...vocab.entries()].filter(([, c]) => c >= 2).map(([w]) => w);
  const idxMap = new Map(kept.map((w, i) => [w, i]));
  const weights = new Float64Array(kept.length);
  let bias = 0;

  const featurize = (text) => {
    const toks = new Set(tokenizeWords(text));
    const idxs = [];
    for (const t of toks) {
      const id = idxMap.get(t);
      if (id !== undefined) idxs.push(id);
    }
    return idxs;
  };

  const trainSamples = [];
  for (const r of trainRows) {
    trainSamples.push({ x: featurize(r.chosen), y: 1 });
    trainSamples.push({ x: featurize(r.rejected), y: 0 });
  }

  // SGD with L2 regularization
  const lr = 0.08;
  const l2 = 0.02;
  for (let epoch = 0; epoch < 12; epoch++) {
    for (const s of trainSamples) {
      let z = bias;
      for (const id of s.x) z += weights[id];
      const pred = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
      const err = pred - s.y;
      bias -= lr * err;
      for (const id of s.x) {
        weights[id] -= lr * (err + l2 * weights[id]);
      }
    }
  }

  // Evaluate pairwise accuracy on held-out valRows (higher score on chosen vs rejected)
  const scoreText = (text) => {
    let z = bias;
    for (const id of featurize(text)) z += weights[id];
    return z;
  };

  let wins = 0;
  for (const r of valRows) {
    const sc = scoreText(r.chosen);
    const sr = scoreText(r.rejected);
    if (sc > sr) wins += 1;
    else if (sc === sr) wins += 0.5;
  }
  return wins / valRows.length;
}

export function validateTruthSourceRow(row, lineNo) {
  const errors = [];
  if (row.prompt || row.chosen || row.rejected) {
    errors.push(`row ${lineNo}: truth_source row must not contain prompt/chosen/rejected`);
  }
  if (!row.source) {
    errors.push(`row ${lineNo}: truth_source missing source field`);
    return errors;
  }
  const srcText = typeof row.source === "string" ? row.source : JSON.stringify(row.source);
  if (Buffer.byteLength(srcText, "utf8") > 32 * 1024) {
    errors.push(`row ${lineNo}: source_too_large (> 32 KiB)`);
  }
  if (srcText.includes("accepted_fields")) {
    errors.push(`row ${lineNo}: source_unparseable (eval-pool truth_source parser rejects accepted_fields blocks)`);
  }
  let doc;
  try {
    doc = typeof row.source === "string" ? parseSimpleYaml(row.source) : row.source;
  } catch (err) {
    errors.push(`row ${lineNo}: source_unparseable (${err.message})`);
    return errors;
  }
  if (!doc.base_url || !String(doc.base_url).startsWith("https://") || PRIVATE_HOST_RE.test(String(doc.base_url)) || String(doc.base_url).includes("@")) {
    errors.push(`row ${lineNo}: source_url_rejected (base_url must be public https:// without credentials)`);
  }
  if (doc.auth && (doc.auth.type !== "none" || doc.auth.inject || doc.auth.env_var)) {
    errors.push(`row ${lineNo}: source_auth_unsupported (truth_source must use auth.type: none)`);
  }
  const eps = Array.isArray(doc.endpoints) ? doc.endpoints : [];
  if (eps.length === 0) errors.push(`row ${lineNo}: source_no_endpoint`);
  if (eps.length > 32) errors.push(`row ${lineNo}: source_too_large (> 32 endpoints)`);
  for (const ep of eps) {
    if (ep.multipart_fields) errors.push(`row ${lineNo}: source_unparseable (multipart endpoint not allowed in truth_source)`);
    if (ep.external_path && /^https?:\/\//i.test(String(ep.external_path))) {
      errors.push(`row ${lineNo}: source_url_rejected (external_path must be a path, not a full URL)`);
    }
  }
  return errors;
}

export function auditDatasetJsonl(jsonlText, { name = "dataset.jsonl" } = {}) {
  const lines = jsonlText.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  const rowErrors = [];
  const prefRows = [];
  const truthRows = [];
  let attestedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (Buffer.byteLength(line, "utf8") > 64 * 1024) {
      rowErrors.push(`row ${lineNo}: exceeds 64 KiB`);
      continue;
    }
    if (CONTROL_CHAR_RE.test(line)) {
      rowErrors.push(`row ${lineNo}: control_chars detected`);
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      rowErrors.push(`row ${lineNo}: invalid JSON (${err.message})`);
      continue;
    }

    const kind = obj.label_kind || "preference_pair";
    if (kind === "truth_source") {
      const errs = validateTruthSourceRow(obj, lineNo);
      rowErrors.push(...errs);
      if (errs.length === 0) truthRows.push(obj);
      continue;
    }

    if (!["preference_pair", "ground_truth", "graded_exemplar"].includes(kind)) {
      rowErrors.push(`row ${lineNo}: unknown_label_kind "${kind}"`);
      continue;
    }
    if (obj.source !== undefined) {
      rowErrors.push(`row ${lineNo}: non-truth_source row must not include source field`);
      continue;
    }

    const pNorm = normalizeText(obj.prompt);
    const cNorm = normalizeText(obj.chosen);
    const rNorm = normalizeText(obj.rejected);
    if (pNorm.length < 16 || pNorm.length > 16_000) {
      rowErrors.push(`row ${lineNo}: prompt length ${pNorm.length} outside [16, 16000]`);
    }
    if (cNorm.length < 8 || cNorm.length > 32_000) {
      rowErrors.push(`row ${lineNo}: chosen length ${cNorm.length} outside [8, 32000]`);
    }
    if (kind === "preference_pair" && (rNorm.length < 8 || rNorm.length > 32_000)) {
      rowErrors.push(`row ${lineNo}: rejected length ${rNorm.length} outside [8, 32000]`);
    }

    const prov = obj.provenance || {};
    const srcKind = String(prov.source_kind || "").toLowerCase();
    const srcUrl = String(prov.source_url || "");
    const isAttested = /^https?:\/\/[^/\s]+/i.test(srcUrl) && !SYNTHETIC_SOURCE_KINDS.has(srcKind);
    if (isAttested) attestedCount++;

    prefRows.push({ lineNo, prompt: pNorm, chosen: cNorm, rejected: rNorm, attested: isAttested, intent_id: obj.intent_id || null });
  }

  // Truth-source only file
  if (truthRows.length > 0 && prefRows.length === 0) {
    return {
      dataset: name,
      kind: "truth_source",
      pass: rowErrors.length === 0,
      rows: truthRows.length,
      row_errors: rowErrors,
      gates: { truth_source_schema: { pass: rowErrors.length === 0, valid_rows: truthRows.length } },
    };
  }

  // Prompt duplicate & near-duplicate checks (< 85% Jaccard similarity)
  const seenPrompts = new Set();
  let exactDupPrompts = 0;
  let nearDupPairs = 0;
  const triSets = prefRows.map((r) => trigramSet(r.prompt));
  for (let i = 0; i < prefRows.length; i++) {
    if (seenPrompts.has(prefRows[i].prompt)) exactDupPrompts++;
    seenPrompts.add(prefRows[i].prompt);
    for (let j = i + 1; j < prefRows.length; j++) {
      if (jaccard(triSets[i], triSets[j]) >= 0.85) nearDupPairs++;
    }
  }

  // 6 official Telegraph Adapter Kit dataset gates
  const n = prefRows.length;
  const rejCounts = new Map();
  let identicalCount = 0;
  let longerCorrect = 0;
  let shorterCorrect = 0;

  for (const r of prefRows) {
    rejCounts.set(r.rejected, (rejCounts.get(r.rejected) || 0) + 1);
    if (r.chosen === r.rejected) identicalCount++;
    if (r.chosen.length > r.rejected.length) longerCorrect++;
    else if (r.chosen.length === r.rejected.length) longerCorrect += 0.5;
    if (r.chosen.length < r.rejected.length) shorterCorrect++;
    else if (r.chosen.length === r.rejected.length) shorterCorrect += 0.5;
  }

  const uniqueRejRatio = n > 0 ? rejCounts.size / n : 0;
  const maxRejFreq = n > 0 ? Math.max(...rejCounts.values()) / n : 1;
  const identicalRatio = n > 0 ? identicalCount / n : 1;
  const longerAcc = n > 0 ? longerCorrect / n : 1;
  const shorterAcc = n > 0 ? shorterCorrect / n : 1;
  const maxLengthShortcutAcc = Math.max(longerAcc, shorterAcc);

  // 85/15 split for leakage & surface-style checks
  const shuffled = seededShuffle(prefRows);
  const valSize = Math.max(1, Math.round(n * 0.15));
  const valRows = shuffled.slice(0, valSize);
  const trainRows = shuffled.slice(valSize);
  const trainRejSet = new Set(trainRows.map((r) => r.rejected));
  const leaked = valRows.filter((r) => trainRejSet.has(r.rejected)).length;
  const leakageRatio = valRows.length > 0 ? leaked / valRows.length : 0;
  const surfaceStyleAcc = evalSurfaceStyleAccuracy(trainRows, valRows);
  const attestedRatio = n > 0 ? attestedCount / n : 0;

  const gates = {
    unique_rejected_gte_80pct: { value: round4(uniqueRejRatio), limit: ">= 0.80", pass: uniqueRejRatio >= 0.80 },
    most_repeated_rejected_lte_2pct: { value: round4(maxRejFreq), limit: "<= 0.02", pass: maxRejFreq <= 0.02 },
    identical_answers_lte_1pct: { value: round4(identicalRatio), limit: "<= 0.01", pass: identicalRatio <= 0.01 },
    length_heuristic_lte_65pct: {
      value: round4(maxLengthShortcutAcc),
      longer_acc: round4(longerAcc),
      shorter_acc: round4(shorterAcc),
      limit: "<= 0.65",
      pass: maxLengthShortcutAcc <= 0.65,
    },
    heldout_leakage_lte_10pct: { value: round4(leakageRatio), limit: "<= 0.10", pass: leakageRatio <= 0.10 },
    surface_style_classifier_lte_65pct: { value: round4(surfaceStyleAcc), limit: "<= 0.65", pass: surfaceStyleAcc <= 0.65 },
    zero_exact_or_near_duplicate_prompts: {
      exact_duplicates: exactDupPrompts,
      near_duplicate_pairs_gte_85pct: nearDupPairs,
      pass: exactDupPrompts === 0 && nearDupPairs === 0,
    },
    attested_provenance_100pct: { value: round4(attestedRatio), limit: "== 1.00", pass: attestedRatio === 1.0 },
  };

  const allGatesPass = rowErrors.length === 0 && Object.values(gates).every((g) => g.pass);
  return {
    dataset: name,
    kind: "preference_pair",
    pass: allGatesPass,
    rows: n,
    row_errors: rowErrors,
    gates,
  };
}

function round4(v) {
  return Math.round(v * 10_000) / 10_000;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2] || "--all";
  const dsDir = join(__dirname, "datasets");
  const files = arg === "--all"
    ? readdirSync(dsDir).filter((f) => f.endsWith(".jsonl")).sort().map((f) => join(dsDir, f))
    : [arg];

  let allPass = true;
  const reports = [];
  for (const f of files) {
    const txt = readFileSync(f, "utf8");
    const rep = auditDatasetJsonl(txt, { name: basename(f) });
    reports.push(rep);
    if (!rep.pass) allPass = false;
  }
  console.log(JSON.stringify({ dataset_gate: allPass ? "PASS" : "FAIL", reports }, null, 2));
  process.exit(allPass ? 0 : 1);
}
