#!/usr/bin/env node
/**
 * Track 03 — Telegraph V2 Eval-Pool EIP-191 Signed Submission CLI.
 *
 * Implements the EXACT signing & upload contract from:
 *   https://anjoman.ai/docs/scoring/contribute-evaluation-data#signing-and-uploading
 *
 * Message signed via EIP-191 personal_sign (5 lines joined by \n, NO trailing newline):
 *   Telegraph eval-pool submission v1
 *   intent_id: <INTENT>
 *   body_sha256: <lowercase hex sha256 of exact request body bytes>
 *   nonce: <X-Evalpool-Nonce, 8..128 chars>
 *   chain_id: 11155111
 *
 * Usage:
 *   node track3_evalforge/evalpool_submit.mjs --status LIVE_PORT_CONGESTION_GENERAL
 *   node track3_evalforge/evalpool_submit.mjs --intent LIVE_PORT_CONGESTION_GENERAL --file track3_evalforge/datasets/live_port_congestion_general.jsonl --dry-run
 *   TELEGRAPH_PRIVATE_KEY=0x... node track3_evalforge/evalpool_submit.mjs --intent LIVE_PORT_CONGESTION_GENERAL --file track3_evalforge/datasets/live_port_congestion_general.jsonl --live
 */

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  generateEphemeralPrivateKey,
  personalSign,
  privateKeyToAddress,
  recoverPersonalSignAddress,
  sha256Hex,
} from "../shared/crypto.mjs";
import { TELEGRAPH_NETWORK } from "../shared/schemas.mjs";
import { auditDatasetJsonl } from "./dataset_gate.mjs";

export function buildEvalPoolSubmissionEnvelope({
  intentId,
  bodyBytes,
  privateKeyHex,
  chainId = TELEGRAPH_NETWORK.chainId,
  nonce = randomBytes(16).toString("hex"),
}) {
  if (!intentId || typeof intentId !== "string") throw new Error("intentId is required");
  if (nonce.length < 8 || nonce.length > 128) throw new Error("nonce must be 8..128 characters");

  const rawBuf = Buffer.isBuffer(bodyBytes) ? bodyBytes : Buffer.from(bodyBytes, "utf8");
  const bodySha256 = sha256Hex(rawBuf, false);
  const submitter = privateKeyToAddress(privateKeyHex);
  const message = [
    "Telegraph eval-pool submission v1",
    `intent_id: ${intentId}`,
    `body_sha256: ${bodySha256}`,
    `nonce: ${nonce}`,
    `chain_id: ${chainId}`,
  ].join("\n");

  const signature = personalSign(message, privateKeyHex);
  const recovered = recoverPersonalSignAddress(message, signature);
  if (recovered.toLowerCase() !== submitter.toLowerCase()) {
    throw new Error(`Signature self-check failed: recovered ${recovered} != ${submitter}`);
  }

  return {
    intent_id: intentId,
    submitter,
    chain_id: chainId,
    body_sha256: bodySha256,
    body_bytes_length: rawBuf.length,
    nonce,
    message,
    signature,
    headers: {
      "Content-Type": "application/x-ndjson",
      "X-Evalpool-Signature": signature,
      "X-Evalpool-Nonce": nonce,
    },
    endpoint_path: `/api/evalpool/submissions?intent_id=${encodeURIComponent(intentId)}&submitter=${encodeURIComponent(submitter)}`,
  };
}

export async function uploadEvalPoolSubmission({
  intentId,
  bodyBytes,
  privateKeyHex,
  nodeUrl = TELEGRAPH_NETWORK.devnodeBaseUrl,
  fetchImpl = globalThis.fetch,
}) {
  const rawBuf = Buffer.isBuffer(bodyBytes) ? bodyBytes : Buffer.from(bodyBytes, "utf8");
  const env = buildEvalPoolSubmissionEnvelope({ intentId, bodyBytes: rawBuf, privateKeyHex });
  const url = `${nodeUrl.replace(/\/+$/, "")}${env.endpoint_path}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: env.headers,
    body: rawBuf,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, envelope: env, response: data };
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) out[k] = true;
      else {
        out[k] = v;
        i++;
      }
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const flags = parseFlags(process.argv.slice(2));
  const nodeUrl = flags.node || TELEGRAPH_NETWORK.devnodeBaseUrl;

  if (flags.status) {
    const r = await fetch(`${nodeUrl}/api/evalpool/status?intent_id=${encodeURIComponent(flags.status)}`);
    console.log(JSON.stringify(await r.json(), null, 2));
    process.exit(r.ok ? 0 : 1);
  }

  if (!flags.intent || !flags.file) {
    console.error("Usage: evalpool_submit.mjs --intent <INTENT> --file <dataset.jsonl> [--dry-run | --live]");
    process.exit(2);
  }

  const rawBuf = readFileSync(flags.file);
  const audit = auditDatasetJsonl(rawBuf.toString("utf8"), { name: flags.file });
  if (!audit.pass) {
    console.error("Refusing upload — dataset failed local 6-gate audit:", JSON.stringify(audit, null, 2));
    process.exit(1);
  }

  const privKey = process.env.TELEGRAPH_PRIVATE_KEY || (flags["dry-run"] ? generateEphemeralPrivateKey() : "");
  if (!privKey) {
    console.error("Set TELEGRAPH_PRIVATE_KEY for --live submission, or pass --dry-run to test locally.");
    process.exit(2);
  }

  if (flags.live) {
    const result = await uploadEvalPoolSubmission({
      intentId: flags.intent,
      bodyBytes: rawBuf,
      privateKeyHex: privKey,
      nodeUrl,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } else {
    const env = buildEvalPoolSubmissionEnvelope({
      intentId: flags.intent,
      bodyBytes: rawBuf,
      privateKeyHex: privKey,
    });
    console.log(JSON.stringify({ mode: "dry_run", dataset_gate: "PASS", rows: audit.rows, envelope: env }, null, 2));
    process.exit(0);
  }
}
