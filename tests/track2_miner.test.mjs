import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateMinerYaml } from "../track2_solsignal_miner/yaml_validator.mjs";
import {
  computeAmmSellDropPct,
  parseTelegraphQueryParams,
  SolSignalMinerService,
} from "../track2_solsignal_miner/miner_service.mjs";
import { createSolSignalMinerServer } from "../track2_solsignal_miner/server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MINER_YAML_PATH = join(__dirname, "..", "track2_solsignal_miner", "miner.yaml");

test("Track 02 Miner YAML passes 100% of Telegraph V2 Stage-1 & Request-Contract rules with zero warnings", () => {
  const raw = readFileSync(MINER_YAML_PATH, "utf8");
  const res = validateMinerYaml(raw);
  assert.equal(res.valid, true, `YAML errors: ${res.errors.join("; ")}`);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.id, 880401);
  assert.equal(res.slug, "upswing-solsignal-liquidity");
  assert.deepEqual(res.supported_intents, [
    "LIQUIDITY_DEPTH_VERIFY_GENERAL",
    "FRAUD_RISK_GENERAL",
    "CRYPTO_PRICE_USD",
  ]);
  assert.match(res.yaml_sha256, /^0x[0-9a-f]{64}$/);
});

test("Track 02 YAML Validator rejects known Telegraph V2 invalid patterns (prefix, nested input_schema, signal_mapping.type)", () => {
  const badYaml = `version: "1"
kind: miner
id: 999999
slug: bad-miner
name: Bad Miner
base_url: http://127.0.0.1:8080
custom_extra: nope
endpoints:
  - path: /p
    external_path: /p
    method: GET
    description: Bad endpoint with nested input_schema
    intents: [FX_NOW]
    input_schema:
      type: object
semantics:
  signal_mapping:
    type: bad
    label_field: ok
  supported_intents:
    - FX_NOW
`;
  const res = validateMinerYaml(badYaml);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("Additional property custom_extra")));
  assert.ok(res.errors.some((e) => e.includes("loopback/localhost")));
  assert.ok(res.errors.some((e) => e.includes("Additional property input_schema")));
  assert.ok(res.errors.some((e) => e.includes("Additional property type")));
  assert.ok(res.errors.some((e) => e.includes("a prefix is not an intent")));
});

