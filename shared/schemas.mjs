/**
 * Live-verified Telegraph Protocol V2 Constants & Canonical Intent Schemas.
 * Snapshot verified against https://devnode.telegraphprotocol.com/engine/v1/intents/<INTENT>
 * on 2026-11-23 (Sepolia Diamond 0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b, epoch 46).
 */

export const TELEGRAPH_NETWORK = Object.freeze({
  chainName: "Ethereum Sepolia",
  chainId: 11155111,
  caip2: "eip155:11155111",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  diamond: "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b",
  testUsdc: "0xcc194e1a843B658526D0D5C431f670028582Ae17",
  devnodeBaseUrl: "https://devnode.telegraphprotocol.com",
  anjomanApiBaseUrl: "https://backend.telegraphprotocol.com",
  minCallUusdc: 10_000, // $0.01
  maxBudgetUusdc: 260_000, // $0.26 on devnode
  escrowWindowMaxSec: 120,
  foundationVersion: "modernbert-base-lora16-v1",
  foundationHash: "0a49b325304bb4cf292e683929689d0457966be264f60bfc94d0072b614bf8e6",
  tokenizerHash: "67bc76f8b9386efba1a761c1c8e5ad439fd0eaf1c2826e9dd1a205c7af4dc456",
});

/**
 * Exact canonical request & response schemas for every Intent used across Tracks 1, 2, and 3.
 */
