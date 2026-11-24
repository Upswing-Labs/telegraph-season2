/**
 * Track 02 — Cloudflare Workers ($0-infra edge) entrypoint for Upswing SolSignal Telegraph Miner.
 * Uses the exact same SolSignalMinerService as the standalone Node HTTP server.
 */

import { parseTelegraphQueryParams, SolSignalMinerService, BoundedTtlCache } from "./miner_service.mjs";
import minerYamlRaw from "./miner.yaml";

const SOLSIGNAL_ORIGIN = "https://upswing-solsignal.upswing-labs.workers.dev";
const sharedCache = new BoundedTtlCache();

function buildServiceForEnv(env) {
  const fetchImpl = (input, init) => {
    const urlStr = typeof input === "string" ? input : input?.url || "";
    if (env?.SOLSIGNAL && urlStr.startsWith(SOLSIGNAL_ORIGIN)) {
      return env.SOLSIGNAL.fetch(new Request(urlStr, init));
    }
    return fetch(input, init);
  };
  return new SolSignalMinerService({ fetchImpl, cache: sharedCache });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const params = parseTelegraphQueryParams(url.searchParams);
    const service = buildServiceForEnv(env);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return jsonResponse({
        status: "ok",
        miner_id: 880401,
        slug: "upswing-solsignal-liquidity",
        manifest_url: `${url.origin}/miner.yaml`,
        endpoints: ["/v1/liquidity", "/v1/fraud-risk", "/v1/crypto-price", "/miner.yaml", "/health"],
        supported_intents: [
          "LIQUIDITY_DEPTH_VERIFY_GENERAL",
          "FRAUD_RISK_GENERAL",
          "CRYPTO_PRICE_USD",
        ],
      });
    }

    if (request.method === "GET" && url.pathname === "/miner.yaml") {
      return new Response(minerYamlRaw, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/liquidity") {
      const out = await service.verifyLiquidityDepth({ pool: params.pool, chain: params.chain });
      return jsonResponse(out.body, out.status);
    }

    if (request.method === "GET" && url.pathname === "/v1/fraud-risk") {
      const out = await service.assessFraudRisk({ subject: params.subject || params.token || params.mint });
      return jsonResponse(out.body, out.status);
    }

    if (request.method === "GET" && url.pathname === "/v1/crypto-price") {
      const out = await service.getCryptoPriceUsd({ symbol: params.symbol });
      return jsonResponse(out.body, out.status);
    }

    return jsonResponse({ error: "not_found" }, 404);
  },
};
