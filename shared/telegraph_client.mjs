/**
 * Telegraph Protocol V2 Client — Multi-Rail Payment, Hard Budget Guard & Receipt Ledger.
 *
 * Supported payment rails (all 100% aligned with anjoman.ai/docs as of 2026-11-23):
 *  1. "escrow"   — Ethereum Sepolia Diamond (0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b)
 *                  EIP-191 personal_sign over exact challenge extra.message -> X-PAYMENT header
 *                  Reads X-PAYMENT-RESPONSE receipt (receipt_hash, epoch_id, amount_uusdc)
 *  2. "api_key"  — Anjoman API Key (Authorization: Bearer anjoman_...) against
 *                  https://backend.telegraphprotocol.com/engine/ask (or /engine/ask/{minerId})
 *                  Supports escrow or x402 Solana paymentMethod.
 *  3. "simulated"— Explicit, strictly labelled SIMULATED_TEST_FIXTURE rail for offline
 *                  reviewers & deterministic failure-mode tests (never confused with live testnet).
 *
 * Defenses against real live Telegraph issues documented in telegraphprotocol/bounties:
 *  - #228: Logs committed/pending authorizations before network return so HTTP 500s cannot bypass caps.
 *  - #232: Checks /v1/ledger/account/{addr} and explains ledger-root activation lag gracefully.
 *  - #233: Detects miner_id === "openai" generic LLM fallback reporting cost_usd: 0 and tracks true floor cost.
 *  - #234: Flags schema-shaped empty verdicts (all payload fields null) as UNVERIFIABLE_EMPTY_PROVIDER.
 */

import { randomUUID } from "node:crypto";
import { personalSign, privateKeyToAddress, sha256Hex } from "./crypto.mjs";
import { TELEGRAPH_NETWORK, validateIntentParams } from "./schemas.mjs";

export class BudgetExceededError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "BudgetExceededError";
    this.details = details;
  }
}

export class AuthorizationRequiredError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "AuthorizationRequiredError";
    this.details = details;
  }
}

/**
 * Atomic, reservation-based spending cap guard.
 * Reserves max_cost BEFORE any payment signature is produced; reconciles on receipt.
 */
export class SpendBudgetGuard {
  constructor({
    maxPerCallUusdc = 50_000, // $0.05 per call default
    maxPerRunUusdc = 120_000, // $0.12 per dossier default
    maxDailyUusdc = 500_000, // $0.50 daily hard ceiling
    maxConsecutiveFailures = 3,
    spendingAuthorized = true,
  } = {}) {
    this.maxPerCallUusdc = maxPerCallUusdc;
    this.maxPerRunUusdc = maxPerRunUusdc;
    this.maxDailyUusdc = maxDailyUusdc;
    this.maxConsecutiveFailures = maxConsecutiveFailures;
    this.spendingAuthorized = spendingAuthorized;

    this.dailySpentUusdc = 0;
    this.dailyReservedUusdc = 0;
    this.runSpentUusdc = 0;
    this.consecutiveFailures = 0;
    this.dayKey = new Date().toISOString().slice(0, 10);
    this.ledger = [];
  }

  _rollDayIfNeeded(now = new Date()) {
    const today = now.toISOString().slice(0, 10);
    if (today !== this.dayKey) {
      this.dayKey = today;
      this.dailySpentUusdc = 0;
      this.dailyReservedUusdc = 0;
    }
  }

  resetRun() {
    this.runSpentUusdc = 0;
  }

  revokeAuthorization() {
    this.spendingAuthorized = false;
  }

  grantAuthorization() {
    this.spendingAuthorized = true;
  }

