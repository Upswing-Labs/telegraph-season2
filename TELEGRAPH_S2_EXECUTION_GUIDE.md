# Telegraph Protocol Season II — Executive Execution Guide (`$7,000` Main Pool)

> **Status:** All 3 Tracks Built, Verified Locally (`22/22 PASS`), Verified Live Against `devnode.telegraphprotocol.com` & `upswing-solsignal.upswing-labs.workers.dev` (`2/2 LIVE PASS`), and Security-Audited (`scan_untrusted_code.py` -> **`CLEAN, exit=0`**).  
> **Deadline:** **December 1, 2026, 23:59 UTC** (provisional results from Dec 9, 2026; 72h appeal window).  
> **Reminder:** Nothing has been posted to GitHub (`/claim`) or submitted on `anjoman.ai` yet — execute the live checklist below once our dedicated Sepolia testnet wallet & Anjoman account are active.

---

## 1. Competitive Blue-Ocean Analysis (Live GitHub & Devnode Audit — 2026-11-23)

We queried all 62 open issues in `telegraphprotocol/bounties` (via authenticated GitHub API), all 40 pages of `anjoman.ai/docs`, the official Season II Rules (`anjoman.ai/dashboard/hackathon/season-2/rules`), and the live devnode (`https://devnode.telegraphprotocol.com/engine/v1/intents`, `/api/miners`, `/api/evalpool/status`, `/api/wasm`).

### Why Our 3-Track Selection Maximizes Prize EV Under Section 07

Under **Section 07 ("How delivery awards are chosen")**:
- **Apps & Agents (`8 × $225` delivery + `$700 / $350 / $150` excellence):** Judges select winning groups prioritizing *(1) most distinct completed missions*, *(2) most distinct accepted working apps*, and **(3) missions served by ONLY ONE qualifying entrant group!**
- **Miners / Providers (`4 × $300` delivery + `$500 / $300` excellence):** Judges prioritize *(1) most distinct commercial missions enabled*, *(2) most distinct H2 app workflows unblocked/improved*, *(3) most verified missing mission-critical Intent needs*.
- **Evaluators (`4 × $300` delivery + `$500 / $300` excellence):** Same priority order — *distinct commercial missions enabled*, *H2 app workflows unblocked*, *missing mission-critical evaluation coverage*, and *proven measurement improvement*.
- **Cross-track eligibility (Section 04):** One team can enter and win **Delivery + Excellence in ALL 3 TRACKS** (`up to $2,525+` across Tracks 01–03) as long as each track is a real, distinct technical contribution.

### Live Mission Competitor Matrix (Low-Comment Missions Audited 2026-11-23)

| Mission Issue | Total Comments | Active Apps & Agents Claims/Submissions | Active Providers / Evaluators | Strategic Verdict |
| --- | :---: | --- | --- | --- |
| **`#193` Mission 05 — Conflict Intelligence** | **11 (LOWEST)** | **0 Apps claimed or submitted on `#193`** *(note: `@a2taka-sourse` mentioned an escalation app on bug issues `#233`/`#234`, Route 1 only; Routes 2 & 3 have ZERO coverage)* | `@Bsh54` (Provider+Eval), `@fexx301` (Provider), `@zkasuran` (Eval, released) | **PRIMARY TARGET (TRACK 01)** — Highest single-entrant mission coverage bonus! |
| `#195` Mission 07 — Consumer Platform | 16 | 2 Apps (`@VishAlgoDev` Praman Desk, `@danielamodu` plumb) | `@Sireadell` (Eval) | Crowded on Apps |
| `#196` Mission 08 — Commodities | 24 | 1 App (`@Femtech-web` payment release gate) | `@fexx301`, `@nftkingiii` | Unblocked by our Track 03 port/vessel datasets! |
| `#197` Mission 09 — Personal Agent | 27 | **4 strong Apps** (`@cipoklean`, `@swiftbotlabs`, `@IamHarrie-Labs`, `@london160771`) | `@Bsh54` | Saturated on Apps |
| `#194` Mission 06 — Resources & Ag | 28 | 2 Apps (`@neromtoobad` Swarm Budget, `@Milliebanned` SecondSky) | `@fexx301`, `@Sireadell`, `@zkasuran` | Unblocked by our Track 03 port dataset! |
| `#203` Mission 15 — Consumer Automation | 29 | 2 Apps (`@swiftbotlabs`, `@london160771`) | `@Sireadell` | Covered |
| `#199` Mission 11 — Autonomous Systems | 30 | 3 Apps (`@VishAlgoDev`, `@neromtoobad`, `@Alike001`) | `@fexx301` | Crowded |

