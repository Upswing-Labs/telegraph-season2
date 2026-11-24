/**
 * Track 01 — Upswing FactGap Engine (Mission 05: Conflict Intelligence — Routes 2 & 3).
 *
 * Core principles directly honoring Mission 05 acceptance criteria:
 *  1. Every purchased signal carries its exact Telegraph intent, miner_id, cost_usd,
 *     latency_ms, signal_hash, and receipt_hash.
 *  2. Disagreement is NEVER averaged away: every contradiction between the reported claim
 *     and observed Telegraph signals is itemized explicitly with severity and provenance.
 *  3. Adversarial provider defects (#233 LLM fallback cost_usd=0, #234 empty schema-shaped
 *     verdicts, stale AIS/port timestamps > maxTelemetryAgeHours) are surfaced as explicit
 *     uncertainty rather than silently coerced into false certainty.
 *  4. Output is framed strictly as provenance & confidence — never a definitive verdict on
 *     a live conflict. External publishing / desk-alert actions require explicit authorization.
 */

import { AuthorizationRequiredError, BudgetExceededError } from "../shared/telegraph_client.mjs";
import { BUILTIN_SCENARIOS } from "./scenarios.mjs";

const DEFAULT_MAX_TELEMETRY_AGE_HOURS = 48;

function computeTelemetryAgeHours(isoTimestamp, nowMs) {
  if (!isoTimestamp) return null;
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) return null;
  return Math.round(((nowMs - parsed) / (1000 * 60 * 60)) * 100) / 100;
}

/**
 * Evaluates a single purchased Telegraph signal against the reported claim & quality gates.
 */
