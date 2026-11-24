import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditDatasetJsonl } from "../track3_evalforge/dataset_gate.mjs";
import {
  buildValidLoraPackageBuffer,
  computeBatchInputRoot,
  f32BitsU32ToFloat,
  validateLoraPackageStage1,
} from "../track3_evalforge/adapter_spec.mjs";
import {
  benchmarkDatasetDiscrimination,
  createRunnableExecutorServer,
} from "../track3_evalforge/runnable_executor.mjs";
import { buildEvalPoolSubmissionEnvelope } from "../track3_evalforge/evalpool_submit.mjs";
import { recoverPersonalSignAddress } from "../shared/crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DS_DIR = join(__dirname, "..", "track3_evalforge", "datasets");
const FOUNDRY_TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const DATASET_FILES = [
  ["liquidity_depth_verify_general.jsonl", "LIQUIDITY_DEPTH_VERIFY_GENERAL"],
  ["live_port_congestion_general.jsonl", "LIVE_PORT_CONGESTION_GENERAL"],
  ["fraud_risk_general.jsonl", "FRAUD_RISK_GENERAL"],
  ["vessel_telemetry_verify_general.jsonl", "VESSEL_TELEMETRY_VERIFY_GENERAL"],
  ["crypto_price_usd_truth_source.jsonl", "CRYPTO_PRICE_USD"],
];

test("Track 03: ALL 5 attested datasets pass all 6 Telegraph Adapter Kit gates + Eval-Pool checks", () => {
  for (const [fname] of DATASET_FILES) {
    const raw = readFileSync(join(DS_DIR, fname), "utf8");
    const report = auditDatasetJsonl(raw, { name: fname });
    assert.equal(report.pass, true, `${fname} failed gate: ${JSON.stringify(report, null, 2)}`);
    assert.deepEqual(report.row_errors, []);
  }
});

test("Track 03: Dataset gate catches shortcut/poisoned datasets (repeated bad answers, length bias, synthetic provenance, truth_source accepted_fields)", () => {
  const badRows = [];
  for (let i = 0; i < 20; i++) {
    badRows.push(JSON.stringify({
      prompt: `Check pool liquidity number ${i} on ethereum with detailed context`,
      chosen: `This is a very long, comprehensive, detailed verified response describing pool ${i} in extensive prose.`,
      rejected: "Looks good.",
      provenance: { source_kind: "llm", source_url: "https://example.org/x" },
    }));
  }
  const rep = auditDatasetJsonl(badRows.join("\n"));
  assert.equal(rep.pass, false);
  assert.equal(rep.gates.unique_rejected_gte_80pct.pass, false);
  assert.equal(rep.gates.most_repeated_rejected_lte_2pct.pass, false);
  assert.equal(rep.gates.length_heuristic_lte_65pct.pass, false);
  assert.equal(rep.gates.attested_provenance_100pct.pass, false);

  const badTruth = JSON.stringify({
    label_kind: "truth_source",
    source: "version: '1'\nkind: miner\nid: 0\nslug: bad\nbase_url: http://localhost:8080\nauth:\n  type: bearer\nendpoints:\n  - path: /x\n    external_path: /x\n    method: GET\n    intents: [CRYPTO_PRICE_USD]\n    params:\n      query:\n        required:\n          - name: s\n            type: string\n            intents: ['*']\n            accepted_fields: []\n",
  });
  const truthRep = auditDatasetJsonl(badTruth);
  assert.equal(truthRep.pass, false);
  assert.ok(truthRep.row_errors.some((e) => e.includes("accepted_fields")));
  assert.ok(truthRep.row_errors.some((e) => e.includes("source_url_rejected")));
  assert.ok(truthRep.row_errors.some((e) => e.includes("source_auth_unsupported")));
});