### Live Devnode Protocol & Supply Gaps Exploited (2026-11-23, Epoch 46)

| Track | Selected Intent(s) | Live Devnode State (2026-11-23) | Commercial Missions Enabled | Why This Wins |
| --- | --- | --- | --- | --- |
| **Track 01 (App)** | `SANCTIONS_SCREENING_MATCH_GENERAL`, `LIVE_PORT_CONGESTION_GENERAL`, `VESSEL_TELEMETRY_VERIFY_GENERAL`, `WEATHER_FORECAST_VERIFY_GENERAL`, `MACRO_ECONOMIC_INDICATOR_GENERAL`, `FACT_CHECK_GENERAL`, `WEB_SEARCH_GENERAL`, `MEDIA_FORENSIC_VERIFY_GENERAL`, `FX_NOW_EUR` | All 9 verified `active` with full V2 `request.params` + `response.fields` | **Mission 05 — Conflict Intelligence** (Routes 2 & 3) | **ZERO App claims on `#193`**; handles real bugs `#228`, `#232`, `#233`, `#234` defensively; separates observations from interpretation; never averages contradictions away! |
| **Track 02 (Miner)** | `LIQUIDITY_DEPTH_VERIFY_GENERAL`, `FRAUD_RISK_GENERAL`, `CRYPTO_PRICE_USD` | `LIQUIDITY_DEPTH_VERIFY_GENERAL` broken by incumbent Miner 501 (**Issue `#207`**: returns BNB `$28M` for Ethereum `$0` honeypot); ID `880401` & slug `upswing-solsignal-liquidity` verified **100% FREE** | **6 Missions:** 01 Exchange, 02 Stablecoin, 03 Institutional Markets, 09 Personal Agent, 13 Asset Management, 14 Web3 & DeFi | Wraps our LIVE production **Upswing SolSignal** (`upswing-solsignal.upswing-labs.workers.dev`), directly fixes `#207` via strict chain-matching + HTTP `422 chain_mismatch`, adds constant-product AMM dump stress tiers, keyless, `$0`-infra Workers deployable! |
| **Track 03 (Evaluator)** | `LIVE_PORT_CONGESTION_GENERAL` (**`0/3` empty!**), `VESSEL_TELEMETRY_VERIFY_GENERAL` (**`1/3`, 1 row!**), `FRAUD_RISK_GENERAL` (**`1/3`!**), `LIQUIDITY_DEPTH_VERIFY_GENERAL` (`7/3`, `GENERIC` fallback!), `CRYPTO_PRICE_USD` (deterministic truth source) | 3 mission-critical pools blocked below `min_submitters=3`; 4 judgment intents still scored by `GENERIC` fallback | **8 Missions:** 01, 02, 03, 05, 06, 08, 13, 14 | 240 attested preference pairs + 2 keyless truth sources passing **all 8 quality gates** + exact V2 `lora-v1` Stage-1 verifier/packager + V2 Batch Runnable Executor (`check-executor.ts` parity) + EIP-191 upload CLI! |

---

## 2. Live Protocol Facts & Known Pitfalls Verified (Save Hours of Debugging!)

1. **New Sepolia Diamond (deployed Nov 17, 2026):**
   - Diamond: `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` (Chain ID `11155111`, RPC `https://ethereum-sepolia-rpc.publicnode.com`)
   - Test USDC (6 decimals, public `mint(address,uint256)`): `0xcc194e1a843B658526D0D5C431f670028582Ae17`
   - **NO MACHINA needed on this Diamond!** Miner bond is currently `0`; Evaluator Adapter bond was lowered to **`0.10` test USDC** (`100000` units) on 2026-11-23 (check `entityBonds()` on-chain before approving).
