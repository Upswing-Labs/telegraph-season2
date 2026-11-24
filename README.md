# Upswing Labs — Telegraph Protocol Season II (3-Track Suite)

Zero-dependency, independently runnable **Node 20+/24+** engineering suite built natively for **Telegraph Protocol V2** (Ethereum Sepolia Diamond `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`, `https://devnode.telegraphprotocol.com`, and Anjoman API `https://backend.telegraphprotocol.com`).

Every track is a distinct, self-contained technical contribution:

1. **Track 01 — Apps & Agents (`track1_factgap_app/`)**: **Upswing FactGap** for **Mission 05 — Conflict Intelligence (Routes 2 & 3)**.
   - Reported-vs-Observed Discrepancy & Priced-Per-Fact Intelligence Desk (CLI + dark-mode Web UI + JSON-RPC 2.0 Streamable HTTP MCP Server at `POST /mcp`).
   - Purchases live canonical Telegraph intents (`SANCTIONS_SCREENING_MATCH_GENERAL`, `LIVE_PORT_CONGESTION_GENERAL`, `VESSEL_TELEMETRY_VERIFY_GENERAL`, `WEATHER_FORECAST_VERIFY_GENERAL`, `MACRO_ECONOMIC_INDICATOR_GENERAL`, `FACT_CHECK_GENERAL`, `WEB_SEARCH_GENERAL`, `MEDIA_FORENSIC_VERIFY_GENERAL`, `FX_NOW_EUR`) over **Ethereum Sepolia Escrow (`X-PAYMENT` EIP-191)** or **Anjoman API Key**, with a clearly labelled `SIMULATED_TEST_FIXTURE` mode for zero-setup offline evaluation.
   - Enforces atomic per-call/per-run/daily USDC budget caps, TTL cache reuse (`$0.00` repeat reads), explicit authorization before external publication, and adversarial guards for real Telegraph defects (`#228` settled-on-error accounting, `#233` `miner_id="openai"` `cost_usd=0` guard, `#234` null schema-shaped `FACT_CHECK` refusal, stale AIS exclusion).

2. **Track 02 — Miners / Providers (`track2_solsignal_miner/`)**: **Upswing SolSignal Multi-Chain Liquidity & Risk Oracle** (Miner ID `880401`, slug `upswing-solsignal-liquidity`).
   - Wraps our live production **[Upswing SolSignal](https://upswing-solsignal.upswing-labs.workers.dev)** engine + multi-chain DexScreener + Coinbase/Kraken feeds to serve **3 active canonical intents** across **6 commercial missions**:
     - `LIQUIDITY_DEPTH_VERIFY_GENERAL` (`GET /v1/liquidity`) — strictly enforces chain matching and refuses cross-chain substitutions with HTTP `422 chain_mismatch` (directly resolving live GitHub Issue `#207`), plus constant-product AMM sell-shock tiers (`$5k / $25k / $100k`).
     - `FRAUD_RISK_GENERAL` (`GET /v1/fraud-risk`) — Solana SPL rug/honeypot/AMM-dump risk via Upswing SolSignal + EVM microstructure scoring, refusing unsupported free-text subjects with HTTP `422`.
     - `CRYPTO_PRICE_USD` (`GET /v1/crypto-price`) — deterministic median spot price across keyless Coinbase + Kraken feeds.
   - Ships with a 100% Telegraph V2 compliant `miner.yaml` (zero `additionalProperties`, full `intent_mapping`), local Stage-1 YAML validator (`yaml_validator.mjs`), standalone Node server (`server.mjs`), and Cloudflare Workers entrypoint (`worker.mjs`).

3. **Track 03 — Evaluators (`track3_evalforge/`)**: **Upswing EvalForge** — Attested Datasets + 6-Gate Quality Auditor + V2 `lora-v1` Adapter Validator & Batch Runnable Executor.
   - **240 attested preference pairs** (60 each across `LIQUIDITY_DEPTH_VERIFY_GENERAL`, `LIVE_PORT_CONGESTION_GENERAL` [unblocking the `0/3` empty Mission 05/06/08 pool], `FRAUD_RISK_GENERAL` [`1/3` pool], and `VESSEL_TELEMETRY_VERIFY_GENERAL` [`1/3` pool]) + **2 keyless HTTPS `truth_source` rows** for `CRYPTO_PRICE_USD`.
   - Every dataset passes all 6 official Telegraph Adapter Kit quality gates + Eval-Pool checks (100% unique rejected answers, `1.67%` max repeat `<= 2%`, `50.0%` length heuristic `<= 65%`, `0%` held-out leakage, `44%–56%` prompt-blind surface-style accuracy `<= 65%`, `0` near-duplicate prompts, `100%` attested `https://` provenance).
   - Exact V2 `lora-v1` safetensors Stage-1 parser/validator (178 F32 ModernBERT-base tensors, pinned `foundation_hash` & `tokenizer_hash`, Ethereum Keccak-256 `wasmHash`), Batch Runnable Executor (`POST /runnable` matching `check-executor.ts`), and EIP-191 Eval-Pool submission CLI (`evalpool_submit.mjs`).

## Quick Start (Zero `npm install` Needed on Node 20+/24+)

```bash
# 1. Run all 22 automated unit & integration tests across all 3 tracks
npm test

# 2. Run live network verification (verifies EIP-191 Escrow sig on devnode + live SolSignal/DexScreener)
npm run test:live

# 3. Run Track 01 FactGap CLI (offline simulation fixture — clearly labelled)
node track1_factgap_app/cli.mjs run --scenario black-sea-grain --mode simulated
node track1_factgap_app/cli.mjs run --scenario failure-empty-verdict --mode simulated

# 4. Launch Track 01 FactGap Web UI + MCP Server (http://127.0.0.1:8781)
npm run app:web

# 5. Validate Track 02 Miner YAML & print exact SHA-256 + cast registration commands
npm run miner:validate

# 6. Launch Track 02 SolSignal Miner HTTP Server (http://127.0.0.1:8782)
npm run miner:serve

# 7. Audit all 5 Track 03 Evaluation Datasets against all 8 quality gates
npm run eval:gate

# 8. Dry-run Track 03 EIP-191 signed Eval-Pool submission
node track3_evalforge/evalpool_submit.mjs \
  --intent LIVE_PORT_CONGESTION_GENERAL \
  --file track3_evalforge/datasets/live_port_congestion_general.jsonl \
  --dry-run
```

## Live Testnet Configuration (No Hardcoded Secrets)

Set environment variables locally when moving from `SIMULATED_TEST_FIXTURE` to live Ethereum Sepolia testnet:

- `TELEGRAPH_PRIVATE_KEY` — Dedicated testnet-only Sepolia private key (funded with Sepolia ETH + test USDC `0xcc194e1a843B658526D0D5C431f670028582Ae17` deposited to Diamond `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`).
- `TELEGRAPH_API_KEY` — Optional Anjoman API key (`anjoman_...`) for `https://backend.telegraphprotocol.com` (`--mode api_key`).

See `TELEGRAPH_S2_EXECUTION_GUIDE.md` for full live registration, eval-pool upload, and submission steps.
