#!/usr/bin/env node
/**
 * Track 02 — Local Telegraph V2 Miner YAML Validator & Registration Helper.
 *
 * Enforces every exact Stage-1 schema & Request-Contract rule documented in:
 *   https://anjoman.ai/docs/miners/yaml-config
 *   https://anjoman.ai/docs/miners/validation-api
 *   https://anjoman.ai/docs/miners/miner-registration
 *
 * Zero external dependencies: includes a deterministic YAML subset parser covering
 * all Telegraph Miner YAML constructs, computes the exact SHA-256 commitment hash,
 * and prints ready-to-run Foundry `cast call` (dry run) and `cast send` commands.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "../shared/crypto.mjs";
import { CANONICAL_INTENT_SCHEMAS, TELEGRAPH_NETWORK } from "../shared/schemas.mjs";

const ALLOWED_ROOT_KEYS = new Set([
  "version", "kind", "id", "slug", "protocol", "name", "description", "base_url",
  "input_schema", "output_schema", "intent_mapping", "polling", "cache_ttl_sec",
  "rate_limit_per_sec", "circuit_threshold", "circuit_cooldown_seconds",
  "docs", "limitations", "errors", "auth", "endpoints", "semantics", "on_chain",
]);

const REQUIRED_ROOT_KEYS = ["version", "kind", "id", "slug", "name", "base_url"];

const ALLOWED_ENDPOINT_KEYS = new Set([
  "path", "external_path", "method", "description", "intents",
  "params", "endpoint_base_url", "content_type", "multipart_fields", "param_map",
]);

const ALLOWED_AUTH_KEYS = new Set(["type", "env_var", "header_name", "value_prefix", "inject"]);
const ALLOWED_SIGNAL_MAPPING_KEYS = new Set(["confidence_field", "label_field", "reason_field"]);
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Known family prefixes (refused if listed instead of canonical intents!)
const KNOWN_PREFIXES = new Set([
  "FX_NOW", "CRYPTO_PRICE", "WEATHER_CHECK", "WEATHER_FORECAST", "STOCK_PRICE",
  "LIQUIDITY_DEPTH_VERIFY", "FRAUD_RISK", "FRAUD_DETECTION", "SANCTIONS_SCREENING_MATCH",
  "VESSEL_TELEMETRY_VERIFY", "LIVE_PORT_CONGESTION", "MACRO_ECONOMIC_INDICATOR",
  "FACT_CHECK", "WEB_SEARCH", "MEDIA_FORENSIC_VERIFY", "URL_SCAN", "URL_SAFE",
  "TOKEN_HOLDER_COUNT", "TOKEN_TOTAL_SUPPLY_VERIFY", "SECURITY_REVIEW", "CODE_REVIEW",
]);

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => parseScalar(x));
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return {};
    const obj = {};
    for (const part of inner.split(",")) {
      const idx = part.indexOf(":");
      if (idx > 0) {
        obj[part.slice(0, idx).trim()] = parseScalar(part.slice(idx + 1));
      }
    }
    return obj;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

/**
 * Clean, deterministic YAML parser for Telegraph Miner YAML documents.
 */
