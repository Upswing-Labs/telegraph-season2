/**
 * Track 02 — Upswing SolSignal Telegraph Miner Core Logic.
 *
 * Serves three active canonical Telegraph V2 intents with real live on-chain/exchange data:
 *  1. LIQUIDITY_DEPTH_VERIFY_GENERAL — strict chain-matched DexScreener pair/token depth +
 *     Upswing SolSignal constant-product AMM sell-impact stress tiers ($5k/$25k/$100k).
 *     Directly fixes GitHub Issue #207 (refuses cross-chain hallucinations with HTTP 422!).
 *  2. FRAUD_RISK_GENERAL — wraps live Upswing SolSignal (https://upswing-solsignal.upswing-labs.workers.dev)
 *     for Solana SPL mints + DexScreener microstructure risk scoring for EVM tokens/pools.
 *  3. CRYPTO_PRICE_USD — live keyless median spot price across Coinbase & Kraken.
 */

const SOLSIGNAL_BASE = "https://upswing-solsignal.upswing-labs.workers.dev";
const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex";
const COINBASE_RATES_URL = "https://api.coinbase.com/v2/exchange-rates";
const KRAKEN_TICKER_URL = "https://api.kraken.com/0/public/Ticker";

const BASE58_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SYMBOL_RE = /^[A-Za-z0-9]{2,12}$/;

const CHAIN_ALIASES = Object.freeze({
  ethereum: "ethereum",
  eth: "ethereum",
  "eth-mainnet": "ethereum",
  mainnet: "ethereum",
  solana: "solana",
  sol: "solana",
  bsc: "bsc",
  bnb: "bsc",
  "bnb chain": "bsc",
  "binance smart chain": "bsc",
  base: "base",
  arbitrum: "arbitrum",
  arb: "arbitrum",
  polygon: "polygon",
  matic: "polygon",
  optimism: "optimism",
  op: "optimism",
  avalanche: "avalanche",
  avax: "avalanche",
  sui: "sui",
  ton: "ton",
});

const KRAKEN_PAIR_MAP = Object.freeze({
  BTC: "XBTUSD",
  ETH: "ETHUSD",
  SOL: "SOLUSD",
  USDC: "USDCUSD",
  USDT: "USDTUSD",
  LINK: "LINKUSD",
  ARB: "ARBUSD",
  AVAX: "AVAXUSD",
  DOGE: "XDGUSD",
  ADA: "ADAUSD",
  XRP: "XRPUSD",
  DOT: "DOTUSD",
  UNI: "UNIUSD",
  BONK: "BONKUSD",
  JUP: "JUPUSD",
});

export function normalizeChainId(rawChain) {
  const key = String(rawChain || "").trim().toLowerCase();
  return CHAIN_ALIASES[key] || null;
}

/**
 * Constant-product AMM sell shock (same exact formula as Upswing SolSignal v2.0):
 *   priceDropPct = (1 - (R / (R + Q))^2) * 100
 */
export function computeAmmSellDropPct(totalLiquidityUsd, sellUsd) {
  const r = Number(totalLiquidityUsd) > 0 ? Number(totalLiquidityUsd) / 2 : 0;
  const q = Number(sellUsd) > 0 ? Number(sellUsd) : 0;
  if (q === 0) return 0;
  if (r === 0) return 100;
  const ratio = 1 / (1 + q / r);
  return Math.round((1 - ratio * ratio) * 10_000) / 100;
}

/**
 * Bounded LRU + TTL cache (sub-second responses under repeat traffic).
 */
export class BoundedTtlCache {
  constructor({ maxEntries = 512, defaultTtlMs = 30_000 } = {}) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.map.has(key)) this.map.delete(key);
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

/**
 * Parses Telegraph's Go-map optional query syntax (e.g. "map[pool:0x... chain:ethereum]")
 * discovered in Issue #208, seamlessly merging with normal query params.
 */
export function parseTelegraphQueryParams(searchParams) {
  const out = {};
  for (const [k, v] of searchParams.entries()) {
    out[k] = v;
  }
  if (typeof out.optional === "string" && out.optional.startsWith("map[") && out.optional.endsWith("]")) {
    const inner = out.optional.slice(4, -1).trim();
    const pairRe = /([A-Za-z0-9_]+):([^\s]+(?:\s+(?![A-Za-z0-9_]+:)[^\s]+)*)/g;
    let m;
    while ((m = pairRe.exec(inner)) !== null) {
      if (!out[m[1]]) out[m[1]] = m[2].trim();
    }
  }
  return out;
}

