/**
 * Track 02 — Standalone Zero-Dependency HTTP Server for Upswing SolSignal Telegraph Miner.
 * Serves:
 *   GET /health
 *   GET /miner.yaml
 *   GET /v1/liquidity?pool=<addr>&chain=<chain>
 *   GET /v1/fraud-risk?subject=<mint_or_evm_addr>
 *   GET /v1/crypto-price?symbol=<SYM>
 */

import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTelegraphQueryParams, SolSignalMinerService } from "./miner_service.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data, null, 2));
}

export function createSolSignalMinerServer({ service = new SolSignalMinerService() } = {}) {
  const yamlPath = join(__dirname, "miner.yaml");
  const yamlBytes = readFileSync(yamlPath, "utf8");

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const params = parseTelegraphQueryParams(url.searchParams);

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          status: "ok",
          miner_id: 880401,
          slug: "upswing-solsignal-liquidity",
          supported_intents: [
            "LIQUIDITY_DEPTH_VERIFY_GENERAL",
            "FRAUD_RISK_GENERAL",
            "CRYPTO_PRICE_USD",
          ],
          yaml_url: "/miner.yaml",
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/miner.yaml") {
        res.writeHead(200, {
          "Content-Type": "text/yaml; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(yamlBytes);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/liquidity") {
        const out = await service.verifyLiquidityDepth({ pool: params.pool, chain: params.chain });
        sendJson(res, out.status, out.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/fraud-risk") {
        const out = await service.assessFraudRisk({ subject: params.subject || params.token || params.mint });
        sendJson(res, out.status, out.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/crypto-price") {
        const out = await service.getCryptoPriceUsd({ symbol: params.symbol });
        sendJson(res, out.status, out.body);
        return;
      }

      sendJson(res, 404, { error: "not_found", message: `Unknown route ${req.method} ${url.pathname}` });
    } catch (err) {
      sendJson(res, 502, { error: "internal_upstream_error", message: err.message });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8782);
  const host = process.env.HOST || "127.0.0.1";
  const server = createSolSignalMinerServer();
  server.listen(port, host, () => {
    console.log(`Upswing SolSignal Miner listening on http://${host}:${port}`);
  });
}