test("Track 03: Reference domain evaluator achieves >= 90% pairwise discrimination across all 4 judgment datasets", () => {
  for (const [fname, intentId] of DATASET_FILES.slice(0, 4)) {
    const raw = readFileSync(join(DS_DIR, fname), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const bench = benchmarkDatasetDiscrimination(intentId, raw);
    assert.equal(bench.meets_telegraph_70pct_floor, true, `${intentId} win_rate=${bench.win_rate}`);
    assert.ok(bench.win_rate >= 0.90, `Expected >= 0.90 discrimination on ${intentId}, got ${bench.win_rate}`);
  }
});

test("Track 03: V2 lora-v1 safetensors Stage-1 validator accepts valid 178-tensor package and catches every defect", () => {
  const validBuf = buildValidLoraPackageBuffer({
    intent: "LIQUIDITY_DEPTH_VERIFY",
    cls: "judgment",
    rank: 1,
    alpha: 4,
    training: {
      family: "LIQUIDITY_DEPTH_VERIFY",
      children: [
        { intent: "LIQUIDITY_DEPTH_VERIFY_GENERAL", pairs: 60, accuracy: 0.95, spearman: 0.84, held_out: true },
      ],
    },
  });
  const res = validateLoraPackageStage1(validBuf, { expectedClass: "judgment" });
  assert.equal(res.valid, true, res.rejection?.message);
  assert.equal(res.tensor_count, 178);
  assert.match(res.keccak256, /^0x[0-9a-f]{64}$/);

  // 1. Trailing bytes rejection
  const trailing = validateLoraPackageStage1(Buffer.concat([validBuf, Buffer.from([0x00])]));
  assert.equal(trailing.valid, false);
  assert.equal(trailing.rejection.reason, "trailing_bytes");

  // 2. Non-finite F32 (NaN) rejection
  const nanBuf = Buffer.from(validBuf);
  nanBuf.writeFloatLE(Number.NaN, nanBuf.length - 4);
  const nanRes = validateLoraPackageStage1(nanBuf);
  assert.equal(nanRes.valid, false);
  assert.equal(nanRes.rejection.reason, "non_finite");

  // 3. Class mismatch (deterministic refused!)
  const detRes = validateLoraPackageStage1(validBuf, { expectedClass: "hybrid" });
  assert.equal(detRes.valid, false);
  assert.equal(detRes.rejection.reason, "class_mismatch");

  // 4. Tokenizer mismatch (#223 guard!)
  const badTok = validateLoraPackageStage1(validBuf, {
    tokenizerHash: "9fd55248d51d33976b324fc11592e28071da7d41e0e9401dfb7082e30574b7b1",
  });
  assert.equal(badTok.valid, false);
  assert.equal(badTok.rejection.reason, "tokenizer_mismatch");
});

test("Track 03: V2 Batch Runnable Executor passes exact check-executor.ts validator contract", async () => {
  const { server, stage1 } = createRunnableExecutorServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  // Exact token lists from telegraph-examples/evaluator-adapter/check-executor.ts (first & third identical!)
  const BATCH = [
    [50281, 4118, 17526, 27, 187, 18658, 436, 13814, 1818, 50282],
    [50281, 4118, 17526, 27, 187, 1276, 310, 253, 5347, 50282],
    [50281, 4118, 17526, 27, 187, 18658, 436, 13814, 1818, 50282],
  ];
  const inputRoot = computeBatchInputRoot(BATCH);

  try {
    const res = await fetch(`${base}/runnable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch: BATCH.map((tokens) => ({ tokens })),
        foundation_hash: stage1.meta.foundation_hash,
        adapter_hash: stage1.adapter_hash_no_prefix,
        tokenizer_hash: stage1.meta.tokenizer_hash,
        input_root: inputRoot,
      }),
      redirect: "manual",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.results.length, 3);
    // Bit-exact determinism: item 0 and item 2 have identical tokens -> identical u32 bits!
    assert.equal(body.results[0].score, body.results[2].score);
    for (const item of body.results) {
      assert.ok(Number.isInteger(item.score) && item.score >= 0 && item.score <= 0xffffffff);
      assert.ok(Number.isFinite(f32BitsU32ToFloat(item.score)));
    }
    // Exact score identity echo
    assert.equal(body.foundation_hash, stage1.meta.foundation_hash);
    assert.equal(body.adapter_hash, stage1.adapter_hash_no_prefix);
    assert.equal(body.tokenizer_hash, stage1.meta.tokenizer_hash);
    assert.equal(body.input_root, inputRoot);

    // Rejects invalid empty batch with 400
    const bad = await fetch(`${base}/runnable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batch: [] }),
    });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});

test("Track 03: Eval-Pool EIP-191 submission envelope matches exact 5-line spec and verifies cleanly", () => {
  const rawBuf = readFileSync(join(DS_DIR, "live_port_congestion_general.jsonl"));
  const env = buildEvalPoolSubmissionEnvelope({
    intentId: "LIVE_PORT_CONGESTION_GENERAL",
    bodyBytes: rawBuf,
    privateKeyHex: FOUNDRY_TEST_KEY,
    nonce: "a1b2c3d4e5f60718",
  });
  const lines = env.message.split("\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[0], "Telegraph eval-pool submission v1");
  assert.equal(lines[1], "intent_id: LIVE_PORT_CONGESTION_GENERAL");
  assert.equal(lines[3], "nonce: a1b2c3d4e5f60718");
  assert.equal(lines[4], "chain_id: 11155111");
  assert.equal(recoverPersonalSignAddress(env.message, env.signature), env.submitter);
});