export function evaluateSignalAgainstClaim(check, callResult, reportedClaim = {}, { nowMs = Date.now(), maxTelemetryAgeHours = DEFAULT_MAX_TELEMETRY_AGE_HOURS } = {}) {
  if (!callResult.ok) {
    return {
      check_id: check.id,
      label: check.label,
      intent: check.intent,
      params: check.params,
      status: "FAILED_OR_BLOCKED",
      classification: "UNAVAILABLE",
      discrepancy_points: 0,
      contradiction: null,
      quality_flags: [callResult.error || "request_failed"],
      cost_usd: callResult.cost_usd || 0,
      latency_ms: callResult.latency_ms || 0,
      cached_reuse: Boolean(callResult.cached_reuse),
      provenance: null,
      observed: null,
    };
  }

  const answer = callResult.answer || {};
  const res = answer.result || {};
  const warnings = Array.isArray(callResult.warnings) ? callResult.warnings : [];
  const qualityFlags = warnings.map((w) => `${w.code}: ${w.message}`);

  // Check for fatal provider defect (#234 empty verdict, all fields null, or openai fallback with null metrics)
  const hasEmptyDefect = warnings.some((w) =>
    ["UNVERIFIABLE_EMPTY_PROVIDER", "ALL_FIELDS_NULL", "EMPTY_RESPONSE"].includes(w.code)
  );
  const isLlmFallback = warnings.some((w) => w.code === "LLM_FALLBACK_PROVIDER");

  if (hasEmptyDefect || (isLlmFallback && Object.values(res).filter((v) => v !== null && v !== undefined).length <= 1)) {
    return {
      check_id: check.id,
      label: check.label,
      intent: check.intent,
      params: check.params,
      status: "PROVIDER_DEFECT",
      classification: "UNVERIFIABLE_PROVIDER_DEFECT",
      discrepancy_points: 0,
      contradiction: {
        type: "PROVIDER_QUALITY_DEFECT",
        severity: "HIGH",
        detail: qualityFlags.join(" | "),
      },
      quality_flags: qualityFlags,
      cost_usd: callResult.cost_usd,
      latency_ms: callResult.latency_ms,
      cached_reuse: Boolean(callResult.cached_reuse),
      provenance: {
        miner_id: answer.miner_id || null,
        miner_name: answer.miner_name || null,
        signal_hash: answer.signal_hash || null,
        receipt_hash: callResult.receipt?.receipt_hash || null,
        epoch_id: callResult.receipt?.epoch_id ?? null,
        rail: callResult.receipt?.rail || callResult.network_mode,
        simulated: Boolean(callResult.simulated),
      },
      observed: res,
    };
  }

  // Freshness check for time-stamped telemetry intents
  const tsField = res.observed_at || res.as_of || null;
  const ageHours = computeTelemetryAgeHours(tsField, nowMs);
  if (ageHours !== null && ageHours > maxTelemetryAgeHours) {
    qualityFlags.push(`STALE_TELEMETRY: Reading timestamp ${tsField} is ${ageHours}h old (limit ${maxTelemetryAgeHours}h)`);
    return {
      check_id: check.id,
      label: check.label,
      intent: check.intent,
      params: check.params,
      status: "STALE_DATA",
      classification: "INCONCLUSIVE_STALE",
      discrepancy_points: 0,
      contradiction: {
        type: "STALE_TELEMETRY",
        severity: "MEDIUM",
        detail: `Telemetry for ${check.intent} is ${ageHours}h old (> ${maxTelemetryAgeHours}h SLA); excluded from live discrepancy score.`,
      },
      quality_flags: qualityFlags,
      cost_usd: callResult.cost_usd,
      latency_ms: callResult.latency_ms,
      cached_reuse: Boolean(callResult.cached_reuse),
      provenance: {
        miner_id: answer.miner_id || null,
        miner_name: answer.miner_name || null,
        signal_hash: answer.signal_hash || null,
        receipt_hash: callResult.receipt?.receipt_hash || null,
        epoch_id: callResult.receipt?.epoch_id ?? null,
        rail: callResult.receipt?.rail || callResult.network_mode,
        simulated: Boolean(callResult.simulated),
      },
      observed: res,
    };
  }

  let classification = "OBSERVED_CONTEXT";
  let discrepancyPoints = 0;
  let contradiction = null;

  if (check.intent === "LIVE_PORT_CONGESTION_GENERAL" && typeof res.wait_hours === "number") {
    const maxExpected = reportedClaim.expected_congestion_max_hours;
    if (typeof maxExpected === "number" && res.wait_hours > maxExpected) {
      const ratio = res.wait_hours / Math.max(1, maxExpected);
      classification = "CONTRADICTS_REPORTED_CLAIM";
      discrepancyPoints = ratio >= 2 ? 32 : 18;
      contradiction = {
        type: "PORT_WAIT_DISCREPANCY",
        severity: ratio >= 2 ? "HIGH" : "MEDIUM",
        reported: `<= ${maxExpected}h wait`,
        observed: `${res.wait_hours}h wait (${res.vessels_waiting ?? "?"} vessels, level=${res.congestion_level || "?"})`,
        detail: `Observed wait time at ${res.port || check.params.port} (${res.wait_hours}h) exceeds reported threshold (${maxExpected}h) by ${Math.round((ratio - 1) * 100)}%.`,
      };
    } else {
      classification = "SUPPORTS_REPORTED_CLAIM";
    }
  } else if (check.intent === "SANCTIONS_SCREENING_MATCH_GENERAL" && typeof res.matched === "boolean") {
    if (reportedClaim.expected_sanctions_matched === false && res.matched === true) {
      classification = "CONTRADICTS_REPORTED_CLAIM";
      discrepancyPoints = 40;
      contradiction = {
        type: "SANCTIONS_HIT_DISCREPANCY",
        severity: "CRITICAL",
        reported: "No sanctioned counterparty",
        observed: `MATCHED (${(res.lists || []).join(", ")}) — ${(res.matches || []).slice(0, 2).join("; ")}`,
        detail: `Counterparty "${res.name || check.params.name}" matched official sanctions list(s), contradicting clean attestation.`,
      };
    } else if (res.matched === true) {
      classification = "ALERT_OBSERVED";
      discrepancyPoints = 30;
    } else {
      classification = "SUPPORTS_REPORTED_CLAIM";
    }
  } else if (check.intent === "VESSEL_TELEMETRY_VERIFY_GENERAL" && typeof res.speed_knots === "number") {
    const minSpeed = reportedClaim.expected_min_speed_knots;
    if (typeof minSpeed === "number" && res.speed_knots < minSpeed) {
      classification = "CONTRADICTS_REPORTED_CLAIM";
      discrepancyPoints = res.speed_knots < 1 ? 30 : 18;
      contradiction = {
        type: "VESSEL_SPEED_DISCREPANCY",
        severity: res.speed_knots < 1 ? "HIGH" : "MEDIUM",
        reported: `Steaming >= ${minSpeed} knots`,
        observed: `${res.speed_knots} knots at (${res.latitude}, ${res.longitude})`,
        detail: `Vessel ${res.vessel || check.params.vessel} observed at ${res.speed_knots} knots (anchored/drifting), contradicting claimed transit speed >= ${minSpeed} knots.`,
      };
    } else {
      classification = "SUPPORTS_REPORTED_CLAIM";
    }
  } else if (check.intent === "WEATHER_FORECAST_VERIFY_GENERAL" && typeof res.precipitation_mm === "number") {
    const maxPrecip = reportedClaim.expected_precip_max_mm;
    if (typeof maxPrecip === "number" && res.precipitation_mm > maxPrecip) {
      classification = "CONTRADICTS_REPORTED_CLAIM";
      discrepancyPoints = 18;
      contradiction = {
        type: "WEATHER_DISRUPTION_DISCREPANCY",
        severity: "MEDIUM",
        reported: `Dry loading window (<= ${maxPrecip} mm)`,
        observed: `${res.precipitation_mm} mm (${res.condition || "wet conditions"})`,
        detail: `Recorded precipitation at ${res.location || check.params.location} on ${res.date || check.params.date} was ${res.precipitation_mm} mm, contradicting dry-window claim.`,
      };
    } else {
      classification = "SUPPORTS_REPORTED_CLAIM";
    }
  } else if (check.intent === "MEDIA_FORENSIC_VERIFY_GENERAL" && res.verdict) {
    if (["Manipulated", "Likely manipulated"].includes(res.verdict)) {
      classification = "CONTRADICTS_REPORTED_CLAIM";
      discrepancyPoints = 35;
      contradiction = {
        type: "MEDIA_PROVENANCE_MANIPULATED",
        severity: "HIGH",
        reported: "Contemporaneous authentic footage",
        observed: `${res.verdict} (confidence=${res.confidence ?? "?"}): ${res.summary || ""}`,
        detail: `Media forensic analysis flagged evidence URL as "${res.verdict}".`,
      };
    } else if (res.verdict === "Inconclusive") {
      classification = "INCONCLUSIVE_AMBIGUOUS";
    } else {
      classification = "SUPPORTS_REPORTED_CLAIM";
    }
  } else if (check.intent === "FACT_CHECK_GENERAL" && res.verdict) {
    if (["False", "Mostly False", "Misleading"].includes(res.verdict)) {
      classification = "CONTRADICTS_REPORTED_CLAIM";
      discrepancyPoints = 30;
      contradiction = {
        type: "FACT_CHECK_REFUTATION",
        severity: "HIGH",
        reported: check.params.claim,
        observed: `${res.verdict}: ${res.reasoning || ""}`,
        detail: `Fact check returned "${res.verdict}" with ${(res.sources || []).length} cited source(s).`,
      };
    } else if (res.verdict === "Unverified" || res.verdict === "Mixed") {
      classification = "INCONCLUSIVE_AMBIGUOUS";
    } else {
      classification = "SUPPORTS_REPORTED_CLAIM";
    }
  } else if (check.intent === "MACRO_ECONOMIC_INDICATOR_GENERAL" && typeof res.rate_pct === "number") {
    const rep = reportedClaim.reported_unemployment_pct;
    if (typeof rep === "number" && Math.abs(res.rate_pct - rep) >= 1.5) {
      classification = "CONTRADICTS_REPORTED_CLAIM";
      discrepancyPoints = 15;
      contradiction = {
        type: "MACRO_SERIES_DISCREPANCY",
        severity: "MEDIUM",
        reported: `${rep}%`,
        observed: `${res.rate_pct}% (World Bank SL.UEM.TOTL.ZS)`,
        detail: `Observed World Bank unemployment rate (${res.rate_pct}%) diverges from reported figure (${rep}%).`,
      };
    } else {
      classification = "SUPPORTS_REPORTED_CLAIM";
    }
  } else {
    classification = "OBSERVED_CONTEXT";
  }

  return {
    check_id: check.id,
    label: check.label,
    intent: check.intent,
    params: check.params,
    status: "VERIFIED",
    classification,
    discrepancy_points: discrepancyPoints,
    contradiction,
    quality_flags: qualityFlags,
    cost_usd: callResult.cost_usd,
    latency_ms: callResult.latency_ms,
    cached_reuse: Boolean(callResult.cached_reuse),
    provenance: {
      miner_id: answer.miner_id || null,
      miner_name: answer.miner_name || null,
      signal_hash: answer.signal_hash || null,
      receipt_hash: callResult.receipt?.receipt_hash || null,
      epoch_id: callResult.receipt?.epoch_id ?? null,
      rail: callResult.receipt?.rail || callResult.network_mode,
      simulated: Boolean(callResult.simulated),
    },
    observed: res,
  };
}