async function fetchJson(url, fetchImpl, timeoutMs = 4_500) {
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": "UpswingSolSignalMiner/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, data: null };
  }
  const data = await res.json();
  return { ok: true, status: res.status, data };
}

export class SolSignalMinerService {
  constructor({
    fetchImpl = globalThis.fetch,
    solsignalBaseUrl = SOLSIGNAL_BASE,
    cache = new BoundedTtlCache(),
    timeoutMs = 4_500,
  } = {}) {
    this.fetch = fetchImpl;
    this.solsignalBaseUrl = solsignalBaseUrl.replace(/\/+$/, "");
    this.cache = cache;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Intent 1: LIQUIDITY_DEPTH_VERIFY_GENERAL (params: { pool, chain })
   * Strictly verifies that the returned pool belongs to the EXACT requested chain & address.
   */
  async verifyLiquidityDepth({ pool, chain }) {
    const cleanPool = String(pool || "").trim();
    const normChain = normalizeChainId(chain);
    if (!cleanPool || cleanPool.length > 128) {
      return {
        status: 422,
        body: { error: "invalid_pool", message: "pool parameter is required (1-128 chars)." },
      };
    }
    if (!normChain) {
      return {
        status: 422,
        body: {
          error: "unsupported_chain",
          message: `Unsupported chain "${chain}". Supported: ${Object.keys(CHAIN_ALIASES).slice(0, 12).join(", ")}.`,
        },
      };
    }

    const cacheKey = `liq:${normChain}:${cleanPool.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return { status: 200, body: { ...cached, cached: true } };

    // 1. Try exact pair lookup on the requested chain first
    let pairRes;
    try {
      pairRes = await fetchJson(
        `${DEXSCREENER_BASE}/pairs/${encodeURIComponent(normChain)}/${encodeURIComponent(cleanPool)}`,
        this.fetch,
        this.timeoutMs
      );
    } catch (err) {
      return { status: 502, body: { error: "upstream_unavailable", message: `DexScreener lookup failed: ${err.message}` } };
    }

    let matchedPairs = [];
    if (pairRes.ok && Array.isArray(pairRes.data?.pairs) && pairRes.data.pairs.length > 0) {
      matchedPairs = pairRes.data.pairs.filter((p) => String(p?.chainId || "").toLowerCase() === normChain);
    }

    // 2. If not found as a pair address, try token address lookup and STRICTLY filter to requested chain
    let otherChainPools = [];
    if (matchedPairs.length === 0) {
      let tokRes;
      try {
        tokRes = await fetchJson(
          `${DEXSCREENER_BASE}/tokens/${encodeURIComponent(cleanPool)}`,
          this.fetch,
          this.timeoutMs
        );
      } catch (err) {
        return { status: 502, body: { error: "upstream_unavailable", message: `DexScreener token lookup failed: ${err.message}` } };
      }
      if (!tokRes.ok) {
        return { status: 502, body: { error: "upstream_error", message: `DexScreener returned HTTP ${tokRes.status}` } };
      }
      const allPairs = Array.isArray(tokRes.data?.pairs) ? tokRes.data.pairs : [];
      matchedPairs = allPairs.filter((p) => String(p?.chainId || "").toLowerCase() === normChain);
      otherChainPools = allPairs.filter((p) => String(p?.chainId || "").toLowerCase() !== normChain);
    }

    // CRITICAL FIX FOR #207: Never return a BNB/other-chain pool when Ethereum (or another chain) was requested!
    if (matchedPairs.length === 0) {
      if (otherChainPools.length > 0) {
        const otherChains = [...new Set(otherChainPools.map((p) => p.chainId))];
        return {
          status: 422,
          body: {
            error: "chain_mismatch",
            pool: cleanPool,
            requested_chain: normChain,
            observed_chains: otherChains,
            message: `No active pool found on ${normChain} for ${cleanPool} (address exists only on: ${otherChains.join(", ")}). Refusing cross-chain substitution.`,
          },
        };
      }
      return {
        status: 422,
        body: {
          error: "pool_not_found",
          pool: cleanPool,
          chain: normChain,
          message: `No indexed DEX liquidity pool found on ${normChain} for ${cleanPool}.`,
        },
      };
    }

    matchedPairs.sort((a, b) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0));
    const primary = matchedPairs[0];
    const liquidityUsd = Math.round((Number(primary?.liquidity?.usd) || 0) * 100) / 100;
    const totalChainLiquidityUsd =
      Math.round(matchedPairs.reduce((acc, p) => acc + (Number(p?.liquidity?.usd) || 0), 0) * 100) / 100;

    // For Solana, optionally enrich with live Upswing SolSignal verdict (best-effort, non-blocking)
    let solsignalRisk = null;
    if (normChain === "solana" && primary?.baseToken?.address && BASE58_MINT_RE.test(primary.baseToken.address)) {
      try {
        const ss = await fetchJson(
          `${this.solsignalBaseUrl}/api/v1/free/signal?mint=${encodeURIComponent(primary.baseToken.address)}`,
          this.fetch,
          2_500
        );
        if (ss.ok && ss.data?.safety) {
          solsignalRisk = {
            rug_risk_score: ss.data.safety.rugRiskScore,
            verdict: ss.data.safety.verdict,
          };
        }
      } catch {
        // Non-fatal enrichment
      }
    }

    const pairLabel = `${primary?.baseToken?.symbol || "?"}/${primary?.quoteToken?.symbol || "?"}`;
    const body = {
      intent: "LIQUIDITY_DEPTH_VERIFY_GENERAL",
      pool: primary.pairAddress || cleanPool,
      pool_name: `${primary.dexId || "dex"} ${pairLabel}`,
      chain: normChain,
      dex: primary.dexId || null,
      liquidity_usd: liquidityUsd,
      aggregate_chain_liquidity_usd: totalChainLiquidityUsd,
      pool_count_on_chain: matchedPairs.length,
      base_token: primary.baseToken || null,
      quote_token: primary.quoteToken || null,
      price_usd: primary.priceUsd ? Number(primary.priceUsd) : null,
      volume_24h_usd: Number(primary?.volume?.h24) || 0,
      amm_dump_stress_pct: {
        sell_5k: computeAmmSellDropPct(liquidityUsd, 5_000),
        sell_25k: computeAmmSellDropPct(liquidityUsd, 25_000),
        sell_100k: computeAmmSellDropPct(liquidityUsd, 100_000),
      },
      solsignal_enrichment: solsignalRisk,
      verdict_label: liquidityUsd >= 100_000 ? "DEEP_LIQUIDITY" : liquidityUsd >= 10_000 ? "MODERATE_LIQUIDITY" : "THIN_OR_EMPTY_POOL",
      confidence: liquidityUsd > 0 ? 0.96 : 0.9,
      summary: `Verified ${primary.dexId || "DEX"} ${pairLabel} pool (${primary.pairAddress || cleanPool}) on ${normChain}: $${liquidityUsd.toLocaleString("en-US")} USD pool liquidity (5k/25k/100k constant-product sell shock: -${computeAmmSellDropPct(liquidityUsd, 5_000)}% / -${computeAmmSellDropPct(liquidityUsd, 25_000)}% / -${computeAmmSellDropPct(liquidityUsd, 100_000)}%).`,
      observed_at: new Date().toISOString(),
      source: "dexscreener_live_chain_verified",
      cached: false,
    };

    this.cache.set(cacheKey, body, 45_000);
    return { status: 200, body };
  }

  /**
   * Intent 2: FRAUD_RISK_GENERAL (params: { subject })
   * Powered by live Upswing SolSignal (Solana SPL) and DexScreener microstructure (EVM).
   */
  async assessFraudRisk({ subject }) {
    const clean = String(subject || "").trim();
    if (!clean || clean.length > 256) {
      return { status: 422, body: { error: "invalid_subject", message: "subject is required (1-256 chars)." } };
    }

    const isSolana = BASE58_MINT_RE.test(clean);
    const isEvm = EVM_ADDR_RE.test(clean);
    if (!isSolana && !isEvm) {
      return {
        status: 422,
        body: {
          error: "unsupported_subject",
          subject: clean,
          message: "Upswing SolSignal Fraud Risk supports Solana SPL mint addresses (Base58) and EVM 0x token/pool addresses. Refusing unsupported free-text subject.",
        },
      };
    }

    const cacheKey = `risk:${clean}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return { status: 200, body: { ...cached, cached: true } };

    if (isSolana) {
      let ssRes;
      try {
        ssRes = await fetchJson(
          `${this.solsignalBaseUrl}/api/v1/free/signal?mint=${encodeURIComponent(clean)}`,
          this.fetch,
          this.timeoutMs
        );
      } catch (err) {
        return { status: 502, body: { error: "upstream_unavailable", message: `Upswing SolSignal unreachable: ${err.message}` } };
      }
      if (!ssRes.ok || !ssRes.data?.safety) {
        return { status: 502, body: { error: "upstream_error", message: `Upswing SolSignal returned HTTP ${ssRes.status}` } };
      }

      const d = ssRes.data;
      const score100 = Number(d.safety.rugRiskScore) || 0;
      const riskScore = Math.round((Math.max(0, Math.min(100, score100)) / 100) * 1e6) / 1e6;
      const verdictMap = {
        LOW_RISK: "LOW",
        CAUTION: "MEDIUM",
        HIGH_RISK: "HIGH",
        HONEYPOT_ALERT: "CRITICAL",
      };
      const riskLevel = verdictMap[d.safety.verdict] || (score100 >= 80 ? "CRITICAL" : score100 >= 55 ? "HIGH" : score100 >= 25 ? "MEDIUM" : "LOW");
      const signals = (d.safety.riskFlags || []).slice(0, 8).map((f) => `${f.code}: ${f.label}`);
      if (d.ammDumpStress?.headline) signals.push(d.ammDumpStress.headline);

      const sym = d.token?.symbol || clean.slice(0, 8);
      const liq = Number(d.market?.liquidityUsd) || 0;
      const body = {
        intent: "FRAUD_RISK_GENERAL",
        subject: clean,
        chain: "solana",
        risk_level: riskLevel,
        risk_score: riskScore,
        signals: signals.length > 0 ? signals : ["NO_CRITICAL_RUGCHECK_OR_LIQUIDITY_FLAGS"],
        verdict_label: riskLevel,
        confidence: d.degraded ? 0.65 : 0.94,
        summary: `Solana SPL ${sym} (${clean}) assessed at ${riskLevel} fraud/rug risk (${score100}/100) across $${liq.toLocaleString("en-US")} aggregate DEX liquidity via Upswing SolSignal (DexScreener + RugCheck + constant-product AMM stress-test).`,
        solsignal_version: d.schemaVersion || "2.0",
        observed_at: d.generatedAt || new Date().toISOString(),
        source: "upswing_solsignal_live",
        cached: false,
      };
      this.cache.set(cacheKey, body, 60_000);
      return { status: 200, body };
    }

    // EVM address microstructure risk assessment via DexScreener
    let dexRes;
    try {
      dexRes = await fetchJson(`${DEXSCREENER_BASE}/tokens/${encodeURIComponent(clean)}`, this.fetch, this.timeoutMs);
    } catch (err) {
      return { status: 502, body: { error: "upstream_unavailable", message: `DexScreener unavailable: ${err.message}` } };
    }
    if (!dexRes.ok) {
      return { status: 502, body: { error: "upstream_error", message: `DexScreener returned HTTP ${dexRes.status}` } };
    }
    const pairs = Array.isArray(dexRes.data?.pairs) ? dexRes.data.pairs : [];
    if (pairs.length === 0) {
      return {
        status: 422,
        body: {
          error: "address_not_indexed",
          subject: clean,
          message: `No active DEX market telemetry found for EVM address ${clean}.`,
        },
      };
    }

    pairs.sort((a, b) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0));
    const top = pairs[0];
    const totalLiq = pairs.reduce((acc, p) => acc + (Number(p?.liquidity?.usd) || 0), 0);
    const fdv = Number(top?.fdv) || null;
    const fdvRatio = fdv && totalLiq > 0 ? fdv / totalLiq : null;
    const sell25k = computeAmmSellDropPct(totalLiq, 25_000);

    let pts = 10;
    const signals = [];
    if (totalLiq < 1_000) {
      pts += 75;
      signals.push(`CRITICAL_MICRO_LIQUIDITY: Total DEX depth $${Math.round(totalLiq)}`);
    } else if (totalLiq < 10_000) {
      pts += 50;
      signals.push(`LOW_LIQUIDITY: Total DEX depth $${Math.round(totalLiq)}`);
    } else if (totalLiq < 50_000) {
      pts += 25;
      signals.push(`THIN_LIQUIDITY: Total DEX depth $${Math.round(totalLiq)}`);
    } else {
      signals.push(`VERIFIED_DEX_DEPTH: $${Math.round(totalLiq).toLocaleString("en-US")} across ${pairs.length} pool(s)`);
    }

    if (fdvRatio !== null && fdvRatio > 100 && totalLiq < 500_000) {
      pts += 25;
      signals.push(`EXTREME_FDV_LIQUIDITY_DISTORTION: ${Math.round(fdvRatio)}x FDV/liquidity`);
    }
    if (sell25k >= 50) {
      pts += 15;
      signals.push(`HIGH_AMM_DUMP_IMPACT: -$25k sell causes -${sell25k}% price impact`);
    }

    const bounded = Math.min(100, pts);
    const riskScore = Math.round((bounded / 100) * 1e6) / 1e6;
    const riskLevel = bounded >= 80 ? "CRITICAL" : bounded >= 55 ? "HIGH" : bounded >= 25 ? "MEDIUM" : "LOW";
    const sym = top?.baseToken?.symbol || clean.slice(0, 10);

    const body = {
      intent: "FRAUD_RISK_GENERAL",
      subject: clean,
      chain: top.chainId || "evm",
      risk_level: riskLevel,
      risk_score: riskScore,
      signals,
      verdict_label: riskLevel,
      confidence: 0.88,
      summary: `EVM token ${sym} (${clean} on ${top.chainId}) scored ${riskLevel} (${bounded}/100) with $${Math.round(totalLiq).toLocaleString("en-US")} aggregate DEX liquidity and -${sell25k}% $25k constant-product sell shock.`,
      observed_at: new Date().toISOString(),
      source: "dexscreener_evm_microstructure",
      cached: false,
    };
    this.cache.set(cacheKey, body, 60_000);
    return { status: 200, body };
  }

