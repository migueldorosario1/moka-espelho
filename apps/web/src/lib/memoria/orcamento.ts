/**
 * MOKA MEMÓRIA — orçamento de tokens p/ tarefas GRANDES (DSC-018).
 *
 * Regra do Miguel: estimativa SÓ p/ tarefas grandes (traduzir livro inteiro,
 * jogar conteúdo grande na memória). Tarefa pequena = direto, sem burocracia.
 *
 * Fluxo: estimativa ANTES (tokens + US$ pela tabela oficial de preços do
 * app) → confirmação FORTE ("tem certeza?") → executa → recibo REAL
 * (usage reportado pelo provedor) → resultado entra AUTOMATICAMENTE na
 * memória (avisa "foi colocado na memória", não pergunta de novo).
 */

import { LLM_PRICES, custo, usd, type LlmPrice } from "../llm-prices";

/** Estimativa grosseira honesta: latinos ~4 chars/token; CJK ~1,5 chars/token. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const ratio = cjk / text.length;
  const perChar = ratio > 0.2 ? 1.5 : 4;
  return Math.ceil(text.length / perChar);
}

/**
 * Casa o modelo ativo do BYOK (config) com o ranking oficial de preços.
 * Heurística por família + tier; fallback = DeepSeek Flash (best value).
 */
export function matchPrice(model?: string): LlmPrice {
  const m = (model ?? "").toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => m.includes(n));
  const pick = (pred: (p: LlmPrice) => boolean) =>
    LLM_PRICES.find(pred) ?? LLM_PRICES[1];

  if (has("opus")) return pick((p) => p.modelo.includes("Opus"));
  if (has("sonnet")) return pick((p) => p.modelo.includes("Sonnet"));
  if (has("haiku")) return pick((p) => p.modelo.includes("Haiku"));
  if (has("gpt-5")) return pick((p) => p.modelo.includes("GPT-5"));
  if (has("gpt-4o-mini", "4o mini", "gpt-4o-mini")) return pick((p) => p.modelo.includes("4o mini"));
  if (has("gpt-4o", "gpt-4")) return pick((p) => p.modelo.includes("GPT-5"));
  if (has("gemini")) return pick((p) => p.modelo.includes("Gemini"));
  if (has("kimi", "moonshot")) return pick((p) => p.modelo.includes("Kimi K3"));
  if (has("qwen")) return pick((p) => p.modelo.includes("Qwen"));
  if (has("glm-5", "glm5")) return pick((p) => p.modelo.includes("GLM-5"));
  if (has("glm")) return pick((p) => p.modelo.includes("GLM-4 Flash"));
  if (has("grok")) return pick((p) => p.modelo.includes("Grok"));
  if (has("llama", "together")) return pick((p) => p.modelo.includes("Together"));
  if (has("mistral")) return pick((p) => p.modelo.includes("Mistral"));
  if (has("deepseek")) {
    return pick((p) =>
      has("pro") ? p.modelo.includes("V4 Pro") : p.modelo.includes("V4 Flash"),
    );
  }
  return LLM_PRICES[1]; // DeepSeek V4 Flash — best value ☕
}

export interface OrcamentoEstimativa {
  tokensIn: number;
  tokensOut: number;
  custoUsd: number;
  custoFmt: string;
  modelo: string;
  /** Segundos estimados (velSeg do ranking; página ≈ 800 tokens). */
  secs: number;
  /** Tarefa "grande" = merece orçamento (regra do Miguel). */
  grande: boolean;
}

/**
 * Estima uma tarefa. `outRatio` = quanto a saída pesa em relação à entrada
 * (tradução ≈ 0.25; resumo ≈ 0.07). Tarefa GRANDE ≥ 20k tokens de entrada.
 */
export function estimarTarefa(
  inputText: string,
  model: string | undefined,
  outRatio = 0.25,
): OrcamentoEstimativa {
  const price = matchPrice(model);
  const tokensIn = estimateTokens(inputText);
  const tokensOut = Math.ceil(tokensIn * outRatio);
  const custoUsd = custo(price, tokensIn / 1000, tokensOut / 1000);
  const pages = Math.max(1, tokensIn / 800);
  return {
    tokensIn,
    tokensOut,
    custoUsd,
    custoFmt: usd(custoUsd),
    modelo: price.modelo,
    secs: Math.round(pages * (price.velSeg ?? 8)),
    grande: tokensIn >= 20_000,
  };
}

/** Recibo pós-execução: usage REAL do provedor (UsageInfo do ai-client). */
export interface ReciboReal {
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  custoUsd: number;
  custoFmt: string;
  modelo: string;
}

export function reciboReal(
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
  model: string | undefined,
): ReciboReal {
  const price = matchPrice(model);
  const tokensIn = usage.promptTokens ?? 0;
  const tokensOut = usage.completionTokens ?? 0;
  const total = usage.totalTokens ?? tokensIn + tokensOut;
  const custoUsd = custo(price, tokensIn / 1000, tokensOut / 1000);
  return {
    tokensIn,
    tokensOut,
    totalTokens: total,
    custoUsd,
    custoFmt: usd(custoUsd),
    modelo: price.modelo,
  };
}
