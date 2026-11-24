/**
 * Track 01 — Native JSON-RPC 2.0 Streamable HTTP MCP Server for Upswing FactGap.
 * Enables any AI agent (Claude, Cursor, Hermes, ElizaOS) to run budgeted Mission 05
 * conflict/macro discrepancy audits with itemized Telegraph receipts.
 */

import { BUILTIN_SCENARIOS } from "./scenarios.mjs";
import { buildCustomDossier, runFactGapDossier } from "./engine.mjs";
import { CANONICAL_INTENT_SCHEMAS } from "../shared/schemas.mjs";

const PROTOCOL_VERSION = "2025-03-26";

export const FACTGAP_MCP_TOOLS = [
  {
    name: "factgap_list_scenarios",
    description: "List built-in Mission 05 (Conflict Intelligence) audit scenarios and reproducible failure tests.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "factgap_run_dossier",
    description:
      "Execute a budgeted Reported-vs-Observed & Priced-Per-Fact Telegraph audit (either by built-in scenario_id or custom claim/entity/port/vessel/country).",
    inputSchema: {
      type: "object",
      properties: {
        scenario_id: { type: "string", description: "Built-in scenario id (e.g. black-sea-grain, sanctioned-crude-tanker, failure-empty-verdict)" },
        claim: { type: "string", description: "Custom factual claim to check" },
        entity: { type: "string", description: "Entity or wallet address for sanctions screening" },
        port: { type: "string", description: "Port name for congestion verification" },
        vessel: { type: "string", description: "Vessel name, IMO, or MMSI for AIS telemetry" },
        country: { type: "string", description: "Country name for World Bank macro indicator" },
        bypass_cache: { type: "boolean", description: "Force fresh paid purchase instead of TTL cache reuse" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "factgap_budget_status",
    description: "Inspect hard wallet spending limits, remaining daily budget, circuit-breaker state, and authorization status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "factgap_receipt_ledger",
    description: "Return itemized Telegraph purchase receipts (signal_hash, receipt_hash, miner_id, billed_usd, rail).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "factgap_inspect_intent",
    description: "Return the verified Telegraph V2 canonical request & response schema for a Mission 05 intent.",
    inputSchema: {
      type: "object",
      required: ["intent"],
      properties: { intent: { type: "string" } },
      additionalProperties: false,
    },
  },
];

export async function handleFactGapMcpRequest(rpcBody, client) {
  if (!rpcBody || rpcBody.jsonrpc !== "2.0" || typeof rpcBody.method !== "string") {
    return {
      jsonrpc: "2.0",
      id: rpcBody?.id ?? null,
      error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" },
    };
  }
  const id = rpcBody.id ?? null;

  if (rpcBody.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: "upswing-factgap-mcp", version: "1.0.0" },
        capabilities: { tools: {} },
      },
    };
  }

  if (rpcBody.method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: FACTGAP_MCP_TOOLS } };
  }

  if (rpcBody.method === "tools/call") {
    const name = rpcBody.params?.name;
    const args = rpcBody.params?.arguments || {};
    try {
      let data;
      if (name === "factgap_list_scenarios") {
        data = Object.values(BUILTIN_SCENARIOS).map((s) => ({
          id: s.id,
          title: s.title,
          route: s.route,
          checks: s.checks.map((c) => c.intent),
        }));
      } else if (name === "factgap_run_dossier") {
        const dossier = args.scenario_id
          ? BUILTIN_SCENARIOS[args.scenario_id]
          : buildCustomDossier(args);
        if (!dossier) {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [{ type: "text", text: `Unknown scenario_id: ${args.scenario_id}` }],
            },
          };
        }
        data = await runFactGapDossier(client, dossier, { bypassCache: Boolean(args.bypass_cache) });
      } else if (name === "factgap_budget_status") {
        data = { mode: client.mode, budget: client.budgetGuard.snapshot() };
      } else if (name === "factgap_receipt_ledger") {
        data = { count: client.budgetGuard.ledger.length, ledger: client.budgetGuard.ledger };
      } else if (name === "factgap_inspect_intent") {
        const schema = CANONICAL_INTENT_SCHEMAS[args.intent];
        if (!schema) {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [{ type: "text", text: `Intent not in local schema registry: ${args.intent}` }],
            },
          };
        }
        data = schema;
      } else {
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: `${err.name}: ${err.message}` }],
        },
      };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported method: ${rpcBody.method}` } };
}