  snapshot() {
    this._rollDayIfNeeded();
    return {
      day: this.dayKey,
      spending_authorized: this.spendingAuthorized,
      max_per_call_usd: this.maxPerCallUusdc / 1e6,
      max_per_run_usd: this.maxPerRunUusdc / 1e6,
      max_daily_usd: this.maxDailyUusdc / 1e6,
      run_spent_usd: this.runSpentUusdc / 1e6,
      daily_spent_usd: this.dailySpentUusdc / 1e6,
      daily_reserved_usd: this.dailyReservedUusdc / 1e6,
      daily_remaining_usd: Math.max(0, this.maxDailyUusdc - this.dailySpentUusdc - this.dailyReservedUusdc) / 1e6,
      consecutive_failures: this.consecutiveFailures,
      circuit_open: this.consecutiveFailures >= this.maxConsecutiveFailures,
      ledger_count: this.ledger.length,
    };
  }

  reserve(amountUusdc, meta = {}) {
    this._rollDayIfNeeded();
    if (!this.spendingAuthorized) {
      throw new AuthorizationRequiredError("Spending authorization has been revoked by operator", { meta });
    }
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      throw new BudgetExceededError(
        `Circuit breaker open after ${this.consecutiveFailures} consecutive upstream failures`,
        { circuitOpen: true, consecutiveFailures: this.consecutiveFailures }
      );
    }
    const amt = Number(amountUusdc);
    if (!Number.isInteger(amt) || amt <= 0) {
      throw new Error(`Invalid reservation amount_uusdc: ${amountUusdc}`);
    }
    if (amt > this.maxPerCallUusdc) {
      throw new BudgetExceededError(
        `Call quote $${(amt / 1e6).toFixed(4)} exceeds per-call cap $${(this.maxPerCallUusdc / 1e6).toFixed(4)}`,
        { requested_uusdc: amt, cap_uusdc: this.maxPerCallUusdc, scope: "per_call" }
      );
    }
    if (this.runSpentUusdc + amt > this.maxPerRunUusdc) {
      throw new BudgetExceededError(
        `Run spend would reach $${((this.runSpentUusdc + amt) / 1e6).toFixed(4)} > run cap $${(this.maxPerRunUusdc / 1e6).toFixed(4)}`,
        { requested_uusdc: amt, run_spent_uusdc: this.runSpentUusdc, cap_uusdc: this.maxPerRunUusdc, scope: "per_run" }
      );
    }
    if (this.dailySpentUusdc + this.dailyReservedUusdc + amt > this.maxDailyUusdc) {
      throw new BudgetExceededError(
        `Daily spend would exceed hard daily cap $${(this.maxDailyUusdc / 1e6).toFixed(4)}`,
        {
          requested_uusdc: amt,
          daily_spent_uusdc: this.dailySpentUusdc,
          daily_reserved_uusdc: this.dailyReservedUusdc,
          cap_uusdc: this.maxDailyUusdc,
          scope: "daily",
        }
      );
    }
    this.dailyReservedUusdc += amt;
    return { id: randomUUID(), reservedUusdc: amt, meta, createdAt: new Date().toISOString() };
  }

  commit(reservation, actualUusdc, receiptRecord) {
    this.dailyReservedUusdc = Math.max(0, this.dailyReservedUusdc - reservation.reservedUusdc);
    const billed = Number.isFinite(actualUusdc) && actualUusdc >= 0 ? Math.round(actualUusdc) : reservation.reservedUusdc;
    this.dailySpentUusdc += billed;
    this.runSpentUusdc += billed;
    this.consecutiveFailures = 0;
    const entry = {
      id: reservation.id,
      timestamp: new Date().toISOString(),
      status: "settled",
      reserved_uusdc: reservation.reservedUusdc,
      billed_uusdc: billed,
      billed_usd: billed / 1e6,
      ...receiptRecord,
    };
    this.ledger.push(entry);
    return entry;
  }

  /**
   * Handles both uncharged refusals (countAsPaid=false) and settled-on-error cases (#228, countAsPaid=true).
   */
  fail(reservation, reason, { countAsPaid = false, meta = {} } = {}) {
    this.dailyReservedUusdc = Math.max(0, this.dailyReservedUusdc - reservation.reservedUusdc);
    this.consecutiveFailures += 1;
    const billed = countAsPaid ? reservation.reservedUusdc : 0;
    if (countAsPaid) {
      this.dailySpentUusdc += billed;
      this.runSpentUusdc += billed;
    }
    const entry = {
      id: reservation.id,
      timestamp: new Date().toISOString(),
      status: countAsPaid ? "failed_paid_pending_escrow_credit" : "failed_unbilled",
      reserved_uusdc: reservation.reservedUusdc,
      billed_uusdc: billed,
      billed_usd: billed / 1e6,
      reason,
      ...meta,
    };
    this.ledger.push(entry);
    return entry;
  }
}

