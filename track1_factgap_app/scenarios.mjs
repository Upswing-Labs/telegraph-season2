/**
 * Mission 05 (Conflict Intelligence) — Realistic Customer Dossiers &
 * Explicitly-Labelled Offline Simulation Fixtures (including real Telegraph failure modes).
 */

import { sha256Hex } from "../shared/crypto.mjs";

export const BUILTIN_SCENARIOS = Object.freeze({
  "black-sea-grain": {
    id: "black-sea-grain",
    title: "Black Sea Grain Corridor — Reported vs. Observed Throughput Audit",
    route: "Route 2 (Reported-vs-Observed) + Route 3 (Research Priced per Fact)",
    customer: "Commodities & Systematic Macro Risk Desk",
    reported_claim: {
      summary:
        "Official port bulletin states Constanta grain export corridor is operating with low congestion (<12h wait), normal dry weather, and zero sanctioned counterparties involved.",
      expected_congestion_max_hours: 12,
      expected_sanctions_matched: false,
      expected_precip_max_mm: 5,
      reported_unemployment_pct: 5.4,
    },
    checks: [
      {
        id: "port_congestion",
        label: "Observed port queue & wait hours (Constanta)",
        intent: "LIVE_PORT_CONGESTION_GENERAL",
        params: { port: "Constanta" },
      },
      {
        id: "sanctions_counterparty",
        label: "Counterparty sanctions screening (Rosneft Oil Company)",
        intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
        params: { name: "Rosneft Oil Company" },
      },
      {
        id: "weather_corridor",
        label: "Recorded loading-window weather (Constanta, 2026-11-18)",
        intent: "WEATHER_FORECAST_VERIFY_GENERAL",
        params: { location: "Constanta", date: "2026-11-18" },
      },
      {
        id: "macro_baseline",
        label: "World Bank macro baseline (Romania unemployment rate)",
        intent: "MACRO_ECONOMIC_INDICATOR_GENERAL",
        params: { indicator: "unemployment rate", country: "Romania", year: 2024 },
      },
      {
        id: "fx_eur_benchmark",
        label: "Deterministic USD/EUR freight settlement rate",
        intent: "FX_NOW_EUR",
        params: { currency: "EUR" },
      },
    ],
  },

  "sanctioned-crude-tanker": {
    id: "sanctioned-crude-tanker",
    title: "Shadow-Fleet Crude Shipment — Sanctions, AIS Telemetry & Claim Contradiction Audit",
    route: "Route 2 (Reported-vs-Observed) + Route 3 (Research Priced per Fact)",
    customer: "Sovereign Risk & Maritime Sanctions Desk",
    reported_claim: {
      summary:
        "Charterer attestation asserts vessel is steaming normally at >10 knots with clear sanctions standing and verified non-sanctioned settlement wallet.",
      expected_sanctions_matched: false,
      expected_min_speed_knots: 10,
    },
    checks: [
      {
        id: "wallet_sanctions",
        label: "Settlement wallet OFAC SDN screening (0x098B716B...2f96)",
        intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
        params: { name: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96" },
      },
      {
        id: "vessel_ais",
        label: "Observed maritime AIS speed & coordinates",
        intent: "VESSEL_TELEMETRY_VERIFY_GENERAL",
        params: { vessel: "IMO 9285471" },
      },
      {
        id: "claim_fact_check",
        label: "Independent fact check of public maritime sanctions bulletin",
        intent: "FACT_CHECK_GENERAL",
        params: { claim: "OFAC SDN list includes Ethereum address 0x098B716B8Aaf21512996dC57EB0615e2383E2f96 under Lazarus Group" },
      },
      {
        id: "open_web_corroboration",
        label: "Live web corroboration for recent port/sanctions notices",
        intent: "WEB_SEARCH_GENERAL",
        params: { query: "OFAC Lazarus Group 0x098B716B8Aaf21512996dC57EB0615e2383E2f96 sanctions" },
      },
    ],
  },

  "red-sea-chokepoint": {
    id: "red-sea-chokepoint",
    title: "Red Sea / Jeddah Corridor — Priced-Per-Fact Country Note",
    route: "Route 3 (Research Priced per Fact)",
    customer: "Multi-Manager Macro Research Desk",
    reported_claim: {
      summary:
        "Regional freight circular claims normal port dwell times (<15h) at Jeddah with no active disruption reports.",
      expected_congestion_max_hours: 15,
    },
    checks: [
      {
        id: "jeddah_port",
        label: "Observed Jeddah container terminal congestion",
        intent: "LIVE_PORT_CONGESTION_GENERAL",
        params: { port: "Jeddah" },
      },
      {
        id: "corridor_fact_check",
        label: "Fact-check disruption claim",
        intent: "FACT_CHECK_GENERAL",
        params: { claim: "Commercial container traffic through the Bab el-Mandeb strait experienced rerouting around the Cape of Good Hope in 2024-2026" },
      },
      {
        id: "corridor_search",
        label: "Contemporaneous web corroboration",
        intent: "WEB_SEARCH_GENERAL",
        params: { query: "Jeddah port congestion Red Sea container rerouting latest status" },
      },
    ],
  },

  "failure-empty-verdict": {
    id: "failure-empty-verdict",
    title: "[Failure Test] Null Schema-Shaped Verdict (#234) + LLM Fallback cost_usd=0 (#233)",
    route: "Reproducible Failure & Adversarial Provider Handling",
    customer: "Audit / QA Verification",
    reported_claim: {
      summary:
        "Demonstrates safe handling when FACT_CHECK_GENERAL returns null reasoning/sources (#234) and VESSEL_TELEMETRY falls back to generic openai with cost_usd=0 (#233).",
      expected_min_speed_knots: 8,
    },
    checks: [
      {
        id: "broken_fact_check",
        label: "Defective FACT_CHECK provider (null claim/reasoning/sources — #234)",
        intent: "FACT_CHECK_GENERAL",
        params: { claim: "SIM_FAIL_EMPTY_VERDICT: Port throughput doubled overnight with zero delays" },
      },
      {
        id: "openai_fallback_vessel",
        label: "Generic LLM fallback reporting cost_usd=0 (#233)",
        intent: "VESSEL_TELEMETRY_VERIFY_GENERAL",
        params: { vessel: "SIM_FAIL_OPENAI_FALLBACK" },
      },
    ],
  },

  "failure-stale-ais": {
    id: "failure-stale-ais",
    title: "[Failure Test] Stale AIS Reading (>72h old) & Conflicting Media Provenance",
    route: "Reproducible Failure — Stale Telemetry & Manipulated Media Guard",
    customer: "Audit / QA Verification",
    reported_claim: {
      summary:
        "Demonstrates refusal to assert live movement from stale 120-hour-old AIS data and flagging manipulated viral port imagery.",
      expected_min_speed_knots: 12,
    },
    checks: [
      {
        id: "stale_vessel",
        label: "Stale AIS transponder report (120h old)",
        intent: "VESSEL_TELEMETRY_VERIFY_GENERAL",
        params: { vessel: "SIM_STALE_VESSEL_999" },
      },
      {
        id: "forged_media",
        label: "Forensic check on manipulated/recycled port video",
        intent: "MEDIA_FORENSIC_VERIFY_GENERAL",
        params: { media_url: "https://example.org/evidence/recycled-port-fire-clip.mp4" },
      },
    ],
  },
});

/**
 * Deterministic SIMULATED_TEST_FIXTURE provider used ONLY when mode === "simulated".
 * Every output is explicitly marked simulated=true so it can never be mistaken for live testnet/mainnet.
 */
export function createMission05Simulator({ nowIso = new Date().toISOString() } = {}) {
  const freshIso = new Date(Date.parse(nowIso) - 35 * 60 * 1000).toISOString();
  const staleIso = new Date(Date.parse(nowIso) - 120 * 60 * 60 * 1000).toISOString();

  return async function simulateTelegraph({ intent, params }) {
    const hash = "0x" + sha256Hex(`sim:${intent}:${JSON.stringify(params)}`);

    if (intent === "FACT_CHECK_GENERAL" && String(params.claim || "").startsWith("SIM_FAIL_EMPTY_VERDICT")) {
      // Exact reproduction of live GitHub Issue #234
      return {
        ok: true,
        latency_ms: 420,
        answer: {
          miner_id: "4433",
          miner_name: "sim-empty-factcheck-fixture",
          endpoint: "/fact-check",
          result_shape: "intent",
          format_version: 3,
          result: { claim: null, verdict: "Unverified", reasoning: null, sources: null },
          field_status: { claim: "missing", verdict: "ok", reasoning: "missing", sources: "missing" },
          cost_usd: 0.01,
          duration_ms: 410,
          timestamp: nowIso,
          intent,
          signal_hash: hash,
        },
      };
    }

    if (intent === "VESSEL_TELEMETRY_VERIFY_GENERAL" && params.vessel === "SIM_FAIL_OPENAI_FALLBACK") {
      // Exact reproduction of live GitHub Issue #233
      return {
        ok: true,
        latency_ms: 680,
        answer: {
          miner_id: "openai",
          miner_name: "generic-llm-fallback",
          endpoint: "/fallback",
          result_shape: "intent",
          format_version: 3,
          result: {
            vessel: params.vessel,
            speed_knots: null,
            latitude: null,
            longitude: null,
            course_deg: null,
            observed_at: null,
          },
          field_status: {
            vessel: "ok",
            speed_knots: "missing",
            latitude: "missing",
            longitude: "missing",
            course_deg: "missing",
            observed_at: "missing",
          },
          cost_usd: 0, // Bug #233: reports 0 despite $0.01 settlement
          duration_ms: 670,
          timestamp: nowIso,
          intent,
          signal_hash: hash,
        },
      };
    }

    if (intent === "VESSEL_TELEMETRY_VERIFY_GENERAL" && params.vessel === "SIM_STALE_VESSEL_999") {
      return {
        ok: true,
        latency_ms: 290,
        answer: {
          miner_id: "70211",
          miner_name: "sim-ais-fixture",
          endpoint: "/vessel",
          result_shape: "intent",
          format_version: 3,
          result: {
            vessel: params.vessel,
            speed_knots: 1.4,
            latitude: 44.1598,
            longitude: 28.6541,
            course_deg: 142.0,
            observed_at: staleIso,
          },
          field_status: {
            vessel: "ok",
            speed_knots: "ok",
            latitude: "ok",
            longitude: "ok",
            course_deg: "ok",
            observed_at: "ok",
          },
          cost_usd: 0.01,
          duration_ms: 285,
          timestamp: nowIso,
          intent,
          signal_hash: hash,
        },
      };
    }

    switch (intent) {
      case "LIVE_PORT_CONGESTION_GENERAL": {
        const isJeddah = String(params.port).toLowerCase().includes("jeddah");
        return {
          ok: true,
          latency_ms: 340,
          answer: {
            miner_id: "71402",
            miner_name: "sim-port-telemetry-fixture",
            endpoint: "/port/congestion",
            result_shape: "intent",
            format_version: 3,
            result: {
              port: params.port,
              vessels_waiting: isJeddah ? 27 : 38,
              wait_hours: isJeddah ? 31.5 : 44.2,
              congestion_level: isJeddah ? "high" : "severe",
              as_of: freshIso,
            },
            field_status: { port: "ok", vessels_waiting: "ok", wait_hours: "ok", congestion_level: "ok", as_of: "ok" },
            cost_usd: 0.01,
            duration_ms: 332,
            timestamp: nowIso,
            intent,
            signal_hash: hash,
          },
        };
      }

      case "SANCTIONS_SCREENING_MATCH_GENERAL": {
        const lower = String(params.name).toLowerCase();
        const isLazarus = lower.includes("0x098b716b8aaf21512996dc57eb0615e2383e2f96");
        const isRosneft = lower.includes("rosneft");
        const matched = isLazarus || isRosneft;
        return {
          ok: true,
          latency_ms: 195,
          answer: {
            miner_id: "64175",
            miner_name: "sim-oathcast-sanctions-fixture",
            endpoint: "/screen",
            result_shape: "intent",
            format_version: 3,
            result: {
              name: params.name,
              matched,
              matches: isLazarus
                ? ["LAZARUS GROUP (OFAC SDN Entry 27307, program DPRK3, Digital Currency Address - ETH)"]
                : isRosneft
                  ? ["OPEN JOINT-STOCK COMPANY ROSNEFT OIL COMPANY (OFAC SDN Entry 17022, UKRAINE-EO13662 / RUSSIA-EO14024)"]
                  : [],
              lists: ["OFAC SDN", "OFAC Consolidated", "EU Financial Sanctions", "UN Security Council"],
              match_score: matched ? 1.0 : 0.0,
            },
            field_status: { name: "ok", matched: "ok", matches: "ok", lists: "ok", match_score: "ok" },
            cost_usd: 0.01,
            duration_ms: 188,
            timestamp: nowIso,
            intent,
            signal_hash: hash,
          },
        };
      }

      case "WEATHER_FORECAST_VERIFY_GENERAL":
        return {
          ok: true,
          latency_ms: 260,
          answer: {
            miner_id: "64174",
            miner_name: "sim-weather-verify-fixture",
            endpoint: "/verify",
            result_shape: "intent",
            format_version: 3,
            result: {
              location: params.location,
              date: params.date,
              temp_max_c: 9.4,
              temp_min_c: 3.1,
              precipitation_mm: 18.6,
              condition: "Heavy rain and coastal gale gusts",
            },
            field_status: { location: "ok", date: "ok", temp_max_c: "ok", temp_min_c: "ok", precipitation_mm: "ok", condition: "ok" },
            cost_usd: 0.01,
            duration_ms: 252,
            timestamp: nowIso,
            intent,
            signal_hash: hash,
          },
        };

      case "MACRO_ECONOMIC_INDICATOR_GENERAL":
        return {
          ok: true,
          latency_ms: 215,
          answer: {
            miner_id: "52104",
            miner_name: "sim-worldbank-macro-fixture",
            endpoint: "/macro",
            result_shape: "intent",
            format_version: 5,
            result: { rate_pct: 5.58 },
            field_status: { rate_pct: "ok" },
            cost_usd: 0.01,
            duration_ms: 210,
            timestamp: nowIso,
            intent,
            signal_hash: hash,
          },
        };

      case "FX_NOW_EUR":
        return {
          ok: true,
          latency_ms: 145,
          answer: {
            miner_id: "32004",
            miner_name: "sim-ecb-fx-fixture",
            endpoint: "/latest",
            result_shape: "intent",
            format_version: 1,
            result: { rate: 0.9462 },
            field_status: { rate: "ok" },
            cost_usd: 0.01,
            duration_ms: 140,
            timestamp: nowIso,
            intent,
            signal_hash: hash,
          },
        };

      case "VESSEL_TELEMETRY_VERIFY_GENERAL":
        return {
          ok: true,
          latency_ms: 310,
          answer: {
            miner_id: "70211",
            miner_name: "sim-ais-fixture",
            endpoint: "/vessel",
            result_shape: "intent",
            format_version: 3,
            result: {
              vessel: params.vessel,
              speed_knots: 0.3,
              latitude: 44.1124,
              longitude: 28.6982,
              course_deg: 215.0,
              observed_at: freshIso,
            },
            field_status: {
              vessel: "ok",
              speed_knots: "ok",
              latitude: "ok",
              longitude: "ok",
              course_deg: "ok",
              observed_at: "ok",
            },
            cost_usd: 0.01,
            duration_ms: 300,
            timestamp: nowIso,
            intent,
            signal_hash: hash,
          },
        };

      case "FACT_CHECK_GENERAL":
        return {
          ok: true,
          latency_ms: 510,
          answer: {
            miner_id: "302",
            miner_name: "sim-chainsight-factcheck-fixture",
            endpoint: "/fact-check",
            result_shape: "intent",
            format_version: 3,
            result: {
              claim: params.claim,
              verdict: "True",
              reasoning: "Confirmed against US Treasury OFAC SDN publication and maritime corridor advisories.",
              sources: [
                "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML",
                "https://www.maritime.dot.gov/msci-advisories",
              ],
            },
            field_status: { claim: "ok", verdict: "ok", reasoning: "ok", sources: "ok" },
            cost_usd: 0.01,
            duration_ms: 498,
            timestamp: nowIso,
            intent,
            signal_hash: hash,
          },
        };

      case "WEB_SEARCH_GENERAL":
        return {
          ok: true,
          latency_ms: 460,
          answer: {
            miner_id: "302",
            miner_name: "sim-chainsight-websearch-fixture",
            endpoint: "/search",
            result_shape: "intent",
            format_version: 3,
            result: {
              answer: "Public advisories and OFAC SDN records confirm heightened corridor routing delays and active sanctions listings.",
              sources: [
                "https://ofac.treasury.gov/recent-actions",
                "https://www.imo.org/en/MediaCentre/HotTopics/Pages/Red-Sea.aspx",
              ],
              brief: "Public filings confirm active sanctions listings and corridor delays.",
            },
            field_status: { answer: "ok", sources: "ok", brief: "ok" },
            cost_usd: 0.01,
            duration_ms: 452,
            timestamp: nowIso,
            intent,
            signal_hash: hash,
          },
        };

      case "MEDIA_FORENSIC_VERIFY_GENERAL":
        return {
          ok: true,
          latency_ms: 590,
          answer: {
            miner_id: "34",
            miner_name: "sim-media-forensics-fixture",
            endpoint: "/verify",
            result_shape: "intent",
            format_version: 3,
            result: {
              verdict: "Manipulated",
              findings: [
                "EXIF creation timestamp predates claimed incident by 19 months",
                "Double-recompression artifacts consistent with recycled footage",
              ],
              confidence: 0.91,
              summary: "Clip metadata and compression artifacts indicate recycled footage rather than a live incident.",
            },
            field_status: { verdict: "ok", findings: "ok", confidence: "ok", summary: "ok" },
            cost_usd: 0.01,
            duration_ms: 580,
            timestamp: nowIso,
            intent,
            signal_hash: hash,
          },
        };

      default:
        return { ok: false, error: `No simulator fixture for intent ${intent}` };
    }
  };
}