2. **Use `escrow` rail (`X-PAYMENT` EIP-191) or Anjoman API Key — NOT `x402 exact`:**
   - Issues `#214` & `#215` confirmed `facilitator.x402.rs/settle` timeouts on `exact`. Our `shared/telegraph_client.mjs` defaults to **Sepolia `escrow`** (zero facilitator dependency, verified LIVE against devnode!) with **Anjoman API Key** (`https://backend.telegraphprotocol.com`) as Rail B.
   - Issue `#232`: After calling `depositUSDC(...)`, `/v1/ledger/account/{addr}` shows `available` immediately, but the ask engine may wait up to one epoch ledger root (~15–60 min) before spending it. Deposit early before running live proofs!
3. **Validator API & Retired Evaluator Formats:**
   - `POST https://anjoman.ai/dashboard/validate` returns `404` (documented limitation). Use our local `npm run miner:validate`, `anjoman.ai/dashboard/earn`, and `cast call` dry-run + `GET /api/miners/{registrationId}` after registration.
   - **Comparator `.wasm`, MiniLM `rank_answer`, Q32.32, and 600 MB full-model `.wasm` adapters are ALL RETIRED & REJECTED.** Only **Evaluation Material** (`POST /api/evalpool/submissions`) and **V2 `lora-v1` safetensors delta packages** on `modernbert-base-lora16-v1` (`foundation_hash: 0a49b325304bb4cf292e683929689d0457966be264f60bfc94d0072b614bf8e6`, `tokenizer_hash: 67bc76f8b9386efba1a761c1c8e5ad439fd0eaf1c2826e9dd1a205c7af4dc456`) are accepted.
   - **Issue `#223` Workaround (ModernBERT Tokenizer Hash Mismatch):** HuggingFace `answerdotai/ModernBERT-base` downloads a `tokenizer.json` hashing to `9fd55248...`, while the node requires `67bc76f8...` (identical token IDs, different JSON byte formatting). When running `telegraph-wasm-baseline/float_runtime/export_adapter.py`, download the pinned `tokenizer.json` from the `modernbert-base-lora16-v1` GitHub release and pass `--tokenizer-sha256` / replace `runs/<INTENT>/result.json`'s recorded `tokenizer_sha256` after verifying token-ID parity on `tokenizer_vectors.json`.
4. **Mandatory Section 05 Entry Requirement:**
   - **Star `https://github.com/telegraphprotocol/bounties`** from the GitHub account linked to the `Upswing-Labs` organization submitting the hackathon form!

---

## 3. Exact Step-by-Step Live Testnet Execution Playbook

### Phase A — Account, Star & Dedicated Sepolia Testnet Wallet Setup (5 min)
1. Star `https://github.com/telegraphprotocol/bounties` from the submitting GitHub account (already completed).
2. Sign in at `https://anjoman.ai` and claim testnet funds at `https://anjoman.ai/dashboard/faucet` (and optionally create an API key at `https://anjoman.ai/dashboard/api-keys`).
3. Create a **dedicated testnet-only Sepolia wallet** (NEVER reuse any mainnet key!), fund it with `~0.02 Sepolia ETH`, then mint & deposit `10 test USDC` into the Nov 17 Diamond:

```bash
export RPC="https://ethereum-sepolia-rpc.publicnode.com"
export DIAMOND="0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b"
export USDC="0xcc194e1a843B658526D0D5C431f670028582Ae17"
export TELEGRAPH_PRIVATE_KEY="0x<YOUR_DEDICATED_SEPOLIA_TESTNET_KEY>"
export MY_ADDR=$(cast wallet address --private-key "$TELEGRAPH_PRIVATE_KEY")

# 1. Mint 20 test USDC (20,000,000 in 6 decimals)
cast send "$USDC" "mint(address,uint256)" "$MY_ADDR" 20000000 --rpc-url "$RPC" --private-key "$TELEGRAPH_PRIVATE_KEY"

# 2. Approve & deposit 10 test USDC into Sepolia Escrow (exact amount — never unlimited)
cast send "$USDC" "approve(address,uint256)" "$DIAMOND" 10000000 --rpc-url "$RPC" --private-key "$TELEGRAPH_PRIVATE_KEY"
cast send "$DIAMOND" "depositUSDC(uint256)" 10000000 --rpc-url "$RPC" --private-key "$TELEGRAPH_PRIVATE_KEY"

# 3. Verify escrow balance (wait for active ledger root if #232 lag applies)
node track1_factgap_app/cli.mjs balance
```

### Phase B — Track 01 Live Paid Runs & Receipt Capture (Mission 05 — FactGap)