/**
 * Builds the exact base64-encoded X-PAYMENT header for Telegraph Sepolia Escrow (scheme: "escrow").
 * Follows docs/using/escrow-inference.md verbatim:
 *  - Lowercases `from` before substitution
 *  - Reads `value` from `Amount: <N> uUSDC` in extra.message
 *  - Enforces validity window <= 120s (validAfter = now - 5, validBefore = now + 100)
 *  - Signs template verbatim via EIP-191 personal_sign
 */
export function buildEscrowPaymentHeader(challenge, privateKeyHex, { nowSec = Math.floor(Date.now() / 1000), nonce = randomUUID() } = {}) {
  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
  const escrow = accepts.find((a) => a && a.scheme === "escrow");
  if (!escrow) {
    throw new Error("402 challenge does not offer scheme='escrow'");
  }
  const template = String(escrow?.extra?.message || "");
  const amountMatch = template.match(/Amount:\s*(\d+)\s*uUSDC/);
  if (!amountMatch) {
    throw new Error("Escrow challenge template missing 'Amount: <N> uUSDC' line");
  }
  const value = amountMatch[1];
  const from = privateKeyToAddress(privateKeyHex).toLowerCase();
  const validAfter = String(nowSec - 5);
  const validBefore = String(nowSec + 100); // 105s window < 120s protocol max

  const message = template
    .replace("{from}", from)
    .replace("{nonce}", nonce)
    .replace("{validAfter}", validAfter)
    .replace("{validBefore}", validBefore);

  const signature = personalSign(message, privateKeyHex);
  const authorization = {
    from,
    to: escrow.payTo,
    value,
    validAfter,
    validBefore,
    nonce,
  };
  const envelope = {
    x402Version: 2,
    scheme: "escrow",
    network: escrow.network,
    payload: { signature, authorization },
  };
  return {
    headerValue: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64"),
    amountUusdc: Number(value),
    message,
    authorization,
    network: escrow.network,
    payTo: escrow.payTo,
  };
}

