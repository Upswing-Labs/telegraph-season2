#!/usr/bin/env node
/**
 * Track 01 — Upswing FactGap CLI (Mission 05: Conflict Intelligence — Routes 2 & 3).
 *
 * Examples:
 *   node track1_factgap_app/cli.mjs scenarios
 *   node track1_factgap_app/cli.mjs run --scenario black-sea-grain --mode simulated
 *   node track1_factgap_app/cli.mjs run --scenario failure-empty-verdict --mode simulated --json
 *   TELEGRAPH_PRIVATE_KEY=0x... node track1_factgap_app/cli.mjs run --scenario black-sea-grain --mode escrow --cap-usd 0.10
 *   TELEGRAPH_API_KEY=anjoman_... node track1_factgap_app/cli.mjs run --claim "..." --entity "Rosneft Oil Company" --mode api_key
 *   node track1_factgap_app/cli.mjs inspect-intent SANCTIONS_SCREENING_MATCH_GENERAL
 *   node track1_factgap_app/cli.mjs verify-receipt --epoch 46 --receipt 0x...
 */

import { fileURLToPath } from "node:url";
import { SpendBudgetGuard, TelegraphClient } from "../shared/telegraph_client.mjs";
import { BUILTIN_SCENARIOS, createMission05Simulator } from "./scenarios.mjs";
import { buildCustomDossier, runFactGapDossier } from "./engine.mjs";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[k] = true;
      } else {
        flags[k] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { command: positional[0] || "help", rest: positional.slice(1), flags };
}

function formatHumanReport(report) {
  const lines = [];
  lines.push("========================================================================");
  lines.push(`UPSWING FACTGAP — ${report.title}`);
  lines.push(`Mission: ${report.mission} | Mode: ${report.network_mode}`);
  if (report.simulated) {
    lines.push("[NOTICE] SIMULATED_TEST_FIXTURE mode — set TELEGRAPH_PRIVATE_KEY (Sepolia escrow) or TELEGRAPH_API_KEY for live paid calls.");
  }
  lines.push("========================================================================");
  lines.push(`Framing: ${report.epistemic_framing}`);
  lines.push(`Status:  ${report.summary.provenance_status} | Discrepancy Score: ${report.summary.discrepancy_score}/100 | Completeness: ${report.summary.evidence_completeness_pct}%`);
  lines.push(`Cost:    $${report.cost_accounting.total_cost_usd.toFixed(4)} total | Cost/Verified Claim: ${report.cost_accounting.cost_per_verified_claim_usd === null ? "N/A" : "$" + report.cost_accounting.cost_per_verified_claim_usd.toFixed(4)} | p50 Latency: ${report.cost_accounting.p50_latency_ms}ms`);
  if (report.summary.halted_reason) {
    lines.push(`HALTED:  ${report.summary.halted_reason}`);
  }
  lines.push("");
  lines.push("CONTRADICTIONS & UNCERTAINTY (never averaged away):");
  if (report.contradictions.length === 0) {
    lines.push("  (none detected)");
  } else {
    for (const c of report.contradictions) {
      lines.push(`  - [${c.severity}] ${c.type} (${c.intent}): ${c.detail}`);
    }
  }
  lines.push("");
  lines.push("ITEMIZED PRICED SIGNALS & RECEIPTS:");
  for (const ch of report.checks) {
    const prov = ch.provenance
      ? `miner=${ch.provenance.miner_id} receipt=${ch.provenance.receipt_hash || "none"} signal=${ch.provenance.signal_hash || "none"}`
      : "no_purchase";
    lines.push(`  * [${ch.status}/${ch.classification}] ${ch.intent} — $${(ch.cost_usd || 0).toFixed(4)} (${ch.latency_ms}ms${ch.cached_reuse ? ", CACHED" : ""})`);
    lines.push(`    ${prov}`);
    if (ch.quality_flags.length > 0) {
      lines.push(`    flags: ${ch.quality_flags.join(" ; ")}`);
    }
  }
  lines.push("");
  lines.push(`INTERPRETATION: ${report.observation_vs_interpretation.analyst_interpretation}`);
  return lines.join("\n");
}