```bash
cd products/telegraph_season2

# Run Mission 05 live paid dossier over Ethereum Sepolia Escrow (capped at $0.12)
node track1_factgap_app/cli.mjs run --scenario black-sea-grain --mode escrow --cap-usd 0.12 --json > evidence_track1_black_sea.json
node track1_factgap_app/cli.mjs run --scenario sanctioned-crude-tanker --mode escrow --cap-usd 0.10 --json > evidence_track1_tanker.json

# Or run using Anjoman API key
export TELEGRAPH_API_KEY="anjoman_<YOUR_KEY>"
node track1_factgap_app/cli.mjs run --scenario red-sea-chokepoint --mode api_key --cap-usd 0.08 --json > evidence_track1_red_sea.json

# After epoch closes (~1h on testnet), verify Merkle delivery proof for any receipt_hash:
node track1_factgap_app/cli.mjs verify-receipt --epoch <EPOCH_ID> --receipt <RECEIPT_HASH>
```

### Phase C — Track 02 Live Deployment & On-Chain Miner Registration (`upswing-solsignal-liquidity`, ID `880401`)

1. Deploy `track2_solsignal_miner/worker.mjs` to Cloudflare Workers (`upswing-solsignal-miner.upswing-labs.workers.dev`) — `$0` Free Tier!
2. Host `track2_solsignal_miner/miner.yaml` unchanged at a public HTTPS URL (e.g., raw GitHub commit permalink or `https://upswing-solsignal-miner.upswing-labs.workers.dev/miner.yaml`).
3. Verify `SHA-256` hash & run free dry-run + on-chain `registerMiner`:

```bash
cd products/telegraph_season2
npm run miner:validate

export YAML_URL="https://upswing-solsignal-miner.upswing-labs.workers.dev/miner.yaml"
export YAML_HASH="0x17c7bd0cc7951ee77eb2514730183349deba433160252d008632d957e1c6f67b"
export FEE_ADDRESS="$MY_ADDR"

# 1. Free dry-run (returns expected registrationId or revert reason)
cast call "$DIAMOND" \
  "registerMiner(string,bytes32,address,uint256,string[])(uint256)" \
  "$YAML_URL" "$YAML_HASH" "$FEE_ADDRESS" 10000 \
  '["LIQUIDITY_DEPTH_VERIFY_GENERAL","FRAUD_RISK_GENERAL","CRYPTO_PRICE_USD"]' \
  --from "$MY_ADDR" --rpc-url "$RPC"

# 2. Register on Sepolia Diamond
cast send "$DIAMOND" \
  "registerMiner(string,bytes32,address,uint256,string[])" \
  "$YAML_URL" "$YAML_HASH" "$FEE_ADDRESS" 10000 \
  '["LIQUIDITY_DEPTH_VERIFY_GENERAL","FRAUD_RISK_GENERAL","CRYPTO_PRICE_USD"]' \
  --rpc-url "$RPC" --private-key "$TELEGRAPH_PRIVATE_KEY"

# 3. Wait ~10–15 min (Sepolia safe block) and confirm activation_status == "active"
curl -s "https://devnode.telegraphprotocol.com/api/miners/<REGISTRATION_ID>"
```

### Phase D — Track 03 Live Signed Eval-Pool Uploads & Optional `lora-v1` Adapter Registration

```bash
cd products/telegraph_season2

# 1. Verify all 5 datasets pass all 8 local quality gates first
npm run eval:gate

# 2. Sign & upload all 5 datasets (ZERO fee / ZERO bond required!)
node track3_evalforge/evalpool_submit.mjs --intent LIVE_PORT_CONGESTION_GENERAL    --file track3_evalforge/datasets/live_port_congestion_general.jsonl --live
node track3_evalforge/evalpool_submit.mjs --intent VESSEL_TELEMETRY_VERIFY_GENERAL --file track3_evalforge/datasets/vessel_telemetry_verify_general.jsonl --live
node track3_evalforge/evalpool_submit.mjs --intent FRAUD_RISK_GENERAL              --file track3_evalforge/datasets/fraud_risk_general.jsonl --live
node track3_evalforge/evalpool_submit.mjs --intent LIQUIDITY_DEPTH_VERIFY_GENERAL  --file track3_evalforge/datasets/liquidity_depth_verify_general.jsonl --live
node track3_evalforge/evalpool_submit.mjs --intent CRYPTO_PRICE_USD                --file track3_evalforge/datasets/crypto_price_usd_truth_source.jsonl --live

# 3. Confirm admitted -> eligible status on devnode (freezes at next hourly epoch rollover)
curl -s "https://devnode.telegraphprotocol.com/api/evalpool/submissions/mine?submitter=$MY_ADDR"
```