export function parseSimpleYaml(text) {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const cleaned = stripInlineComment(rawLines[i]);
    if (!cleaned.trim()) continue;
    const indent = cleaned.length - cleaned.trimStart().length;
    lines.push({ indent, content: cleaned.trim(), lineNo: i + 1 });
  }

  let idx = 0;
  function parseBlock(minIndent) {
    if (idx >= lines.length || lines[idx].indent < minIndent) return null;
    const isArray = lines[idx].content.startsWith("- ") || lines[idx].content === "-";
    if (isArray) {
      const arr = [];
      const arrIndent = lines[idx].indent;
      while (idx < lines.length && lines[idx].indent === arrIndent && (lines[idx].content.startsWith("- ") || lines[idx].content === "-")) {
        const rest = lines[idx].content.slice(1).trim();
        idx++;
        if (!rest) {
          arr.push(parseBlock(arrIndent + 1));
        } else if (rest.includes(":") && !rest.startsWith('"') && !rest.startsWith("'") && !rest.startsWith("[")) {
          // Inline object item inside list
          const colon = rest.indexOf(":");
          const k = rest.slice(0, colon).trim();
          const vRaw = rest.slice(colon + 1).trim();
          const obj = {};
          const itemMinIndent = arrIndent + 2;
          if (vRaw) {
            obj[k] = parseScalar(vRaw);
          } else {
            obj[k] = parseBlock(itemMinIndent + 1);
          }
          while (idx < lines.length && lines[idx].indent >= itemMinIndent) {
            if (lines[idx].indent === itemMinIndent && lines[idx].content.startsWith("- ")) break;
            const cur = lines[idx];
            const c = cur.content.indexOf(":");
            if (c < 0) break;
            const key = cur.content.slice(0, c).trim();
            const valStr = cur.content.slice(c + 1).trim();
            idx++;
            if (valStr) obj[key] = parseScalar(valStr);
            else obj[key] = parseBlock(cur.indent + 1);
          }
          arr.push(obj);
        } else {
          arr.push(parseScalar(rest));
        }
      }
      return arr;
    }

    const obj = {};
    const objIndent = lines[idx].indent;
    while (idx < lines.length && lines[idx].indent === objIndent) {
      const cur = lines[idx];
      if (cur.content.startsWith("- ")) break;
      const c = cur.content.indexOf(":");
      if (c < 0) throw new Error(`YAML syntax error on line ${cur.lineNo}: expected key: value`);
      const key = cur.content.slice(0, c).trim();
      const valStr = cur.content.slice(c + 1).trim();
      idx++;
      if (valStr) obj[key] = parseScalar(valStr);
      else obj[key] = parseBlock(objIndent + 1);
    }
    return obj;
  }

  return parseBlock(0) || {};
}