export const CANONICAL_INTENT_SCHEMAS = Object.freeze({
  SANCTIONS_SCREENING_MATCH_GENERAL: {
    intent_name: "SANCTIONS_SCREENING_MATCH_GENERAL",
    class: "judgment",
    family: "SANCTIONS_SCREENING_MATCH",
    request: {
      schema_version: 3,
      params: [{ name: "name", type: "string", required: true, description: "Person or entity name" }],
    },
    response: {
      format_version: 3,
      fields: ["name", "matched", "matches", "lists", "match_score"],
    },
  },
  MACRO_ECONOMIC_INDICATOR_GENERAL: {
    intent_name: "MACRO_ECONOMIC_INDICATOR_GENERAL",
    class: "judgment",
    family: "MACRO_ECONOMIC_INDICATOR",
    request: {
      schema_version: 5,
      params: [
        {
          name: "indicator",
          type: "enum",
          required: true,
          allowed: ["unemployment rate"],
          description: "The indicator: unemployment rate, % of the total labour force (World Bank SL.UEM.TOTL.ZS)",
        },
        { name: "country", type: "string", required: true, description: "Country" },
        { name: "year", type: "integer", required: false, min: 1960, max: 2100, description: "Year; absent for the latest" },
      ],
    },
    response: {
      format_version: 5,
      fields: ["rate_pct"],
    },
  },
  LIVE_PORT_CONGESTION_GENERAL: {
    intent_name: "LIVE_PORT_CONGESTION_GENERAL",
    class: "judgment",
    family: "LIVE_PORT_CONGESTION",
    request: {
      schema_version: 3,
      params: [{ name: "port", type: "string", required: true, description: "Port name or code" }],
    },
    response: {
      format_version: 3,
      fields: ["port", "vessels_waiting", "wait_hours", "congestion_level", "as_of"],
      enums: { congestion_level: ["low", "moderate", "high", "severe"] },
    },
  },
  VESSEL_TELEMETRY_VERIFY_GENERAL: {
    intent_name: "VESSEL_TELEMETRY_VERIFY_GENERAL",
    class: "judgment",
    family: "VESSEL_TELEMETRY_VERIFY",
    request: {
      schema_version: 3,
      params: [{ name: "vessel", type: "string", required: true, description: "Vessel name, MMSI or IMO" }],
    },
    response: {
      format_version: 3,
      fields: ["vessel", "speed_knots", "latitude", "longitude", "course_deg", "observed_at"],
    },
  },
  WEATHER_FORECAST_VERIFY_GENERAL: {
    intent_name: "WEATHER_FORECAST_VERIFY_GENERAL",
    class: "judgment",
    family: "WEATHER_FORECAST_VERIFY",
    request: {
      schema_version: 3,
      params: [
        { name: "location", type: "string", required: true, description: "City or place name" },
        { name: "date", type: "date", required: true, description: "Past date to verify (YYYY-MM-DD)" },
      ],
    },
    response: {
      format_version: 3,
      fields: ["location", "date", "temp_max_c", "temp_min_c", "precipitation_mm", "condition"],
    },
  },
  FACT_CHECK_GENERAL: {
    intent_name: "FACT_CHECK_GENERAL",
    class: "judgment",
    family: "FACT_CHECK",
    request: {
      schema_version: 3,
      params: [{ name: "claim", type: "string", required: true, description: "The claim to check" }],
    },
    response: {
      format_version: 3,
      fields: ["claim", "verdict", "reasoning", "sources"],
      enums: { verdict: ["True", "Mostly True", "Mixed", "Misleading", "Mostly False", "False", "Unverified"] },
    },
  },
  WEB_SEARCH_GENERAL: {
    intent_name: "WEB_SEARCH_GENERAL",
    class: "judgment",
    family: "WEB_SEARCH",
    request: {
      schema_version: 3,
      params: [{ name: "query", type: "string", required: true, description: "What to search for" }],
    },
    response: {
      format_version: 3,
      fields: ["answer", "sources", "brief"],
    },
  },
  MEDIA_FORENSIC_VERIFY_GENERAL: {
    intent_name: "MEDIA_FORENSIC_VERIFY_GENERAL",
    class: "judgment",
    family: "MEDIA_FORENSIC_VERIFY",
    request: {
      schema_version: 3,
      params: [{ name: "media_url", type: "string", required: true, description: "URL of the media" }],
    },
    response: {
      format_version: 3,
      fields: ["verdict", "findings", "confidence", "summary"],
      enums: { verdict: ["Authentic", "Likely authentic", "Manipulated", "Likely manipulated", "Inconclusive"] },
    },
  },
  FX_NOW_EUR: {
    intent_name: "FX_NOW_EUR",
    class: "deterministic",
    family: "FX_NOW",
    request: {
      schema_version: 3,
      params: [{ name: "currency", type: "string", required: true, description: "Currency code priced against USD, e.g. EUR" }],
    },
    response: {
      format_version: 1,
      fields: ["rate"],
    },
  },
  LIQUIDITY_DEPTH_VERIFY_GENERAL: {
    intent_name: "LIQUIDITY_DEPTH_VERIFY_GENERAL",
    class: "judgment",
    family: "LIQUIDITY_DEPTH_VERIFY",
    request: {
      schema_version: 3,
      params: [
        { name: "pool", type: "string", required: true, description: "DEX pool address or name" },
        { name: "chain", type: "string", required: true, description: "Chain of the pool" },
      ],
    },
    response: {
      format_version: 3,
      fields: ["liquidity_usd"],
    },
  },
  FRAUD_RISK_GENERAL: {
    intent_name: "FRAUD_RISK_GENERAL",
    class: "judgment",
    family: "FRAUD_RISK",
    request: {
      schema_version: 3,
      params: [{ name: "subject", type: "string", required: true, description: "Entity, payment or account to assess" }],
    },
    response: {
      format_version: 3,
      fields: ["risk_level", "risk_score", "signals", "summary"],
      enums: { risk_level: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
    },
  },
  CRYPTO_PRICE_USD: {
    intent_name: "CRYPTO_PRICE_USD",
    class: "deterministic",
    family: "CRYPTO_PRICE",
    request: {
      schema_version: 3,
      params: [{ name: "symbol", type: "string", required: true, description: "Asset symbol, e.g. BTC" }],
    },
    response: {
      format_version: 1,
      fields: ["price_usd"],
    },
  },
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Deterministic client-side validator mirroring Telegraph Engine's pre-payment check.
 * Rejects unknown params, missing required params, wrong types, enum mismatches,
 * range errors, and size limits (>16 KiB JSON or >2000-char strings) BEFORE spending any USDC.
 */
export function validateIntentParams(intentName, params, customSchema = null) {
  const schema = customSchema || CANONICAL_INTENT_SCHEMAS[intentName];
  if (!schema || !schema.request || !Array.isArray(schema.request.params)) {
    return {
      ok: false,
      error: "no_input_schema",
      problems: [{ param: "", code: "unknown", message: `Unknown or schema-less intent "${intentName}"` }],
    };
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {
      ok: false,
      error: "invalid_params",
      problems: [{ param: "", code: "type", message: "params must be a JSON object" }],
    };
  }
  const encodedSize = Buffer.byteLength(JSON.stringify(params), "utf8");
  if (encodedSize > 16 * 1024) {
    return {
      ok: false,
      error: "invalid_params",
      problems: [{ param: "", code: "size", message: `params JSON size ${encodedSize} exceeds 16 KiB limit` }],
    };
  }

  const problems = [];
  const normalized = {};
  const paramSpecs = new Map(schema.request.params.map((p) => [p.name, p]));

  for (const key of Object.keys(params)) {
    if (!paramSpecs.has(key)) {
      problems.push({
        param: key,
        code: "unknown",
        message: `unknown param "${key}"; ${intentName} takes: ${[...paramSpecs.keys()].join(", ")}`,
      });
    }
  }

  for (const spec of schema.request.params) {
    const raw = params[spec.name];
    const isMissing = raw === undefined || raw === null || raw === "";
    if (isMissing) {
      if (spec.required) {
        problems.push({ param: spec.name, code: "missing", message: `${spec.name} is required (${spec.type})` });
      }
      continue;
    }

    if (spec.type === "string") {
      if (typeof raw !== "string") {
        problems.push({ param: spec.name, code: "type", message: `${spec.name} must be string` });
        continue;
      }
      if (raw.length > 2000) {
        problems.push({ param: spec.name, code: "size", message: `${spec.name} exceeds 2000 characters` });
        continue;
      }
      normalized[spec.name] = raw.trim();
    } else if (spec.type === "enum") {
      const str = String(raw).trim();
      const match = (spec.allowed || []).find((a) => a.toLowerCase() === str.toLowerCase());
      if (!match) {
        problems.push({
          param: spec.name,
          code: "enum",
          message: `${spec.name} must be one of: ${(spec.allowed || []).join(", ")}`,
        });
        continue;
      }
      normalized[spec.name] = match;
    } else if (spec.type === "integer") {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
      if (!Number.isInteger(n)) {
        problems.push({ param: spec.name, code: "type", message: `${spec.name} must be an integer` });
        continue;
      }
      if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) {
        problems.push({ param: spec.name, code: "range", message: `${spec.name} out of range [${spec.min}, ${spec.max}]` });
        continue;
      }
      normalized[spec.name] = n;
    } else if (spec.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        problems.push({ param: spec.name, code: "type", message: `${spec.name} must be a finite number` });
        continue;
      }
      if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) {
        problems.push({ param: spec.name, code: "range", message: `${spec.name} out of range [${spec.min}, ${spec.max}]` });
        continue;
      }
      normalized[spec.name] = n;
    } else if (spec.type === "date") {
      const s = String(raw).trim();
      if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s + "T00:00:00Z"))) {
        problems.push({ param: spec.name, code: "pattern", message: `${spec.name} must be YYYY-MM-DD` });
        continue;
      }
      normalized[spec.name] = s;
    } else {
      normalized[spec.name] = raw;
    }
  }

  return problems.length === 0
    ? { ok: true, normalized }
    : { ok: false, error: "invalid_params", problems };
}
