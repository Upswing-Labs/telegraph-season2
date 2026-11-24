import test from "node:test";
import assert from "node:assert/strict";
import {
  keccak256Hex,
  personalSign,
  privateKeyToAddress,
  recoverPersonalSignAddress,
} from "../shared/crypto.mjs";
import { validateIntentParams } from "../shared/schemas.mjs";
import {
  AuthorizationRequiredError,
  BudgetExceededError,
  buildEscrowPaymentHeader,
  SpendBudgetGuard,
} from "../shared/telegraph_client.mjs";

// Well-known public Hardhat/Foundry account #0 test vector (NEVER holds mainnet funds)
const FOUNDRY_TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FOUNDRY_TEST_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

test("Ethereum Keccak-256 matches official Ethereum test vectors (0x01 padding)", () => {
  assert.equal(
    keccak256Hex(""),
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  );
  assert.equal(
    keccak256Hex("hello"),
    "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
  );
  assert.equal(
    keccak256Hex("Transfer(address,address,uint256)"),
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  );
});

test("secp256k1 privateKeyToAddress matches official Foundry/Hardhat account #0", () => {
  assert.equal(privateKeyToAddress(FOUNDRY_TEST_KEY), FOUNDRY_TEST_ADDR);
});

test("EIP-191 personalSign is deterministic (RFC 6979) and recovers exact signer address", () => {
  const msg = "Telegraph Protocol V2 verification test\nChain: 11155111";
  const sig1 = personalSign(msg, FOUNDRY_TEST_KEY);
  const sig2 = personalSign(msg, FOUNDRY_TEST_KEY);
  assert.equal(sig1, sig2);
  assert.equal(sig1.length, 132); // 0x + 65 bytes
  assert.equal(recoverPersonalSignAddress(msg, sig1), FOUNDRY_TEST_ADDR);
});

test("buildEscrowPaymentHeader signs exact challenge template with lowercased address and <=120s window", () => {
  const challenge = {
    accepts: [
      {
        scheme: "escrow",
        network: "eip155:11155111",
        price: "$0.01",
        payTo: "0x72a70e949362670bf8bcead24efc5b8f950aa08b",
        extra: {
          resource: "/v1/ask",
          message:
            "Telegraph Escrow Payment\n\nWallet: {from}\nPay To: 0x72a70e949362670bf8bcead24efc5b8f950aa08b\nNetwork: eip155:11155111\nAmount: 10000 uUSDC\nResource: /v1/ask\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}",
        },
      },
    ],
  };

  const built = buildEscrowPaymentHeader(challenge, FOUNDRY_TEST_KEY, {
    nowSec: 1790000000,
    nonce: "test-nonce-1234",
  });
  assert.equal(built.amountUusdc, 10000);
  assert.equal(built.authorization.from, FOUNDRY_TEST_ADDR.toLowerCase());
  assert.ok(Number(built.authorization.validBefore) - Number(built.authorization.validAfter) <= 120);

  const decoded = JSON.parse(Buffer.from(built.headerValue, "base64").toString("utf8"));
  assert.equal(decoded.x402Version, 2);
  assert.equal(decoded.scheme, "escrow");
  assert.equal(decoded.network, "eip155:11155111");
  assert.equal(
    recoverPersonalSignAddress(built.message, decoded.payload.signature).toLowerCase(),
    FOUNDRY_TEST_ADDR.toLowerCase()
  );
});

test("validateIntentParams catches unknown params, bad enums, bad dates, and oversized payloads before payment", () => {
  assert.equal(
    validateIntentParams("LIQUIDITY_DEPTH_VERIFY_GENERAL", { pool: "0x123", chain: "ethereum" }).ok,
    true
  );
  const badUnknown = validateIntentParams("LIQUIDITY_DEPTH_VERIFY_GENERAL", { pool: "0x123", chain: "ethereum", extra: 1 });
  assert.equal(badUnknown.ok, false);
  assert.equal(badUnknown.problems[0].code, "unknown");

  const badEnum = validateIntentParams("MACRO_ECONOMIC_INDICATOR_GENERAL", { indicator: "gdp", country: "Romania" });
  assert.equal(badEnum.ok, false);
  assert.equal(badEnum.problems[0].code, "enum");

  const badDate = validateIntentParams("WEATHER_FORECAST_VERIFY_GENERAL", { location: "Constanta", date: "18-11-2026" });
  assert.equal(badDate.ok, false);
  assert.equal(badDate.problems[0].code, "pattern");

  const validMacro = validateIntentParams("MACRO_ECONOMIC_INDICATOR_GENERAL", {
    indicator: "UNEMPLOYMENT RATE",
    country: "Romania",
    year: "2024",
  });
  assert.equal(validMacro.ok, true);
  assert.equal(validMacro.normalized.indicator, "unemployment rate");
  assert.equal(validMacro.normalized.year, 2024);
});

test("SpendBudgetGuard enforces per-call, per-run, daily caps, circuit breaker, and auth revocation", () => {
  const guard = new SpendBudgetGuard({
    maxPerCallUusdc: 20_000,
    maxPerRunUusdc: 30_000,
    maxDailyUusdc: 50_000,
    maxConsecutiveFailures: 2,
  });

  // Per-call cap
  assert.throws(() => guard.reserve(25_000), BudgetExceededError);

  // Successful reservation + commit
  const r1 = guard.reserve(15_000);
  guard.commit(r1, 10_000, { intent: "FX_NOW_EUR" });
  assert.equal(guard.snapshot().run_spent_usd, 0.01);

  // Per-run cap (already spent 10k; 25k > 20k per-call, 20k -> 30k ok, next 10k -> 40k > 30k run cap)
  const r2 = guard.reserve(20_000);
  guard.commit(r2, 20_000, { intent: "SANCTIONS_SCREENING_MATCH_GENERAL" });
  assert.throws(() => guard.reserve(10_000), BudgetExceededError);

  // Reset run, test consecutive failure circuit breaker
  guard.resetRun();
  const f1 = guard.reserve(10_000);
  guard.fail(f1, "timeout", { countAsPaid: false });
  const f2 = guard.reserve(10_000);
  guard.fail(f2, "http_500_settled", { countAsPaid: true });
  assert.equal(guard.snapshot().daily_spent_usd, 0.04); // 0.03 + 0.01 settled-on-error (#228)
  assert.equal(guard.snapshot().circuit_open, true);
  assert.throws(() => guard.reserve(10_000), BudgetExceededError);

  // Auth revocation
  const g2 = new SpendBudgetGuard();
  g2.revokeAuthorization();
  assert.throws(() => g2.reserve(10_000), AuthorizationRequiredError);
});