export function validateMinerYaml(rawYamlText, { knownCanonicalIntents = new Set(Object.keys(CANONICAL_INTENT_SCHEMAS)) } = {}) {
  const errors = [];
  const warnings = [];
  let doc;
  try {
    doc = parseSimpleYaml(rawYamlText);
  } catch (err) {
    return { valid: false, errors: [`YAML parse error: ${err.message}`], warnings, doc: null, yamlHash: null };
  }

  // 1. Required root fields & additionalProperties: false
  for (const reqKey of REQUIRED_ROOT_KEYS) {
    if (doc[reqKey] === undefined || doc[reqKey] === null || doc[reqKey] === "") {
      errors.push(`(root): ${reqKey} is required`);
    }
  }
  for (const key of Object.keys(doc)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      errors.push(`(root): Additional property ${key} is not allowed`);
    }
  }

  if (doc.version !== "1" && doc.version !== 1) {
    errors.push(`(root): version must be "1"`);
  }
  if (doc.kind && !["miner", "validator", "subnet"].includes(doc.kind)) {
    errors.push(`(root): kind must be miner, validator, or subnet`);
  }
  if (doc.id !== undefined && (!Number.isInteger(doc.id) || doc.id <= 0)) {
    errors.push(`(root): id must be a positive integer`);
  }
  if (doc.slug && !SLUG_RE.test(String(doc.slug))) {
    errors.push(`(root): slug "${doc.slug}" must match ^[a-z0-9]+(-[a-z0-9]+)*$`);
  }
  if (doc.base_url && !/^https?:\/\/[^/\s]+/i.test(String(doc.base_url))) {
    errors.push(`(root): base_url must start with http:// or https://`);
  }
  if (doc.base_url && /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)/i.test(String(doc.base_url))) {
    errors.push(`(root): base_url cannot be a loopback/localhost address`);
  }

  // 2. Auth block
  if (doc.auth) {
    for (const k of Object.keys(doc.auth)) {
      if (!ALLOWED_AUTH_KEYS.has(k)) errors.push(`auth: Additional property ${k} is not allowed`);
    }
    if (!["bearer", "header", "none"].includes(doc.auth.type)) {
      errors.push(`auth.type must be bearer, header, or none`);
    }
  }

  // 3. Semantics & supported_intents
  const supportedIntents = Array.isArray(doc.semantics?.supported_intents) ? doc.semantics.supported_intents : [];
  if (supportedIntents.length === 0) {
    errors.push("semantics.supported_intents is empty");
  }
  const supportedSet = new Set();
  for (const intent of supportedIntents) {
    if (KNOWN_PREFIXES.has(intent)) {
      errors.push(`a prefix is not an intent: "${intent}"`);
    }
    if (supportedSet.has(intent)) {
      errors.push(`duplicate intent in semantics.supported_intents: "${intent}"`);
    }
    supportedSet.add(intent);
    if (knownCanonicalIntents && knownCanonicalIntents.size > 0 && !knownCanonicalIntents.has(intent)) {
      warnings.push(`Intent "${intent}" not in local snapshot; verify live via isCanonicalIntent("${intent}")`);
    }
  }

  if (doc.semantics?.signal_mapping) {
    for (const k of Object.keys(doc.semantics.signal_mapping)) {
      if (!ALLOWED_SIGNAL_MAPPING_KEYS.has(k)) {
        errors.push(`semantics.signal_mapping: Additional property ${k} is not allowed`);
      }
    }
  }

  // 4. Endpoints
  const endpoints = Array.isArray(doc.endpoints) ? doc.endpoints : [];
  let endpointsWithIntents = 0;
  const endpointPaths = new Set();

  endpoints.forEach((ep, i) => {
    for (const k of Object.keys(ep)) {
      if (!ALLOWED_ENDPOINT_KEYS.has(k)) {
        errors.push(`endpoints.${i}: Additional property ${k} is not allowed`);
      }
    }
    if (!ep.path) errors.push(`endpoints.${i}: path is required`);
    else endpointPaths.add(ep.path);
    if (!ep.external_path) errors.push(`endpoints.${i}: external_path is required`);
    if (!ALLOWED_METHODS.has(ep.method)) errors.push(`endpoints.${i}: invalid method "${ep.method}"`);
    if (!ep.description || String(ep.description).trim().length < 5) {
      errors.push(`endpoint ${ep.path || i} has no description`);
    }
    if (Array.isArray(ep.intents) && ep.intents.length > 0) {
      endpointsWithIntents++;
      for (const ei of ep.intents) {
        if (KNOWN_PREFIXES.has(ei)) errors.push(`a prefix is not an intent: "${ei}"`);
        if (!supportedSet.has(ei)) {
          errors.push(`endpoint ${ep.path} declares intent ${ei} not listed in semantics.supported_intents`);
        }
      }
    } else {
      warnings.push(`endpoint ${ep.path || i} declares no intents (utility endpoint)`);
    }
    if (!ep.params) {
      warnings.push(`endpoint ${ep.path || i} declares no params`);
    }
  });

  if (endpointsWithIntents === 0) {
    errors.push("no endpoint declares any intents");
  }

  // 5. intent_mapping checks
  if (doc.intent_mapping && typeof doc.intent_mapping === "object") {
    for (const [mIntent, mapping] of Object.entries(doc.intent_mapping)) {
      if (!supportedSet.has(mIntent)) {
        errors.push(`intent_mapping invalid: "${mIntent}" not in semantics.supported_intents`);
      }
      if (!mapping?.endpoint || !endpointPaths.has(mapping.endpoint)) {
        errors.push(`intent_mapping invalid: "${mIntent}" references undeclared endpoint "${mapping?.endpoint}"`);
      }
      if (!mapping?.output || Object.keys(mapping.output).length === 0) {
        errors.push(`intent_mapping invalid: "${mIntent}" has empty output mapping`);
      }
    }
  }

  const yamlHash = sha256Hex(Buffer.from(rawYamlText, "utf8"), true);

  return {
    valid: errors.length === 0,
    slug: doc.slug || null,
    id: doc.id || null,
    name: doc.name || null,
    supported_intents: supportedIntents,
    yaml_sha256: yamlHash,
    errors,
    warnings,
    doc,
    registration_commands: {
      diamond: TELEGRAPH_NETWORK.diamond,
      rpc: TELEGRAPH_NETWORK.rpcUrl,
      dry_run_cast: `cast call ${TELEGRAPH_NETWORK.diamond} "registerMiner(string,bytes32,address,uint256,string[])(uint256)" "$YAML_URL" "${yamlHash}" "$FEE_ADDRESS" 10000 '${JSON.stringify(supportedIntents)}' --from "$MINER_ADDR" --rpc-url ${TELEGRAPH_NETWORK.rpcUrl}`,
      register_cast: `cast send ${TELEGRAPH_NETWORK.diamond} "registerMiner(string,bytes32,address,uint256,string[])" "$YAML_URL" "${yamlHash}" "$FEE_ADDRESS" 10000 '${JSON.stringify(supportedIntents)}' --rpc-url ${TELEGRAPH_NETWORK.rpcUrl} --private-key "$MINER_PRIVATE_KEY"`,
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2] || new URL("./miner.yaml", import.meta.url);
  const raw = readFileSync(target, "utf8");
  const report = validateMinerYaml(raw);
  console.log(JSON.stringify({ ...report, doc: undefined }, null, 2));
  process.exit(report.valid ? 0 : 1);
}