#### Optional GPU Training & On-Chain `lora-v1` Adapter Registration (`LIQUIDITY_DEPTH_VERIFY` family)
If running a GPU instance (`telegraph-wasm-baseline`) to also register a live `lora-v1` delta on `LIQUIDITY_DEPTH_VERIFY` (currently `GENERIC` fallback, `7/3` submitters, `467` eligible rows ready for immediate competition!):
1. Clone `https://github.com/telegraphprotocol/telegraph-wasm-baseline` and download `foundation.json`, `foundation_lora_fp32.onnx`, `foundation_engine.wasm`, and pinned `tokenizer.json` from `telegraph-foundation` release `modernbert-base-lora16-v1`.
2. Train on `datasets/liquidity_depth_verify_general.jsonl` (+ additional public pairs) with `python -m float_runtime.train_adapter --intent LIQUIDITY_DEPTH_VERIFY --data liquidity_depth_verify_general.jsonl --out runs/LIQUIDITY_DEPTH_VERIFY`.
3. Apply `#223` workaround (verify token-ID parity and pin `tokenizer_sha256` to `67bc76f8b9386efba1a761c1c8e5ad439fd0eaf1c2826e9dd1a205c7af4dc456`), export with `export_adapter`, check with `adapterbuild lora` (and our `validateLoraPackageStage1`), host `.safetensors` + `cmd/adapterexec` on a 5 GB+ RAM HTTPS host, approve `0.10` test USDC bond (`entityBonds()`), and call `registerWasm(wasmHash, wasmUrl, "LIQUIDITY_DEPTH_VERIFY", feeAddress, runnableUrl)`.

---

## 4. Ready-to-Post GitHub Coordination Comments (DO NOT POST UNTIL LIVE WALLET/REPO READY!)

> **Workflow rule (`bounties` bot):** Post `/claim` by itself on the first line (or as its own comment) so the GitHub Action bot records the claim cleanly, THEN post `/progress` (at least once every 72h, and on **3+ separate dates** before Dec 1 to earn the 20/100 organic growth points!).

### 4A. Ready-to-Post on Issue `#193` (Mission 05 — Conflict Intelligence: Track 01 App + Track 03 Evaluator)

**Comment 1 (Claim):**
```text
/claim
```

**Comment 2 (Initial Scope & Progress — post immediately after bot confirms claim):**
```text
/progress

Scope: Upswing FactGap — Reported-vs-Observed Discrepancy & Priced-Per-Fact Intelligence Desk for systematic macro & commodities risk desks (Mission 05 Routes 2 & 3), paired with EvalForge attested evaluation datasets unblocking `LIVE_PORT_CONGESTION_GENERAL` (0/3 pool) and `VESSEL_TELEMETRY_VERIFY_GENERAL` (1/3 pool).
Track(s): Apps & Agents (Track 01) + Evaluators (Track 03 — distinct contribution)
Working on:
- Track 01 App (`upswing-factgap`): CLI, Web UI, and Streamable HTTP MCP server purchasing canonical Telegraph V2 intents (`LIVE_PORT_CONGESTION_GENERAL`, `VESSEL_TELEMETRY_VERIFY_GENERAL`, `SANCTIONS_SCREENING_MATCH_GENERAL`, `WEATHER_FORECAST_VERIFY_GENERAL`, `MACRO_ECONOMIC_INDICATOR_GENERAL`, `FACT_CHECK_GENERAL`, `WEB_SEARCH_GENERAL`, `MEDIA_FORENSIC_VERIFY_GENERAL`, `FX_NOW_EUR`) via Sepolia Escrow (`X-PAYMENT` EIP-191) and Anjoman API Key, with atomic USDC spend caps, TTL cache reuse, contradiction visibility (never averaged away), and defensive guards for #228/#233/#234.
- Track 03 Evaluator (`upswing-evalforge`): 60 attested preference pairs for `LIVE_PORT_CONGESTION_GENERAL` + 60 for `VESSEL_TELEMETRY_VERIFY_GENERAL` passing all 6 Adapter Kit dataset quality gates (length 0.50, surface-style 0.556, 0 near-duplicates, 100% attested public `https://` provenance).
Approach: Zero-dependency Node 20+/24+ codebase so any reviewer can reproduce offline (`npm test`: 22/22 pass) or live on Sepolia testnet in <2 minutes.
Current state: Built, 22/22 automated tests passing, EIP-191 Escrow signing live-verified on `devnode.telegraphprotocol.com`; moving next to funded Sepolia paid dossier runs and live eval-pool uploads.
Proof or next milestone: Public repo + live Sepolia receipt hashes & eval-pool admission readbacks within 48h.
```

### 4B. Ready-to-Post on Issue `#202` (Mission 14 — Web3 Native & DeFi: Track 02 Miner + Track 03 Evaluator)