/**
 * Runs a complete FactGap dossier through TelegraphClient and builds the auditable
 * Reported-vs-Observed & Priced-Per-Fact Intelligence Packet.
 */
export async function runFactGapDossier(client, dossier, {
  publishAction = false,
  publishAuthorized = false,
  maxTelemetryAgeHours = DEFAULT_MAX_TELEMETRY_AGE_HOURS,
  bypassCache = false,
} = {}) {
  if (publishAction && !publishAuthorized) {
    throw new AuthorizationRequiredError(
      "External publication or risk-desk alert dispatch requires explicit publishAuthorized=true consent.",
      { dossier_id: dossier.id }
    );
  }

  client.budgetGuard.resetRun();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const evaluatedChecks = [];
  let haltedReason = null;

  for (const check of dossier.checks || []) {
    try {
      const res = await client.askCanonical({
        intent: check.intent,
        params: check.params,
        minerId: check.minerId || null,
        maxBudgetUusdc: check.maxBudgetUusdc || 30_000,
        bypassCache,
      });
      evaluatedChecks.push(
        evaluateSignalAgainstClaim(check, res, dossier.reported_claim || {}, {
          nowMs: Date.now(),
          maxTelemetryAgeHours,
        })
      );
    } catch (err) {
      if (err instanceof BudgetExceededError || err instanceof AuthorizationRequiredError) {
        haltedReason = `${err.name}: ${err.message}`;
        evaluatedChecks.push({
          check_id: check.id,
          label: check.label,
          intent: check.intent,
          params: check.params,
          status: "BLOCKED_BY_GUARD",
          classification: "UNAVAILABLE",
          discrepancy_points: 0,
          contradiction: null,
          quality_flags: [haltedReason],
          cost_usd: 0,
          latency_ms: 0,
          cached_reuse: false,
          provenance: null,
          observed: null,
        });
        break;
      }
      throw err;
    }
  }

  const verifiedChecks = evaluatedChecks.filter((c) => c.status === "VERIFIED");
  const contradictions = evaluatedChecks.filter((c) => c.contradiction !== null).map((c) => ({
    check_id: c.check_id,
    intent: c.intent,
    ...c.contradiction,
    receipt_hash: c.provenance?.receipt_hash || null,
    signal_hash: c.provenance?.signal_hash || null,
  }));

  const rawScore = verifiedChecks.reduce((acc, c) => acc + c.discrepancy_points, 0);
  const discrepancyScore = Math.min(100, rawScore);
  const totalCostUsd = Math.round(evaluatedChecks.reduce((acc, c) => acc + (c.cost_usd || 0), 0) * 1e6) / 1e6;
  const cachedReuseCount = evaluatedChecks.filter((c) => c.cached_reuse).length;
  const completenessPct =
    dossier.checks && dossier.checks.length > 0
      ? Math.round((verifiedChecks.length / dossier.checks.length) * 1000) / 10
      : 0;

  let provenanceStatus = "LOW_DISCREPANCY_SUPPORTED";
  if (verifiedChecks.length === 0) {
    provenanceStatus = "UNKNOWN_INSUFFICIENT_VERIFIED_EVIDENCE";
  } else if (discrepancyScore >= 60) {
    provenanceStatus = "HIGH_REPORTED_VS_OBSERVED_DISCREPANCY";
  } else if (discrepancyScore >= 25) {
    provenanceStatus = "MODERATE_DISCREPANCY_REVIEW_REQUIRED";
  } else if (contradictions.length > 0) {
    provenanceStatus = "UNCERTAINTY_OR_PROVIDER_DEFECT_FLAGGED";
  }

  const latencies = evaluatedChecks.map((c) => c.latency_ms).filter((x) => x > 0).sort((a, b) => a - b);
  const p50LatencyMs = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : 0;
  const maxLatencyMs = latencies.length > 0 ? latencies[latencies.length - 1] : 0;

  return {
    product: "upswing-factgap",
    mission: "Mission 05 — Conflict Intelligence (Routes 2 & 3)",
    dossier_id: dossier.id,
    title: dossier.title,
    route: dossier.route,
    customer: dossier.customer,
    network_mode: client.mode === "simulated" ? "SIMULATED_TEST_FIXTURE" : client.mode,
    simulated: client.mode === "simulated",
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    total_duration_ms: Date.now() - startedMs,
    action_mode: publishAction ? "AUTHORIZED_PUBLISHED" : "DRAFT_ONLY_NO_EXTERNAL_SIDE_EFFECT",
    epistemic_framing:
      "Provenance & confidence audit only: reports what purchased Telegraph inputs observed and where they contradict reported claims. Never asserts a definitive verdict on a live conflict.",
    reported_claim: dossier.reported_claim || {},
    summary: {
      provenance_status: provenanceStatus,
      discrepancy_score: discrepancyScore,
      evidence_completeness_pct: completenessPct,
      planned_checks: (dossier.checks || []).length,
      executed_checks: evaluatedChecks.length,
      verified_checks: verifiedChecks.length,
      contradiction_count: contradictions.length,
      halted_reason: haltedReason,
    },
    contradictions,
    observation_vs_interpretation: {
      observed_facts: verifiedChecks.map((c) => ({
        check_id: c.check_id,
        intent: c.intent,
        observed: c.observed,
        cost_usd: c.cost_usd,
        miner_id: c.provenance?.miner_id,
        signal_hash: c.provenance?.signal_hash,
        receipt_hash: c.provenance?.receipt_hash,
      })),
      analyst_interpretation:
        verifiedChecks.length === 0
          ? "No fresh, defect-free Telegraph signal passed quality checks; do not act on unverified inputs."
          : contradictions.length > 0
            ? `${contradictions.length} explicit discrepancy/uncertainty flag(s) detected across ${verifiedChecks.length} verified check(s). Inspect each contradiction row rather than averaging into a single headline.`
            : `All ${verifiedChecks.length} verified Telegraph check(s) align with the reported baseline within configured tolerances.`,
    },
    cost_accounting: {
      total_cost_usd: totalCostUsd,
      cost_per_verified_claim_usd:
        verifiedChecks.length > 0 ? Math.round((totalCostUsd / verifiedChecks.length) * 1e6) / 1e6 : null,
      cached_reuse_count: cachedReuseCount,
      p50_latency_ms: p50LatencyMs,
      max_latency_ms: maxLatencyMs,
      budget_snapshot: client.budgetGuard.snapshot(),
    },
    checks: evaluatedChecks,
  };
}