export async function runCli(argv = process.argv.slice(2)) {
  const { command, rest, flags } = parseArgs(argv);

  if (command === "help" || flags.help) {
    console.log(`Upswing FactGap CLI — Mission 05 Conflict Intelligence

Commands:
  scenarios                                        List built-in scenarios & failure tests
  run --scenario <id> [--mode auto|escrow|api_key|simulated] [--cap-usd 0.12] [--json]
  run --claim <text> [--entity <name>] [--port <port>] [--vessel <imo>] [--country <name>] [--json]
  inspect-intent <INTENT_NAME>                     Fetch live canonical contract from devnode
  balance                                          Check Sepolia escrow or Anjoman API key balance
  verify-receipt --epoch <N> --receipt <0x...>     Verify Merkle delivery proof on devnode`);
    return 0;
  }

  if (command === "scenarios") {
    const items = Object.values(BUILTIN_SCENARIOS).map((s) => ({
      id: s.id,
      title: s.title,
      route: s.route,
      intents: s.checks.map((c) => c.intent),
    }));
    if (flags.json) console.log(JSON.stringify(items, null, 2));
    else {
      for (const it of items) {
        console.log(`${it.id.padEnd(26)} | ${it.title}`);
        console.log(`  intents: ${it.intents.join(", ")}`);
      }
    }
    return 0;
  }

  const capUsd = flags["cap-usd"] ? Number(flags["cap-usd"]) : 0.12;
  const maxPerRunUusdc = Math.max(10_000, Math.round(capUsd * 1e6));
  const budgetGuard = new SpendBudgetGuard({
    maxPerCallUusdc: 50_000,
    maxPerRunUusdc,
    maxDailyUusdc: Math.max(500_000, maxPerRunUusdc),
    spendingAuthorized: !flags["revoke-auth"],
  });

  const client = new TelegraphClient({
    mode: flags.mode || "auto",
    budgetGuard,
    simulator: createMission05Simulator(),
  });

  if (command === "inspect-intent") {
    const intent = rest[0] || "SANCTIONS_SCREENING_MATCH_GENERAL";
    const contract = await client.fetchIntentContract(intent);
    console.log(JSON.stringify(contract, null, 2));
    return 0;
  }

  if (command === "balance") {
    const bal = await client.fetchEscrowAccount();
    console.log(JSON.stringify({ mode: client.mode, payer: client.payerAddress, ...bal }, null, 2));
    return 0;
  }

  if (command === "verify-receipt") {
    if (!flags.epoch || !flags.receipt) {
      console.error("Usage: verify-receipt --epoch <epochId> --receipt <receiptHash>");
      return 2;
    }
    const proof = await client.verifyEpochDelivery(flags.epoch, flags.receipt);
    console.log(JSON.stringify(proof, null, 2));
    return proof.ok ? 0 : 1;
  }

  if (command === "run") {
    const dossier = flags.scenario
      ? BUILTIN_SCENARIOS[flags.scenario]
      : buildCustomDossier({
          claim: flags.claim,
          entity: flags.entity,
          port: flags.port,
          vessel: flags.vessel,
          country: flags.country,
          weatherLocation: flags["weather-location"],
          weatherDate: flags["weather-date"],
          mediaUrl: flags["media-url"],
        });

    if (!dossier) {
      console.error(`Unknown scenario "${flags.scenario}". Run 'scenarios' to list valid IDs.`);
      return 2;
    }

    const report = await runFactGapDossier(client, dossier, {
      publishAction: Boolean(flags.publish),
      publishAuthorized: Boolean(flags.authorize),
      bypassCache: Boolean(flags["no-cache"]),
    });

    if (flags.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatHumanReport(report));
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().then((code) => process.exit(code)).catch((err) => {
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  });
}