**Comment 1 (Claim):**
```text
/claim
```

**Comment 2 (Progress — Track 02 Provider + Track 03 Evaluator):**
```text
/progress

Scope: Upswing SolSignal Telegraph Miner (`id: 880401`, `slug: upswing-solsignal-liquidity`) — live multi-chain DEX liquidity verifier fixing #207 cross-chain hallucinations, Solana/EVM fraud-risk oracle wrapping our live production Upswing SolSignal engine, and median crypto spot price feed; plus Track 03 EvalForge datasets & V2 `lora-v1` validation/executor tooling.
Track(s): Miners / Providers (Track 02) + Evaluators (Track 03 — distinct contribution)
Working on:
- Track 02 Provider: `LIQUIDITY_DEPTH_VERIFY_GENERAL` (strict chain-matching via DexScreener + constant-product AMM `$5k/$25k/$100k` dump stress tiers; refuses cross-chain substitution with HTTP `422 chain_mismatch`), `FRAUD_RISK_GENERAL` (wrapping `https://upswing-solsignal.upswing-labs.workers.dev` for Solana SPL + DexScreener EVM microstructure), `CRYPTO_PRICE_USD` (keyless Coinbase + Kraken median).
- Track 03 Evaluator: 60 attested preference pairs for `LIQUIDITY_DEPTH_VERIFY_GENERAL` (catching #207 wrong-chain & reserve-sum/FDV errors), 60 balanced pairs for `FRAUD_RISK_GENERAL` (unblocking 1/3 pool), 2 keyless truth sources for `CRYPTO_PRICE_USD`, plus V2 `lora-v1` Stage-1 package validator & batch runnable executor.
Current state: Built, `miner.yaml` passes 100% V2 schema/request-contract checks (0 errors, 0 warnings), 22/22 unit tests + live DexScreener/SolSignal/Coinbase integration tests passing.
Proof or next milestone: Cloudflare Worker deploy + Sepolia Diamond `registerMiner` transaction & registrationId + live eval-pool upload receipts within 48h.
```

### 4C. 20-Point Organic Growth & Developer Activation Schedule (Nov 24 – Dec 1)
To capture maximum Section 06 growth points (requires **3+ meaningful original progress updates on separate dates** + real developer walkthrough + disclosure):
- **Date 1 (Nov 24):** Publish repo + technical breakdown thread on X tagging `@Telegraphprotoc` (disclosing Season II hackathon participation & prize incentive!) covering how we built zero-dependency EIP-191 Sepolia Escrow + fixed Issue `#207` cross-chain pool hallucinations.
- **Date 2 (Nov 26):** Post Update 2 with live Sepolia paid receipts, Merkle delivery proofs, live Miner `880401` registrationId & benchmark results, and live EvalPool `eligible` readbacks (share in Telegraph Discord + GitHub `#193`/`#202`/`#207`).
- **Date 3 (Nov 29):** Post 3-minute walkthrough video + invite external builders on `#193`/`#202`/`#207` (e.g., RugReceipt author on `#207`!) to test our live keyless `/v1/liquidity` endpoint and reproduce `npm test` + `factgap` CLI, documenting real third-party feedback before final Dec 1 submission at `https://anjoman.ai/dashboard/hackathon`.

---

## 5. Automated Verification & Security Audit Results (2026-11-23)

### 5.1 Unit & Integration Test Suite (`npm test` — `22/22 PASS`, `1.12s`)

| Suite | Tests | Result | Key Verifications |
| --- | :---: | :---: | --- |
| `tests/shared_crypto.test.mjs` | 6 | **6/6 PASS** | Official Ethereum Keccak-256 vectors (`0x01`), Foundry account #0 secp256k1 derivation, RFC 6979 EIP-191 `personalSign`/`ecrecover`, `buildEscrowPaymentHeader` `X-PAYMENT` envelope, `validateIntentParams`, `SpendBudgetGuard` caps & circuit breaker |
| `tests/track1_factgap.test.mjs` | 5 | **5/5 PASS** | Mission 05 Black Sea Corridor receipts/contradictions/`$0` TTL cache reuse, `#234` null `FACT_CHECK` & `#233` `openai` `cost_usd=0` guards, stale AIS exclusion & manipulated media, tight cap halt & publish authorization gate, live Web UI + CSP nonce + REST API + MCP JSON-RPC 2.0 |
| `tests/track2_miner.test.mjs` | 5 | **5/5 PASS** | `miner.yaml` 0 errors / 0 warnings (`sha256: 0x17c7bd...`), negative V2 YAML rejection tests, **Issue `#207` cross-chain BNB `$28M` refusal (`422 chain_mismatch`)**, HTTP Server + AMM dump stress math + SolSignal fraud-risk + Coinbase/Kraken median + TTL cache, `#208` Go-map `optional=map[...]` query decoder |
| `tests/track3_evaluator.test.mjs` | 6 | **6/6 PASS** | All 5 datasets passing all 8 quality gates, negative poisoned-dataset detection, `>= 90%` pairwise discrimination across all 4 judgment datasets, V2 `lora-v1` 178-tensor Stage-1 validator + all rejection codes, live Batch Runnable Executor (`check-executor.ts` parity), Eval-Pool EIP-191 5-line signing |

### 5.2 Live Real-Network Integration Tests (`npm run test:live` — `2/2 PASS`, `4.37s`)
- **`LIVE devnode: pure-JS EIP-191 Escrow X-PAYMENT signature verifies on real Sepolia devnode`:** **PASS (`2.17s`)** — Live `https://devnode.telegraphprotocol.com/engine/v1/ask` returned exact `402 insufficient escrow for delivery` on a fresh ephemeral zero-balance key, proving live production validator cryptographic signature acceptance!
- **`LIVE SolSignal Miner: real DexScreener + live Upswing SolSignal + Coinbase/Kraken`:** **PASS (`2.10s`)** — Live Solana Raydium SOL/USDC pool depth, live `#207` Ethereum honeypot check, live `https://upswing-solsignal.upswing-labs.workers.dev` JUP risk score, and live Coinbase+Kraken BTC spot median all passed!

### 5.3 Track 03 Dataset Quality Gates & Discrimination Benchmarks

| Dataset | Rows | Unique Rej (`>=0.80`) | Max Repeat (`<=0.02`) | Length Acc (`<=0.65`) | Surface Style (`<=0.65`) | Near-Dup (`==0`) | Attested (`==1.0`) | Domain Evaluator Win Rate (`>=0.70`) |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `liquidity_depth_verify_general.jsonl` | 60 | `1.0000` | `0.0167` | `0.5000` | `0.4444` | `0` | `1.0000` | **100.0% (60/60)** |
| `live_port_congestion_general.jsonl` | 60 | `1.0000` | `0.0167` | `0.5000` | `0.5556` | `0` | `1.0000` | **100.0% (60/60)** |
| `fraud_risk_general.jsonl` | 60 | `1.0000` | `0.0167` | `0.5000` | `0.5556` | `0` | `1.0000` | **90.0% (54/60, 0 loss)** |
| `vessel_telemetry_verify_general.jsonl` | 60 | `1.0000` | `0.0167` | `0.5000` | `0.5556` | `0` | `1.0000` | **100.0% (60/60)** |
| `crypto_price_usd_truth_source.jsonl` | 2 | N/A (`truth_source`) | — | — | — | — | Keyless HTTPS | **100% Schema Valid** |

### 5.4 Static Anti-Honeypot Security Scan (`scripts/scan_untrusted_code.py`)
- **Verdict:** **`CLEAN (exit=0)`** — `CRITICAL: 0 | WARN: 0` across all files, zero hardcoded secrets or private keys.