  /**
   * Intent 3: CRYPTO_PRICE_USD (Deterministic! params: { symbol })
   * Aggregates public keyless Coinbase + Kraken USD spot prices and returns the median.
   */
  async getCryptoPriceUsd({ symbol }) {
    const clean = String(symbol || "").trim().toUpperCase();
    if (!SYMBOL_RE.test(clean)) {
      return { status: 422, body: { error: "invalid_symbol", message: `Invalid asset symbol "${symbol}".` } };
    }

    const cacheKey = `px:${clean}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return { status: 200, body: { ...cached, cached: true } };

    const quotes = [];
    const sourcesUsed = [];

    // Feed 1: Coinbase public exchange rates
    try {
      const cb = await fetchJson(`${COINBASE_RATES_URL}?currency=${encodeURIComponent(clean)}`, this.fetch, this.timeoutMs);
      const usdStr = cb.ok ? cb.data?.data?.rates?.USD : null;
      const usd = Number(usdStr);
      if (Number.isFinite(usd) && usd > 0) {
        quotes.push(usd);
        sourcesUsed.push({ source: "coinbase", price_usd: usd });
      }
    } catch {
      // Fallback to second feed
    }

    // Feed 2: Kraken public ticker
    const krakenPair = KRAKEN_PAIR_MAP[clean];
    if (krakenPair) {
      try {
        const kr = await fetchJson(`${KRAKEN_TICKER_URL}?pair=${encodeURIComponent(krakenPair)}`, this.fetch, this.timeoutMs);
        const resultObj = kr.ok && kr.data?.result ? kr.data.result : null;
        const firstKey = resultObj ? Object.keys(resultObj)[0] : null;
        const lastTrade = firstKey ? Number(resultObj[firstKey]?.c?.[0]) : NaN;
        if (Number.isFinite(lastTrade) && lastTrade > 0) {
          quotes.push(lastTrade);
          sourcesUsed.push({ source: "kraken", price_usd: lastTrade });
        }
      } catch {
        // Non-fatal
      }
    }

    if (quotes.length === 0) {
      return {
        status: 422,
        body: { error: "symbol_not_quoted", symbol: clean, message: `No live USD spot quote available for ${clean}.` },
      };
    }

    quotes.sort((a, b) => a - b);
    const mid = Math.floor(quotes.length / 2);
    const medianPrice = quotes.length % 2 === 1 ? quotes[mid] : (quotes[mid - 1] + quotes[mid]) / 2;
    const rounded = Number(medianPrice.toPrecision(8));

    const body = {
      intent: "CRYPTO_PRICE_USD",
      symbol: clean,
      price_usd: rounded,
      unit: "US dollars",
      quotes: sourcesUsed,
      verdict_label: `${clean}_USD`,
      confidence: sourcesUsed.length >= 2 ? 0.99 : 0.92,
      summary: `${clean}/USD median spot price is $${rounded} across ${sourcesUsed.map((s) => s.source).join(" + ")}.`,
      observed_at: new Date().toISOString(),
      cached: false,
    };
    this.cache.set(cacheKey, body, 30_000);
    return { status: 200, body };
  }
}