export function decodePaymentResponseHeader(headerValue) {
  if (!headerValue) return null;
  try {
    return JSON.parse(Buffer.from(String(headerValue).trim(), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export class TelegraphClient {
  constructor({
    mode = "auto", // "escrow" | "api_key" | "simulated" | "auto"
    nodeUrl = TELEGRAPH_NETWORK.devnodeBaseUrl,
    anjomanApiUrl = TELEGRAPH_NETWORK.anjomanApiBaseUrl,
    privateKey = process.env.TELEGRAPH_PRIVATE_KEY || "",
    apiKey = process.env.TELEGRAPH_API_KEY || process.env.ANJOMAN_API_KEY || "",
    apiKeyPaymentMethod = "escrow", // "escrow" | "x402"
    apiKeyNetwork = "solana",
    budgetGuard = new SpendBudgetGuard(),
    cacheTtlMs = 5 * 60 * 1000,
    fetchImpl = globalThis.fetch,
    simulator = null,
    timeoutMs = 75_000,
  } = {}) {
    this.nodeUrl = nodeUrl.replace(/\/+$/, "");
    this.anjomanApiUrl = anjomanApiUrl.replace(/\/+$/, "");
    this.privateKey = privateKey;
    this.apiKey = apiKey;
    this.apiKeyPaymentMethod = apiKeyPaymentMethod;
    this.apiKeyNetwork = apiKeyNetwork;
    this.budgetGuard = budgetGuard;
    this.cacheTtlMs = cacheTtlMs;
    this.fetch = fetchImpl;
    this.simulator = simulator;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();

    if (mode === "auto") {
      if (this.privateKey) this.mode = "escrow";
      else if (this.apiKey) this.mode = "api_key";
      else this.mode = "simulated";
    } else {
      this.mode = mode;
    }
  }

  get payerAddress() {
    if (!this.privateKey) return null;
    return privateKeyToAddress(this.privateKey);
  }

  _cacheKey(intent, params, minerId) {
    return sha256Hex(JSON.stringify({ intent, params, minerId: minerId || null }));
  }

  async fetchIntentContract(intentName) {
    const res = await this.fetch(`${this.nodeUrl}/engine/v1/intents/${encodeURIComponent(intentName)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Intent lookup failed: HTTP ${res.status}`);
    return await res.json();
  }

  async fetchEscrowAccount(address = this.payerAddress) {
    if (this.mode === "api_key" && this.apiKey) {
      const res = await this.fetch(`${this.anjomanApiUrl}/engine/escrow/balance`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      return { source: "anjoman_api_key", status: res.status, data: await res.json() };
    }
    if (!address) return { source: "none", status: 0, data: null };
    const res = await this.fetch(`${this.nodeUrl}/v1/ledger/account/${address.toLowerCase()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    return { source: "devnode_ledger", status: res.status, data: await res.json() };
  }

  async verifyEpochDelivery(epochId, receiptHash) {
    const res = await this.fetch(`${this.nodeUrl}/v1/blocks/${encodeURIComponent(epochId)}/deliveries/${encodeURIComponent(receiptHash)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  }

  /**
   * Executes a canonical Telegraph ask with:
   *  - Strict pre-payment schema validation ($0 cost on invalid params)
   *  - Freshness cache reuse ($0 repeat cost for identical facts within TTL)
   *  - Atomic reservation against SpendBudgetGuard
   *  - Defensive detection of #233 (LLM fallback cost_usd=0) and #234 (empty schema-shaped verdicts)
   */
  async askCanonical({
    intent,
    params,
    minerId = null,
    maxBudgetUusdc = 30_000,
    deadlineMs = 25_000,
    bypassCache = false,
  }) {
    const validation = validateIntentParams(intent, params);
    if (!validation.ok) {
      return {
        ok: false,
        stage: "pre_payment_validation",
        cost_usd: 0,
        error: validation.error,
        problems: validation.problems,
        network_mode: this.mode,
      };
    }

    const cacheKey = this._cacheKey(intent, validation.normalized, minerId);
    if (!bypassCache && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.storedAt < this.cacheTtlMs) {
        return {
          ...cached.response,
          cached_reuse: true,
          cost_usd: 0,
          original_cost_usd: cached.response.cost_usd,
          latency_ms: 0,
        };
      }
      this.cache.delete(cacheKey);
    }

    if (this.mode === "simulated") {
      return await this._askSimulated({ intent, params: validation.normalized, minerId, maxBudgetUusdc, cacheKey });
    }
    if (this.mode === "api_key") {
      return await this._askViaApiKey({ intent, params: validation.normalized, minerId, cacheKey });
    }
    return await this._askViaEscrow({ intent, params: validation.normalized, minerId, maxBudgetUusdc, deadlineMs, cacheKey });
  }

  async _askSimulated({ intent, params, minerId, maxBudgetUusdc, cacheKey }) {
    if (!this.simulator) {
      throw new Error("Simulated mode requested without simulator provider");
    }
    const quotedUusdc = Math.min(maxBudgetUusdc || TELEGRAPH_NETWORK.minCallUusdc, TELEGRAPH_NETWORK.minCallUusdc);
    const reservation = this.budgetGuard.reserve(quotedUusdc, { intent, params, rail: "simulated" });
    const started = Date.now();
    const sim = await this.simulator({ intent, params, minerId });
    const latencyMs = sim.latency_ms ?? Math.max(12, Date.now() - started);

    if (!sim.ok) {
      this.budgetGuard.fail(reservation, sim.error || "simulated_upstream_error", {
        countAsPaid: Boolean(sim.settled_despite_error),
        meta: { intent, rail: "simulated", simulated: true },
      });
      return {
        ok: false,
        simulated: true,
        network_mode: "SIMULATED_TEST_FIXTURE",
        intent,
        params,
        error: sim.error || "simulated_upstream_error",
        cost_usd: sim.settled_despite_error ? quotedUusdc / 1e6 : 0,
        latency_ms: latencyMs,
      };
    }

    const billedUusdc = this._reconcileBilledUusdc(sim.answer, quotedUusdc);
    const receipt = {
      receipt_hash: sim.receipt_hash || `0xsim_${sha256Hex(`${intent}:${JSON.stringify(params)}:${Date.now()}`).slice(0, 56)}`,
      rail: "simulated_escrow_fixture",
      payer: "0x0000000000000000000000000000000000000000",
      miner: String(sim.answer.miner_id || minerId || "sim-miner"),
      intent,
      amount_uusdc: String(billedUusdc),
      epoch_id: sim.epoch_id ?? 46,
      settlement: "simulated_fixture",
      chain: "simulated_testnet_fixture",
      timestamp: Math.floor(Date.now() / 1000),
    };
    const ledgerEntry = this.budgetGuard.commit(reservation, billedUusdc, {
      intent,
      miner_id: sim.answer.miner_id,
      signal_hash: sim.answer.signal_hash,
      receipt_hash: receipt.receipt_hash,
      rail: receipt.rail,
      simulated: true,
    });

    const response = {
      ok: true,
      simulated: true,
      network_mode: "SIMULATED_TEST_FIXTURE",
      cached_reuse: false,
      intent,
      params,
      answer: sim.answer,
      receipt,
      ledger_entry: ledgerEntry,
      cost_usd: billedUusdc / 1e6,
      latency_ms: latencyMs,
      warnings: this._inspectAnswerDefects(intent, sim.answer),
    };
    if (response.warnings.length === 0) {
      this.cache.set(cacheKey, { storedAt: Date.now(), response });
    }
    return response;
  }

  async _askViaEscrow({ intent, params, minerId, maxBudgetUusdc, deadlineMs, cacheKey }) {
    if (!this.privateKey) {
      throw new Error("TELEGRAPH_PRIVATE_KEY is required for live Sepolia escrow rail");
    }
    const path = minerId ? `/engine/v1/ask/${encodeURIComponent(minerId)}` : "/engine/v1/ask";
    const url = `${this.nodeUrl}${path}`;
    const reqObj = minerId
      ? { intent, params }
      : {
          intent,
          params,
          max_budget_usdc: Math.max(TELEGRAPH_NETWORK.minCallUusdc, Math.min(maxBudgetUusdc, TELEGRAPH_NETWORK.maxBudgetUusdc)),
          deadline_ms: Math.max(2_000, Math.min(deadlineMs, 60_000)),
        };
    const body = JSON.stringify(reqObj);
    const started = Date.now();

    // Step 1: Probe 402 challenge (free)
    const probeRes = await this.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (probeRes.status !== 402) {
      const errBody = await probeRes.json().catch(() => ({}));
      return {
        ok: false,
        network_mode: "sepolia_escrow",
        status: probeRes.status,
        error: errBody.error || `Expected 402 payment challenge, got HTTP ${probeRes.status}`,
        detail: errBody,
        cost_usd: 0,
        latency_ms: Date.now() - started,
      };
    }

    const challenge = await probeRes.json();
    const built = buildEscrowPaymentHeader(challenge, this.privateKey);
    const reservation = this.budgetGuard.reserve(built.amountUusdc, { intent, params, rail: "escrow" });

    // Step 2: Send EIP-191 signed X-PAYMENT header
    let paidRes;
    try {
      paidRes = await this.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT": built.headerValue,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.budgetGuard.fail(reservation, `network_error: ${err.message}`, {
        countAsPaid: false,
        meta: { intent, rail: "escrow" },
      });
      return {
        ok: false,
        network_mode: "sepolia_escrow",
        error: `Network error after signing: ${err.message}`,
        cost_usd: 0,
        latency_ms: Date.now() - started,
      };
    }

    const paidBody = await paidRes.json().catch(() => ({}));
    const receipt = decodePaymentResponseHeader(paidRes.headers.get("x-payment-response"));

    if (!paidRes.ok) {
      // Per docs & #228/#232: 402 is not charged; 500 might have settled if receipt present
      const countAsPaid = Boolean(receipt && Number(receipt.amount_uusdc) > 0);
      this.budgetGuard.fail(reservation, paidBody.reason || paidBody.error || `HTTP ${paidRes.status}`, {
        countAsPaid,
        meta: { intent, rail: "escrow", status: paidRes.status, receipt },
      });
      return {
        ok: false,
        network_mode: "sepolia_escrow",
        status: paidRes.status,
        error: paidBody.reason || paidBody.error || `HTTP ${paidRes.status}`,
        detail: paidBody,
        receipt,
        cost_usd: countAsPaid ? Number(receipt.amount_uusdc) / 1e6 : 0,
        latency_ms: Date.now() - started,
      };
    }

    const billedUusdc = receipt?.amount_uusdc
      ? Number(receipt.amount_uusdc)
      : this._reconcileBilledUusdc(paidBody, built.amountUusdc);

    const ledgerEntry = this.budgetGuard.commit(reservation, billedUusdc, {
      intent,
      miner_id: paidBody.miner_id,
      miner_name: paidBody.miner_name,
      signal_hash: paidBody.signal_hash,
      receipt_hash: receipt?.receipt_hash || null,
      epoch_id: receipt?.epoch_id ?? null,
      rail: "escrow",
      network: built.network,
    });

    const response = {
      ok: true,
      simulated: false,
      network_mode: "sepolia_escrow",
      cached_reuse: false,
      intent,
      params,
      answer: paidBody,
      receipt,
      ledger_entry: ledgerEntry,
      cost_usd: billedUusdc / 1e6,
      latency_ms: Date.now() - started,
      warnings: this._inspectAnswerDefects(intent, paidBody),
    };
    if (response.warnings.length === 0) {
      this.cache.set(cacheKey, { storedAt: Date.now(), response });
    }
    return response;
  }

  async _askViaApiKey({ intent, params, minerId, cacheKey }) {
    if (!this.apiKey) {
      throw new Error("TELEGRAPH_API_KEY is required for api_key rail");
    }
    const estimatedUusdc = TELEGRAPH_NETWORK.minCallUusdc;
    const reservation = this.budgetGuard.reserve(estimatedUusdc, { intent, params, rail: "api_key" });
    const path = minerId ? `/engine/ask/${encodeURIComponent(minerId)}` : "/engine/ask";
    const url = `${this.anjomanApiUrl}${path}`;
    const payload = {
      intent,
      params,
      paymentMethod: this.apiKeyPaymentMethod,
      ...(this.apiKeyPaymentMethod === "x402" ? { network: this.apiKeyNetwork } : {}),
    };
    const started = Date.now();
    let res;
    try {
      res = await this.fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.budgetGuard.fail(reservation, `network_or_timeout: ${err.message}`, {
        countAsPaid: false,
        meta: { intent, rail: "api_key" },
      });
      return {
        ok: false,
        network_mode: "anjoman_api_key",
        error: `Network/timeout error: ${err.message}`,
        cost_usd: 0,
        latency_ms: Date.now() - started,
      };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.budgetGuard.fail(reservation, data.message || data.error || `HTTP ${res.status}`, {
        countAsPaid: false,
        meta: { intent, rail: "api_key", status: res.status },
      });
      return {
        ok: false,
        network_mode: "anjoman_api_key",
        status: res.status,
        error: data.message || data.error || `HTTP ${res.status}`,
        detail: data,
        cost_usd: 0,
        latency_ms: Date.now() - started,
      };
    }

    const answer = data.result || data;
    const receipt = data.receipt || null;
    const billedUusdc = receipt?.amount_uusdc
      ? Number(receipt.amount_uusdc)
      : this._reconcileBilledUusdc(answer, estimatedUusdc);
    const ledgerEntry = this.budgetGuard.commit(reservation, billedUusdc, {
      intent,
      miner_id: answer.miner_id,
      signal_hash: answer.signal_hash,
      receipt_hash: receipt?.receipt_hash || null,
      epoch_id: receipt?.epoch_id ?? null,
      rail: `anjoman_${this.apiKeyPaymentMethod}`,
    });
    const response = {
      ok: true,
      simulated: false,
      network_mode: "anjoman_api_key",
      cached_reuse: false,
      intent,
      params,
      answer,
      receipt,
      ledger_entry: ledgerEntry,
      cost_usd: billedUusdc / 1e6,
      latency_ms: Date.now() - started,
      warnings: this._inspectAnswerDefects(intent, answer),
    };
    if (response.warnings.length === 0) {
      this.cache.set(cacheKey, { storedAt: Date.now(), response });
    }
    return response;
  }

  /**
   * Reconciles billed uUSDC defensively (#233: LLM fallback miner_id="openai" can report cost_usd: 0
   * even after settling $0.01 on chain — account conservatively using floor price when cost_usd === 0!).
   */
  _reconcileBilledUusdc(answer, fallbackUusdc) {
    const payments = answer?.fulfillment?.payments;
    if (Array.isArray(payments) && payments.length > 0) {
      const sum = payments.reduce((acc, p) => acc + (Number(p.amount_uusdc) || 0), 0);
      if (sum > 0) return sum;
    }
    if (typeof answer?.cost_usd === "number" && answer.cost_usd > 0) {
      return Math.round(answer.cost_usd * 1e6);
    }
    // Issue #233 guard: generic LLM fallback settled payment despite cost_usd: 0
    if (String(answer?.miner_id || "").toLowerCase() === "openai") {
      return fallbackUusdc;
    }
    return fallbackUusdc;
  }

  /**
   * Adversarial post-response checks catching real Telegraph failure modes (#233, #234, raw fallback).
   */
  _inspectAnswerDefects(intent, answer) {
    const warnings = [];
    if (!answer || typeof answer !== "object") {
      warnings.push({ code: "EMPTY_RESPONSE", message: "Provider returned empty response body" });
      return warnings;
    }
    if (String(answer.miner_id || "").toLowerCase() === "openai") {
      warnings.push({
        code: "LLM_FALLBACK_PROVIDER",
        message: "Answered by generic LLM fallback (miner_id='openai'); conservative floor cost accounted (#233).",
      });
    }
    if (answer.result_shape === "raw") {
      warnings.push({
        code: "RAW_UNSHAPED_RESULT",
        message: `Node could not shape answer into ${intent} schema (shape_error=${answer.shape_error || "unknown"}).`,
      });
    }
    const res = answer.result;
    if (res && typeof res === "object" && !Array.isArray(res)) {
      // Issue #234 guard: FACT_CHECK_GENERAL schema-shaped empty verdict
      if (
        intent === "FACT_CHECK_GENERAL" &&
        res.claim === null &&
        res.reasoning === null &&
        (!Array.isArray(res.sources) || res.sources.length === 0)
      ) {
        warnings.push({
          code: "UNVERIFIABLE_EMPTY_PROVIDER",
          message: "FACT_CHECK_GENERAL returned null claim/reasoning/sources (#234); refusing to treat as verified.",
        });
      }
      const values = Object.values(res);
      if (values.length > 0 && values.every((v) => v === null || v === undefined || v === "")) {
        warnings.push({
          code: "ALL_FIELDS_NULL",
          message: "All intent response fields are null/empty.",
        });
      }
    }
    return warnings;
  }
}
