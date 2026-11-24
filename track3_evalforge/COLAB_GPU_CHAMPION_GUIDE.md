# Guia Rápido (4 Passos) — Treino GPU de Adaptadores LoRA Campeões no Google Colab

Este guia gera adaptadores LoRA **`modernbert-base-lora16-v1`** (`.safetensors`, 178 tensores F32, validados no Stage-1 e com fix automático do **Bug `#223`** do tokenizer ModernBERT) para o **Telegraph Protocol Season II — Track 03** (`$300` Delivery + `$500` Excellence = **`$800`**, encerramento em 1º de dez/2026).

### Alvos Sem Campeão (`champion: null`) Prontos Agora na Devnode (Época 47)
| Família (`register_on`) | Classe | Submissores Elegíveis | Linhas Elegíveis | Campeão Atual | Sinergia Upswing-Labs |
|---|---|---:|---:|---|---|
| **`LIQUIDITY_DEPTH_VERIFY`** *(padrão)* | `judgment` | **8 / 3** | **527** | `null` | Missões 01/02/03/09/13/14 + Track 02 Miner |
| **`MACRO_ECONOMIC_INDICATOR`** | `judgment` | **6 / 3** | **531** | `null` | Missões 03/05/06/08/13 + Track 01 FactGap |
| **`FACT_CHECK`** | `judgment` | **4 / 3** | **474** | `null` | Missões 05/07 + Track 01 FactGap |

---

## Passo 1 — Subir o Notebook no Google Colab
1. Acesse **`https://colab.research.google.com`**.
2. Clique em **`Arquivo` -> `Fazer upload de notebook`** (ou aba **`Upload`** na janela inicial).
3. Selecione o arquivo local:
   ```text
   c:\LFC1\SURVIVOR-UPSWING\products\telegraph_season2\track3_evalforge\Upswing_Telegraph_LoRA_Champion_Colab.ipynb
   ```

## Passo 2 — Ativar GPU (`T4` / `L4` / `A100`)
1. No menu superior do Colab, clique em **`Ambiente de execução` -> `Alterar o tipo de ambiente de execução`** (`Runtime -> Change runtime type`).
2. Em **Acelerador de hardware**, escolha **`GPU`** (**`T4`** no plano gratuito, ou **`L4` / `A100`** se tiver Colab Pro — a Célula 1 detecta sua GPU e ajusta `batch_size`, `grad_accum` e `bf16/fp16` automaticamente!).
3. Clique em **`Salvar`**.

## Passo 3 — Escolher 1 ou 3 Campeões e Clicar em `Executar tudo`
1. Na **Célula 1**, escolha o preset no menu dropdown `TRAIN_PRESET`:
   - **`LIQUIDITY_ONLY`** *(padrão)*: treina **`LIQUIDITY_DEPTH_VERIFY`** (com sweep `r=8` vs `r=16`, ~5 min na A100/L4 ou ~10 min na T4).
   - **`ALL_THREE_CHAMPIONS`**: treina os **3 campeões** (`LIQUIDITY_DEPTH_VERIFY`, `MACRO_ECONOMIC_INDICATOR` e `FACT_CHECK`) em sequência numa única sessão (~15–25 min).
   - *(Opcional)* Se quiser rodar também a checagem bit-a-bit em WASM real (`cmd/adapterbuild lora` com os 599 MB do `foundation_lora_fp32.onnx`), marque `VERIFY_ON_WASM_FOUNDATION = True`.
2. Clique em **`Ambiente de execução` -> `Executar tudo`** (`Ctrl+F9`).
3. Aguarde todas as 6 células ficarem verdes. O notebook faz tudo sozinho:
   - Clona `telegraphprotocol/telegraph-wasm-baseline` e aplica automaticamente o fix do **Bug `#223`** (`tokenizer.json` oficial `67bc76f8...` + correção do `NameError` em `train_adapter.py:838`).
   - Gera **600 pares por família** sem atalhos (passando nos 6 gates oficiais do Telegraph Dataset Gate com `surface_probe <= 50%` e `leakage = 0%`).
   - Treina ModernBERT-base LoRA com early stopping, seleciona o melhor checkpoint, exporta via `float_runtime.export_adapter` oficial e valida os 178 tensores F32 + `keccak256` (`wasmHash`).

## Passo 4 — Salvar os Arquivos Baixados para Registro Imediato
Ao final da **Célula 6**, o navegador vai baixar automaticamente:
1. `LIQUIDITY_DEPTH_VERIFY_upswing_champion.safetensors` *(e os demais `.safetensors` se escolheu `ALL_THREE_CHAMPIONS`)*
2. `training_evidence.json` *(métricas held-out, margens, hashes e parâmetros exatos do `registerWasm`)*
3. `upswing_telegraph_lora_champions_bundle.zip` *(pacote completo + pasta pronta `adapterexec_deploy/` com `Dockerfile`, `fly.toml`, `render.yaml`, `run_local_cloudflare_tunnel.sh` e `verify_executor.py`)*

**Mova os arquivos baixados para:**
```text
c:\LFC1\SURVIVOR-UPSWING\products\telegraph_season2\track3_evalforge\trained_adapters\
```
E nos avise no chat! A partir daí nós:
1. Publicamos o `.safetensors` em URL HTTPS imutável (`wasmUrl`).
2. Subimos o executor bit-a-bit oficial `cmd/adapterexec` (`adapterexec_deploy/` — **obrigatório** para evitar erro de `remote score mismatch` como o que reprovou o registro `#203` na devnode!).
3. Verificamos o contrato com `verify_executor.py` e executamos `registerWasm(wasmHash, wasmUrl, intent, feeAddress, runnableUrl)` na Sepolia (`0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`), acompanhando a promoção a **Rank #1 Campeão** em `https://anjoman.ai/dashboard/eval`.

---

### Notas Rápidas de Diagnóstico
- **Download bloqueado pelo navegador no Colab?** Clique no ícone de pasta à esquerda do Colab -> `/content/work/exports/` -> clique com botão direito em `upswing_telegraph_lora_champions_bundle.zip` -> **Fazer download**.
- **Sem GPU alocada (aviso `CPU-only` na Célula 1)?** Volte ao Passo 2 e confirme `GPU` em *Alterar o tipo de ambiente de execução* antes de executar a Célula 4.
- **Hashes oficiais verificados automaticamente (não precisa alterar nada):**
  - `foundation_hash`: `0a49b325304bb4cf292e683929689d0457966be264f60bfc94d0072b614bf8e6`
  - `engine_wasm_hash`: `77643d6e1176ab8744801cef93ccb844d0136ed32b8daa865d541f37d13292de`
  - `tokenizer_hash`: `67bc76f8b9386efba1a761c1c8e5ad439fd0eaf1c2826e9dd1a205c7af4dc456`