export function buildCustomDossier({ claim, entity, port, vessel, country, weatherLocation, weatherDate, mediaUrl }) {
  const checks = [];
  if (entity) {
    checks.push({
      id: "sanctions_check",
      label: `Sanctions screening (${entity})`,
      intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
      params: { name: entity },
    });
  }
  if (port) {
    checks.push({
      id: "port_check",
      label: `Port congestion (${port})`,
      intent: "LIVE_PORT_CONGESTION_GENERAL",
      params: { port },
    });
  }
  if (vessel) {
    checks.push({
      id: "vessel_check",
      label: `Vessel AIS telemetry (${vessel})`,
      intent: "VESSEL_TELEMETRY_VERIFY_GENERAL",
      params: { vessel },
    });
  }
  if (country) {
    checks.push({
      id: "macro_check",
      label: `Macro indicator (${country} unemployment rate)`,
      intent: "MACRO_ECONOMIC_INDICATOR_GENERAL",
      params: { indicator: "unemployment rate", country },
    });
  }
  if (weatherLocation && weatherDate) {
    checks.push({
      id: "weather_check",
      label: `Recorded weather (${weatherLocation}, ${weatherDate})`,
      intent: "WEATHER_FORECAST_VERIFY_GENERAL",
      params: { location: weatherLocation, date: weatherDate },
    });
  }
  if (mediaUrl) {
    checks.push({
      id: "media_check",
      label: `Media forensic provenance (${mediaUrl})`,
      intent: "MEDIA_FORENSIC_VERIFY_GENERAL",
      params: { media_url: mediaUrl },
    });
  }
  if (claim) {
    checks.push({
      id: "fact_check",
      label: "Independent fact check",
      intent: "FACT_CHECK_GENERAL",
      params: { claim },
    });
    checks.push({
      id: "web_corroboration",
      label: "Contemporaneous web corroboration",
      intent: "WEB_SEARCH_GENERAL",
      params: { query: claim },
    });
  }
  if (checks.length === 0) {
    return BUILTIN_SCENARIOS["black-sea-grain"];
  }
  return {
    id: `custom-${Date.now()}`,
    title: "Custom Conflict & Macro Discrepancy Audit",
    route: "Route 2 (Reported-vs-Observed) + Route 3 (Research Priced per Fact)",
    customer: "Custom Analyst Query",
    reported_claim: {
      summary: claim || "Custom multi-source discrepancy check",
      expected_sanctions_matched: false,
      expected_congestion_max_hours: 18,
      expected_min_speed_knots: 8,
    },
    checks,
  };
}