test("Track 02 Issue #207 Regression: refuses cross-chain BNB $28M substitution when Ethereum pool requested", async () => {
  const mockFetch = async (url) => {
    if (url.includes("/pairs/ethereum/")) {
      return new Response(JSON.stringify({ pairs: null }), { status: 200 });
    }
    if (url.includes("/tokens/0x1990D912C5F2Bf8638a5bCd4EAD66df9596bf851")) {
      // Upstream only has a BNB Chain pair (simulating the exact trap that broke Miner 501 in #207!)
      return new Response(
        JSON.stringify({
          pairs: [
            {
              chainId: "bsc",
              dexId: "pancakeswap",
              pairAddress: "0xbscpool",
              baseToken: { symbol: "ETH", address: "0x1990D912C5F2Bf8638a5bCd4EAD66df9596bf851" },
              quoteToken: { symbol: "USDC" },
              liquidity: { usd: 28000000 },
            },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 404 });
  };

  const svc = new SolSignalMinerService({ fetchImpl: mockFetch });
  const out = await svc.verifyLiquidityDepth({
    pool: "0x1990D912C5F2Bf8638a5bCd4EAD66df9596bf851",
    chain: "ethereum",
  });
  assert.equal(out.status, 422);
  assert.equal(out.body.error, "chain_mismatch");
  assert.equal(out.body.requested_chain, "ethereum");
  assert.deepEqual(out.body.observed_chains, ["bsc"]);
});

test("Track 02 Miner HTTP Server serves liquidity, SolSignal fraud-risk, crypto-price, Go-map optional params, and TTL cache", async () => {
  let dexCalls = 0;
  const mockFetch = async (url) => {
    if (url.includes("api.dexscreener.com/latest/dex/pairs/solana/")) {
      dexCalls++;
      return new Response(
        JSON.stringify({
          pairs: [
            {
              chainId: "solana",
              dexId: "raydium",
              pairAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
              baseToken: { symbol: "SOL", address: "So11111111111111111111111111111111111111112" },
              quoteToken: { symbol: "USDC" },
              priceUsd: "185.42",
              liquidity: { usd: 200000 },
              volume: { h24: 1500000 },
            },
          ],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/api/v1/free/signal?mint=")) {
      return new Response(
        JSON.stringify({
          schemaVersion: "2.0",
          degraded: false,
          generatedAt: "2026-11-23T22:00:00Z",
          token: { symbol: "SOL" },
          market: { liquidityUsd: 64910000 },
          safety: {
            rugRiskScore: 8,
            verdict: "LOW_RISK",
            riskFlags: [],
          },
          ammDumpStress: { headline: "LOW AMM dump stress" },
        }),
        { status: 200 }
      );
    }
    if (url.includes("api.coinbase.com")) {
      return new Response(JSON.stringify({ data: { rates: { USD: "91250.50" } } }), { status: 200 });
    }
    if (url.includes("api.kraken.com")) {
      return new Response(JSON.stringify({ result: { XXBTZUSD: { c: ["91300.00"] } } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };

  const svc = new SolSignalMinerService({ fetchImpl: mockFetch });
  const server = createSolSignalMinerServer({ service: svc });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. /health and /miner.yaml
    const h = await fetch(`${base}/health`).then((r) => r.json());
    assert.equal(h.miner_id, 880401);
    const y = await fetch(`${base}/miner.yaml`).then((r) => r.text());
    assert.ok(y.includes("upswing-solsignal-liquidity"));

    // 2. /v1/liquidity + AMM stress math + cache hit on 2nd call
    const l1 = await fetch(`${base}/v1/liquidity?pool=58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2&chain=solana`).then((r) => r.json());
    assert.equal(l1.liquidity_usd, 200000);
    assert.equal(l1.amm_dump_stress_pct.sell_100k, computeAmmSellDropPct(200000, 100000)); // R=100k, Q=100k -> (1 - 0.25)*100 = 75%
    assert.equal(l1.amm_dump_stress_pct.sell_100k, 75);
    assert.equal(l1.cached, false);

    const l2 = await fetch(`${base}/v1/liquidity?optional=map[pool:58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2%20chain:solana]`).then((r) => r.json());
    assert.equal(l2.cached, true);
    assert.equal(dexCalls, 1);

    // 3. /v1/fraud-risk wrapping Upswing SolSignal
    const r1 = await fetch(`${base}/v1/fraud-risk?subject=So11111111111111111111111111111111111111112`).then((r) => r.json());
    assert.equal(r1.risk_level, "LOW");
    assert.equal(r1.risk_score, 0.08);
    assert.equal(r1.source, "upswing_solsignal_live");

    // 4. /v1/fraud-risk refuses arbitrary free text honestly (422)
    const badRisk = await fetch(`${base}/v1/fraud-risk?subject=random_name_not_address`);
    assert.equal(badRisk.status, 422);

    // 5. /v1/crypto-price computes exact median of Coinbase + Kraken
    const px = await fetch(`${base}/v1/crypto-price?symbol=BTC`).then((r) => r.json());
    assert.equal(px.price_usd, 91275.25);
    assert.equal(px.quotes.length, 2);
  } finally {
    server.close();
  }
});

test("parseTelegraphQueryParams cleanly decodes Go-map optional payload format (#208)", () => {
  const sp = new URLSearchParams("optional=map[pool:0x1234 chain:ethereum]");
  const parsed = parseTelegraphQueryParams(sp);
  assert.equal(parsed.pool, "0x1234");
  assert.equal(parsed.chain, "ethereum");
});
