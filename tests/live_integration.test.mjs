/**
 * Opt-in Live Network Integration Tests (run via `npm run test:live`).
 * Verifies real live interoperability against:
 *  - https://devnode.telegraphprotocol.com (EIP-191 Escrow signature acceptance!)
 *  - https://upswing-solsignal.upswing-labs.workers.dev (Live SolSignal API!)
 *  - https://api.dexscreener.com, api.coinbase.com, api.kraken.com
 */

import test from "node:test";
import assert from "node:assert/strict";
import { generateEphemeralPrivateKey } from "../shared/crypto.mjs";
import { SpendBudgetGuard, TelegraphClient } from "../shared/telegraph_client.mjs";
import { SolSignalMinerService } from "../track2_solsignal_miner/miner_service.mjs";

const RUN_LIVE = process.env.TELEGRAPH_LIVE_TESTS === "1";

test("LIVE devnode: pure-JS EIP-191 Escrow X-PAYMENT signature verifies on real Sepolia devnode", { skip: !RUN_LIVE }, async () => {
  const ephemeralKey = generateEphemeralPrivateKey();
  const client = new TelegraphClient({
    mode: "escrow",
    privateKey: ephemeralKey,
    budgetGuard: new SpendBudgetGuard({ maxPerCallUusdc: 50_000, maxPerRunUusdc: 50_000 }),
  });

  // Per anjoman.ai/docs/using/escrow-inference:
  // "An unfunded wallet gets 'insufficient escrow for delivery: ... > balance=0 uUSDC',
  //  which proves the signature verified and only the balance is missing."
  const res = await client.askCanonical({
    intent: "FX_NOW_EUR",
    params: { currency: "EUR" },
    maxBudgetUusdc: 10_000,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 402);
  assert.match(String(res.error || ""), /insufficient escrow for delivery/i, `Unexpected devnode response: ${JSON.stringify(res)}`);
});

test("LIVE SolSignal Miner: real DexScreener + live Upswing SolSignal + Coinbase/Kraken", { skip: !RUN_LIVE }, async () => {
  const svc = new SolSignalMinerService({ timeoutMs: 8_000 });

  // 1. Live Solana Raydium SOL/USDC liquidity
  const solLiq = await svc.verifyLiquidityDepth({
    pool: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
    chain: "solana",
  });
  assert.equal(solLiq.status, 200, JSON.stringify(solLiq));
  assert.equal(solLiq.body.chain, "solana");
  assert.ok(solLiq.body.liquidity_usd > 100_000, `Expected deep SOL/USDC liquidity, got ${solLiq.body.liquidity_usd}`);

  // 2. Live #207 Ethereum honeypot regression (must NOT hallucinate $28M BNB Chain!)
  const ethHoneypot = await svc.verifyLiquidityDepth({
    pool: "0x1990D912C5F2Bf8638a5bCd4EAD66df9596bf851",
    chain: "ethereum",
  });
  if (ethHoneypot.status === 200) {
    assert.equal(ethHoneypot.body.chain, "ethereum");
    assert.ok(ethHoneypot.body.liquidity_usd < 1000, `Expected near-zero liquidity, got ${ethHoneypot.body.liquidity_usd}`);
  } else {
    assert.equal(ethHoneypot.status, 422);
    assert.ok(["pool_not_found", "chain_mismatch"].includes(ethHoneypot.body.error));
  }

  // 3. Live Upswing SolSignal FRAUD_RISK_GENERAL for Jupiter JUP SPL mint
  const jupRisk = await svc.assessFraudRisk({
    subject: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  });
  assert.equal(jupRisk.status, 200, JSON.stringify(jupRisk));
  assert.ok(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(jupRisk.body.risk_level));
  assert.equal(jupRisk.body.source, "upswing_solsignal_live");

  // 4. Live CRYPTO_PRICE_USD for BTC & SOL
  const btc = await svc.getCryptoPriceUsd({ symbol: "BTC" });
  assert.equal(btc.status, 200, JSON.stringify(btc));
  assert.ok(btc.body.price_usd > 10_000 && btc.body.price_usd < 1_000_000);
  assert.ok(btc.body.quotes.length >= 1);
});
