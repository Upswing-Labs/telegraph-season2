/**
 * Track 01 — Upswing FactGap Web UI, JSON API & Streamable HTTP MCP Server.
 * Mission 05 (Conflict Intelligence) — Routes 2 & 3.
 * Zero external dependencies — runs directly on Node 20+/24+.
 */

import http from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SpendBudgetGuard, TelegraphClient } from "../shared/telegraph_client.mjs";
import { BUILTIN_SCENARIOS, createMission05Simulator } from "./scenarios.mjs";
import { buildCustomDossier, runFactGapDossier } from "./engine.mjs";
import { handleFactGapMcpRequest } from "./mcp.mjs";

const MAX_BODY_BYTES = 128 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body exceeds 128 KiB limit"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data, extraHeaders = {}) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders,
  });
  res.end(payload);
}

function renderDashboardHtml(nonce, mode) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Upswing FactGap — Mission 05 Conflict Intelligence Desk</title>
<style>
  :root { --bg:#090d14; --panel:#111827; --border:#1f2937; --text:#e5e7eb; --muted:#9ca3af; --accent:#38bdf8; --ok:#22c55e; --warn:#f59e0b; --bad:#ef4444; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); }
  header { padding:20px 28px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; }
  h1 { margin:0; font-size:20px; letter-spacing:-0.01em; }
  .badge { font-size:12px; padding:4px 10px; border-radius:999px; border:1px solid var(--border); background:#0f172a; color:var(--accent); }
  main { max-width:1180px; margin:0 auto; padding:24px; display:grid; grid-template-columns:360px 1fr; gap:20px; }
  @media (max-width:900px) { main { grid-template-columns:1fr; } }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:18px; }
  .card h2 { margin:0 0 12px 0; font-size:15px; color:#f9fafb; }
  label { display:block; font-size:12px; color:var(--muted); margin:10px 0 4px; }
  select, input, button { width:100%; padding:9px 11px; border-radius:8px; border:1px solid var(--border); background:#0b1220; color:var(--text); font-size:13px; }
  button { cursor:pointer; font-weight:600; background:#0284c7; border-color:#0369a1; margin-top:10px; }
  button:hover { background:#0369a1; }
  button.secondary { background:#1f2937; border-color:#374151; }
  button.danger { background:#7f1d1d; border-color:#991b1b; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .kpi-row { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; }
  .kpi { background:#0b1220; border:1px solid var(--border); border-radius:8px; padding:10px; }
  .kpi .k { font-size:11px; color:var(--muted); }
  .kpi .v { font-size:18px; font-weight:700; margin-top:3px; }
  pre { background:#060a10; border:1px solid var(--border); border-radius:8px; padding:12px; overflow:auto; font-size:12px; max-height:420px; }
  .pill { display:inline-block; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:600; margin-right:6px; }
  .pill-ok { background:#052e16; color:#86efac; }
  .pill-warn { background:#451a03; color:#fcd34d; }
  .pill-bad { background:#450a0a; color:#fca5a5; }
  .note { font-size:12px; color:var(--muted); line-height:1.45; margin-top:10px; }
  .row { border-top:1px solid var(--border); padding:10px 0; font-size:13px; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Upswing FactGap — Conflict &amp; Macro Discrepancy Desk</h1>
    <div style="font-size:12px;color:#9ca3af;margin-top:4px;">Telegraph Protocol Season II · Mission 05 (Routes 2 &amp; 3) · Reported-vs-Observed &amp; Priced-Per-Fact Audit</div>
  </div>
  <span class="badge">Rail Mode: ${mode.toUpperCase()}</span>
</header>
<main>
  <section class="card">
    <h2>1. Run Discrepancy Dossier</h2>
    <label for="scenario">Built-in Mission 05 Scenario / Failure Test</label>
    <select id="scenario">
      <option value="black-sea-grain">Black Sea Grain Corridor (Route 2 + 3)</option>
      <option value="sanctioned-crude-tanker">Shadow-Fleet Crude Tanker Audit (Sanctions + AIS)</option>
      <option value="red-sea-chokepoint">Red Sea / Jeddah Priced-Per-Fact Note</option>
      <option value="failure-empty-verdict">[Failure Test] Null Verdict (#234) + LLM Fallback (#233)</option>
      <option value="failure-stale-ais">[Failure Test] Stale AIS (&gt;72h) + Manipulated Media</option>
    </select>
    <label for="capUsd">Hard Per-Run Budget Cap (USD)</label>
    <input id="capUsd" type="number" step="0.01" min="0.01" max="0.50" value="0.12" />
    <button id="runBtn">Buy Intelligence &amp; Audit Discrepancies</button>
    <div class="grid2">
      <button id="tightCapBtn" class="secondary">Test Cap Block ($0.01)</button>
      <button id="toggleAuthBtn" class="danger">Revoke Spend Auth</button>
    </div>
    <p class="note">
      <strong>Epistemic Boundary:</strong> FactGap outputs provenance, receipts, and contradictions — never a definitive verdict on a live conflict. Contradictions are never averaged away.
    </p>
    <div id="budgetBox" class="note"></div>
  </section>

  <section class="card">
    <h2>2. Auditable Provenance &amp; Contradiction Packet</h2>
    <div class="kpi-row">
      <div class="kpi"><div class="k">Discrepancy</div><div class="v" id="kScore">—</div></div>
      <div class="kpi"><div class="k">Completeness</div><div class="v" id="kComp">—</div></div>
      <div class="kpi"><div class="k">Total Spend</div><div class="v" id="kCost">—</div></div>
      <div class="kpi"><div class="k">Contradictions</div><div class="v" id="kContr">—</div></div>
    </div>
    <div id="contradictions"></div>
    <div id="signals"></div>
    <h2 style="margin-top:16px;">Raw Signed Packet JSON</h2>
    <pre id="rawJson">Select a scenario and click "Buy Intelligence &amp; Audit Discrepancies".</pre>
  </section>
</main>
<script nonce="${nonce}">
let authEnabled = true;
async function refreshBudget() {
  const r = await fetch('/api/budget');
  const d = await r.json();
  authEnabled = d.budget.spending_authorized;
  document.getElementById('toggleAuthBtn').textContent = authEnabled ? 'Revoke Spend Auth' : 'Restore Spend Auth';
  document.getElementById('budgetBox').innerHTML =
    '<strong>Wallet Spend Guard:</strong> Daily spent $' + d.budget.daily_spent_usd.toFixed(4) +
    ' / $' + d.budget.max_daily_usd.toFixed(2) +
    ' · Auth: ' + (authEnabled ? 'AUTHORIZED' : 'REVOKED') +
    ' · Receipts: ' + d.budget.ledger_count;
}
async function runAnalysis(overrideCap) {
  const scenario_id = document.getElementById('scenario').value;
  const max_run_usd = overrideCap ?? Number(document.getElementById('capUsd').value || 0.12);
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario_id, max_run_usd, bypass_cache: true })
  });
  const data = await res.json();
  document.getElementById('rawJson').textContent = JSON.stringify(data, null, 2);
  if (data.summary) {
    document.getElementById('kScore').textContent = data.summary.discrepancy_score + '/100';
    document.getElementById('kComp').textContent = data.summary.evidence_completeness_pct + '%';
    document.getElementById('kCost').textContent = '$' + data.cost_accounting.total_cost_usd.toFixed(4);
    document.getElementById('kContr').textContent = String(data.summary.contradiction_count);
    const cEl = document.getElementById('contradictions');
    cEl.innerHTML = data.contradictions.length
      ? data.contradictions.map(c => '<div class="row"><span class="pill pill-bad">' + c.severity + '</span><strong>' + c.type + '</strong>: ' + c.detail + '</div>').join('')
      : '<div class="row"><span class="pill pill-ok">ALIGNED</span> No discrepancies detected against reported baseline.</div>';
    const sEl = document.getElementById('signals');
    sEl.innerHTML = data.checks.map(ch => {
      const cls = ch.status === 'VERIFIED' ? 'pill-ok' : (ch.status === 'STALE_DATA' ? 'pill-warn' : 'pill-bad');
      const rHash = ch.provenance && ch.provenance.receipt_hash ? ch.provenance.receipt_hash.slice(0, 18) + '…' : 'unbilled';
      return '<div class="row"><span class="pill ' + cls + '">' + ch.status + '</span><strong>' + ch.intent + '</strong> · $' + (ch.cost_usd || 0).toFixed(4) + ' · ' + ch.latency_ms + 'ms · receipt: <code>' + rHash + '</code></div>';
    }).join('');
  }
  await refreshBudget();
}
document.getElementById('runBtn').addEventListener('click', () => runAnalysis());
document.getElementById('tightCapBtn').addEventListener('click', () => runAnalysis(0.01));
document.getElementById('toggleAuthBtn').addEventListener('click', async () => {
  await fetch('/api/budget/authority', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorized: !authEnabled })
  });
  await refreshBudget();
});
refreshBudget();
</script>
</body>
</html>`;
}

export function createFactGapServer({ client = null } = {}) {
  const activeClient =
    client ||
    new TelegraphClient({
      mode: process.env.FACTGAP_MODE || "auto",
      budgetGuard: new SpendBudgetGuard({
        maxPerCallUusdc: 50_000,
        maxPerRunUusdc: 120_000,
        maxDailyUusdc: 1_000_000,
      }),
      simulator: createMission05Simulator(),
    });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");

    try {
      if (req.method === "GET" && url.pathname === "/") {
        const nonce = randomBytes(16).toString("base64");
        const html = renderDashboardHtml(nonce, activeClient.mode);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'`,
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          status: "ok",
          product: "upswing-factgap",
          mission: "Mission 05 — Conflict Intelligence",
          mode: activeClient.mode,
          mcp_endpoint: "/mcp",
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/scenarios") {
        sendJson(res, 200, { scenarios: Object.values(BUILTIN_SCENARIOS) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/budget") {
        sendJson(res, 200, { mode: activeClient.mode, budget: activeClient.budgetGuard.snapshot() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ledger") {
        sendJson(res, 200, { count: activeClient.budgetGuard.ledger.length, ledger: activeClient.budgetGuard.ledger });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/budget/authority") {
        const body = await readJsonBody(req);
        if (body.authorized === false) activeClient.budgetGuard.revokeAuthorization();
        else activeClient.budgetGuard.grantAuthorization();
        sendJson(res, 200, { budget: activeClient.budgetGuard.snapshot() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/analyze") {
        const body = await readJsonBody(req);
        if (typeof body.max_run_usd === "number" && body.max_run_usd > 0) {
          activeClient.budgetGuard.maxPerRunUusdc = Math.round(body.max_run_usd * 1e6);
        }
        const dossier = body.scenario_id
          ? BUILTIN_SCENARIOS[body.scenario_id]
          : buildCustomDossier(body);
        if (!dossier) {
          sendJson(res, 400, { error: `Unknown scenario_id "${body.scenario_id}"` });
          return;
        }
        const report = await runFactGapDossier(activeClient, dossier, {
          publishAction: Boolean(body.publish),
          publishAuthorized: Boolean(body.authorize),
          bypassCache: Boolean(body.bypass_cache),
        });
        sendJson(res, 200, report);
        return;
      }

      if (req.method === "POST" && url.pathname === "/mcp") {
        const body = await readJsonBody(req);
        const rpcResp = await handleFactGapMcpRequest(body, activeClient);
        sendJson(res, 200, rpcResp);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      const code = err.name === "AuthorizationRequiredError" ? 403 : 400;
      sendJson(res, code, { error: err.name || "Error", message: err.message });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8781);
  const host = process.env.HOST || "127.0.0.1";
  const server = createFactGapServer();
  server.listen(port, host, () => {
    console.log(`Upswing FactGap listening on http://${host}:${port} (MCP: POST /mcp)`);
  });
}
