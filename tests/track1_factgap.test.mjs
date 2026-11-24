import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthorizationRequiredError,
  SpendBudgetGuard,
  TelegraphClient,
} from "../shared/telegraph_client.mjs";
import { BUILTIN_SCENARIOS, createMission05Simulator } from "../track1_factgap_app/scenarios.mjs";
import { runFactGapDossier } from "../track1_factgap_app/engine.mjs";
import { createFactGapServer } from "../track1_factgap_app/server.mjs";

test("Track 01 FactGap: Black Sea Grain Corridor produces itemized receipts, visible contradictions, and $0 TTL cache reuse", async () => {
  const client = new TelegraphClient({
    mode: "simulated",
    budgetGuard: new SpendBudgetGuard({ maxPerRunUusdc: 120_000, maxDailyUusdc: 500_000 }),
    simulator: createMission05Simulator(),
  });

  const report = await runFactGapDossier(client, BUILTIN_SCENARIOS["black-sea-grain"]);
  assert.equal(report.simulated, true);
  assert.equal(report.network_mode, "SIMULATED_TEST_FIXTURE");
  assert.equal(report.summary.verified_checks, 5);
  assert.equal(report.summary.evidence_completeness_pct, 100);
  assert.ok(report.summary.discrepancy_score >= 60);
  assert.ok(report.contradictions.some((c) => c.type === "SANCTIONS_HIT_DISCREPANCY"));
  assert.ok(report.contradictions.some((c) => c.type === "PORT_WAIT_DISCREPANCY"));
  assert.ok(report.contradictions.some((c) => c.type === "WEATHER_DISRUPTION_DISCREPANCY"));
  assert.equal(report.cost_accounting.total_cost_usd, 0.05);

  // Second run reuses fresh cached intelligence at $0.00 cost
  const cachedReport = await runFactGapDossier(client, BUILTIN_SCENARIOS["black-sea-grain"]);
  assert.equal(cachedReport.cost_accounting.total_cost_usd, 0);
  assert.equal(cachedReport.cost_accounting.cached_reuse_count, 5);
});

test("Track 01 FactGap Failure Case: catches #234 null schema-shaped FACT_CHECK verdict & #233 openai cost_usd=0", async () => {
  const client = new TelegraphClient({
    mode: "simulated",
    budgetGuard: new SpendBudgetGuard({ maxPerRunUusdc: 100_000 }),
    simulator: createMission05Simulator(),
  });

  const report = await runFactGapDossier(client, BUILTIN_SCENARIOS["failure-empty-verdict"]);
  assert.equal(report.summary.verified_checks, 0);
  assert.equal(report.summary.provenance_status, "UNKNOWN_INSUFFICIENT_VERIFIED_EVIDENCE");
  assert.equal(report.checks[0].status, "PROVIDER_DEFECT");
  assert.ok(report.checks[0].quality_flags.some((f) => f.includes("UNVERIFIABLE_EMPTY_PROVIDER")));
  // #233 check: openai fallback reported cost_usd=0, but guard conservatively accounted $0.01!
  assert.equal(report.checks[1].status, "PROVIDER_DEFECT");
  assert.equal(report.checks[1].cost_usd, 0.01);
  assert.equal(report.cost_accounting.total_cost_usd, 0.02);
});

test("Track 01 FactGap Failure Case: excludes stale AIS (>72h) and flags manipulated media", async () => {
  const client = new TelegraphClient({
    mode: "simulated",
    budgetGuard: new SpendBudgetGuard({ maxPerRunUusdc: 100_000 }),
    simulator: createMission05Simulator(),
  });

  const report = await runFactGapDossier(client, BUILTIN_SCENARIOS["failure-stale-ais"]);
  const staleCheck = report.checks.find((c) => c.check_id === "stale_vessel");
  const mediaCheck = report.checks.find((c) => c.check_id === "forged_media");
  assert.equal(staleCheck.status, "STALE_DATA");
  assert.equal(staleCheck.discrepancy_points, 0);
  assert.equal(mediaCheck.status, "VERIFIED");
  assert.equal(mediaCheck.classification, "CONTRADICTS_REPORTED_CLAIM");
});

test("Track 01 FactGap Guardrails: tight budget cap halts before overspending & publish requires explicit authorization", async () => {
  const client = new TelegraphClient({
    mode: "simulated",
    budgetGuard: new SpendBudgetGuard({ maxPerRunUusdc: 10_000, maxDailyUusdc: 100_000 }),
    simulator: createMission05Simulator(),
  });

  // External publication without explicit publishAuthorized=true MUST refuse
  await assert.rejects(
    () => runFactGapDossier(client, BUILTIN_SCENARIOS["black-sea-grain"], { publishAction: true, publishAuthorized: false }),
    AuthorizationRequiredError
  );

  // Tight $0.01 run cap completes check #1 and blocks check #2 cleanly
  const report = await runFactGapDossier(client, BUILTIN_SCENARIOS["black-sea-grain"]);
  assert.equal(report.cost_accounting.total_cost_usd, 0.01);
  assert.equal(report.checks.length, 2);
  assert.equal(report.checks[1].status, "BLOCKED_BY_GUARD");
  assert.ok(report.summary.halted_reason.includes("BudgetExceededError"));
});

test("Track 01 FactGap Web UI, REST API & Streamable HTTP MCP Server work end-to-end", async () => {
  const client = new TelegraphClient({
    mode: "simulated",
    budgetGuard: new SpendBudgetGuard({ maxPerRunUusdc: 100_000, maxDailyUusdc: 500_000 }),
    simulator: createMission05Simulator(),
  });
  const server = createFactGapServer({ client });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Dark-mode HTML UI with strict CSP nonce
    const uiRes = await fetch(`${base}/`);
    assert.equal(uiRes.status, 200);
    assert.ok(uiRes.headers.get("content-security-policy").includes("nonce-"));
    const html = await uiRes.text();
    assert.ok(html.includes("Upswing FactGap"));

    // 2. REST API /api/analyze
    const anRes = await fetch(`${base}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: "sanctioned-crude-tanker" }),
    });
    assert.equal(anRes.status, 200);
    const packet = await anRes.json();
    assert.equal(packet.summary.verified_checks, 4);
    assert.ok(packet.contradictions.some((c) => c.type === "SANCTIONS_HIT_DISCREPANCY"));

    // 3. MCP initialize + tools/list + tools/call
    const mcpInit = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    }).then((r) => r.json());
    assert.equal(mcpInit.result.serverInfo.name, "upswing-factgap-mcp");

    const mcpList = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }).then((r) => r.json());
    assert.equal(mcpList.result.tools.length, 5);

    const mcpCall = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "factgap_budget_status", arguments: {} },
      }),
    }).then((r) => r.json());
    assert.equal(mcpCall.result.structuredContent.budget.ledger_count, 4);
  } finally {
    server.close();
  }
});
