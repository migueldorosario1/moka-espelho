/**
 * Cliente de IA de alto nível (roda no navegador).
 *
 * Lê a config do usuário (localStorage), instancia o provider com o transport
 * proxy (fura CORS), e expõe as ações da UI: traduzir, explicar, perguntar.
 *
 * Esta é a lógica de prompt que antes morava nas API Routes — agora no cliente,
 * já que o servidor não detém mais a chave.
 *
 * TELEMETRIA (pedido do Miguel, 2026-08-22): TODA tarefa que usa a chave do
 * usuário passa por aqui e é registrada no ledger local (./telemetry) com
 * tokens consumidos + custo estimado. A telemetria é sempre passiva: NUNCA
 * trava o app — se algo falhar nela, a ação de IA segue normalmente.
 */

import {
  getProvider,
  getPreset,
  createProxyTransport,
  AIProviderError,
  ProxyStreamError,
  type AIConfig,
  type CompleteOptions,
  type UsageInfo,
} from "@igot/ai-providers";
import { getConfigSync, getEntryForText, getTargetLang } from "./config";
import { captureError } from "./diagnostics";
import { t } from "./messages";
import {
  recordUsage,
  getPrefs,
  estimateTokens,
  estimateTaskInputTokens,
  computeCostUsd,
} from "./telemetry";

/** Contexto da obra relevante para as ações. */
export interface BookContext {
  bookTitle?: string;
  bookAuthor?: string;
  bookLanguage?: string;
}

/** Resultado padronizado das ações. */
export interface AIActionResult {
  ok: boolean;
  text?: string;
  error?: string;
  /** Aviso não-fatal (ex.: tarefa interrompida pela trava de tokens). */
  warning?: string;
  /** Custo real em US$ da chamada, quando dá pra calcular (telemetria). */
  costUsd?: number;
  /** Consumo real (quando o provedor informa; senão estimativa). */
  usage?: UsageInfo;
  /** true = a tarefa foi interrompida pelo usuário (botão cancelar). */
  cancelCut?: boolean;
}

/** Callback chamado a cada pedaço de texto que chega (pra streaming). */
export type StreamCallback = (fullText: string, chunk: string) => void;

/** Monta o bloco de contexto (metadados da obra) que acompanha o prompt. */
function buildContext(ctx: BookContext): string | undefined {
  const parts = [
    ctx.bookTitle && `Obra: ${ctx.bookTitle}`,
    ctx.bookAuthor && `Autor: ${ctx.bookAuthor}`,
    ctx.bookLanguage && `Idioma original: ${ctx.bookLanguage}`,
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

/** Instancia o provider SEMPRE com a chave do usuário (BYOK).
 *  FASE GRATUITA (pivô 2026-08-04): não existe mais IA da casa/pontos —
 *  sem chave configurada, o erro guia a pessoa a colocar a própria. */
function resolveProvider() {
  const config = getEntryForText();
  if (!config) {
    throw new Error(
      "Para usar a IA, abra as ⚙️ Configurações e cole a SUA chave de IA " +
      "(ela fica só no seu dispositivo). Em /ajuda tem o passo a passo de 1 minuto.",
    );
  }
  const transport = createProxyTransport("/api/proxy");
  return { provider: getProvider(config as AIConfig, transport), config };
}

// ─── Telemetria: integração (registro + trava, sem nunca travar) ─────────

/** Dados da chamada, usados no registro de consumo. */
interface CallMeta {
  /** Chave da tarefa no ledger (ex.: "translate", "translate-page"). */
  task: string;
  /** Texto enviado como turno do usuário (para estimativa de tokens). */
  promptText: string;
  systemPrompt?: string;
  contextText?: string;
}

/** O que identificou a chamada (entry do cofre + nome do provedor). */
interface CallIdentity {
  providerId: string;
  providerName: string;
  model: string;
}

function identityOf(
  provider: { name: string },
  config: { providerId: string; model?: string },
): CallIdentity {
  return {
    providerId: config.providerId,
    providerName: provider.name,
    model: config.model ?? "",
  };
}

/**
 * Se a trava de consumo está ligada E a entrada estimada já estoura o
 * limite, devolve o aviso (a chamada NÃO é feita). Caso contrário, null.
 * Nunca lança.
 */
function capBlockedMessage(meta: CallMeta): string | null {
  try {
    const prefs = getPrefs();
    if (prefs.tokenCap <= 0) return null;
    const est = estimateTaskInputTokens(
      meta.promptText,
      meta.systemPrompt,
      meta.contextText,
    );
    if (est > prefs.tokenCap) {
      return t(getTargetLang(), "errTokenCap", {
        est,
        cap: prefs.tokenCap,
      });
    }
  } catch {
    /* telemetria nunca quebra o app */
  }
  return null;
}

/** Entrada estimada em tokens (prompt + sistema + contexto). */
function inputEstimate(meta: CallMeta): number {
  try {
    return estimateTaskInputTokens(
      meta.promptText,
      meta.systemPrompt,
      meta.contextText,
    );
  } catch {
    return 0;
  }
}

/** Registra consumo de uma chamada CONCLUÍDA (com ou sem erro). */
function recordCall(args: {
  meta: CallMeta;
  identity?: CallIdentity;
  usage?: UsageInfo;
  completionText?: string;
  status?: "ok" | "error";
  note?: string;
}): void {
  // Fire-and-forget: o fluxo do usuário não espera o banco.
  if (!args.identity) return; // sem chave configurada → nada foi gasto
  void recordUsage({
    task: args.meta.task,
    providerId: args.identity.providerId,
    providerName: args.identity.providerName,
    model: args.identity.model,
    usage: args.usage,
    promptText: [args.meta.systemPrompt, args.meta.contextText, args.meta.promptText]
      .filter(Boolean)
      .join("\n"),
    completionText: args.completionText,
    status: args.status ?? "ok",
    note: args.note,
  }).catch(() => {
    /* nunca quebra */
  });
}

/**
 * Converte qualquer exceção numa mensagem amigável no IDIOMA DO USUÁRIO.
 * Traduz status HTTP comuns dos provedores de IA em texto claro, com a
 * próxima ação. O idioma acompanha o que o usuário configurou (targetLang):
 * configurou em inglês? vê erros em inglês. Português? em português.
 */
function toMessage(err: unknown, kind = "ai", textLen?: number): string {
  const lang = getTargetLang();

  // Diagnóstico (pedido do Miguel, 13/08): registra o erro técnico + status
  // HTTP do provedor pra eu poder analisar depois. NUNCA inclui a chave.
  // Em try/catch pra o diagnóstico NUNCA quebrar o fluxo principal.
  try {
    captureError({
      kind,
      message: err instanceof Error ? err.message : String(err),
      status: err instanceof ProxyStreamError ? err.statusCode : undefined,
      providerDetail: err instanceof ProxyStreamError ? err.providerDetail : undefined,
      stack: err instanceof Error ? err.stack : undefined,
      textLen,
    });
  } catch {
    /* diagnóstico nunca quebra o fluxo */
  }

  // Erro do proxy-stream com status HTTP do provedor.
  if (err instanceof ProxyStreamError) {
    const detail = err.providerDetail ? ` (${err.providerDetail})` : "";
    switch (err.statusCode) {
      case 400:
        // Erro de requisição: geralmente parâmetro inválido (modelo, temperatura).
        // O detail traz a mensagem específica do provedor — já está em inglês ou
        // no idioma do provedor, então é útil mostrar junto.
        return t(lang, "errGeneric", { code: 400 }) + detail;
      case 401:
      case 403:
        return t(lang, "errAuth") + detail;
      case 404:
        // Modelo não encontrado — mensagem específica e útil.
        return t(lang, "errModelNotFound") + detail;
      case 429:
        return t(lang, "errRateLimit") + detail;
      case 500:
      case 502:
      case 503:
        return t(lang, "errServer") + detail;
      default:
        return t(lang, "errGeneric", { code: err.statusCode }) + detail;
    }
  }
  if (err instanceof AIProviderError) return err.message;
  if (err instanceof Error) {
    const msg = err.message;
    // "Failed to fetch" = rede caiu, CORS, OU timeout do serverless.
    // Mensagem mais útil pro usuário entender o que aconteceu.
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return t(lang, "errNetwork");
    }
    // AbortError (timeout manual ou navegação durante fetch).
    if (/abort/i.test(msg) && err.name === "AbortError") {
      return t(lang, "errTimeout");
    }
    return msg;
  }
  return String(err);
}

// ─── Ações ──────────────────────────────────────────────────────────────

/** Traduz um trecho para o idioma-alvo do usuário. */
export async function translate(
  text: string,
  ctx: BookContext,
): Promise<AIActionResult> {
  if (!text.trim()) return { ok: false, error: "Texto ausente." };
  const targetLang = getTargetLang();
  const systemPrompt =
    `Você é um tradutor literário e técnico de excelência. ` +
    `Traduza o trecho fornecido para ${targetLang}. ` +
    `Respeite o tom, o estilo e o contexto da obra. ` +
    `Devolva APENAS a tradução, sem comentários, sem aspas, sem introdução.`;
  const contextText = buildContext(ctx);
  const meta: CallMeta = { task: "translate", promptText: text, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const result = await provider.complete(text, {
      systemPrompt,
      context: contextText,
      temperature: 0.3,
      onUsage: (u) => {
        usage = u;
      },
    });
    recordCall({ meta, identity, usage, completionText: result.text });
    return { ok: true, text: result.text };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err) };
  }
}

/**
 * Versão STREAMING de translate: o texto vai aparecendo aos poucos.
 * `onChunk` é chamado a cada pedaço (com o texto acumulado + o pedaço novo).
 * Cai pra `translate` (sem stream) se o provedor não suportar.
 */
export async function translateStream(
  text: string,
  ctx: BookContext,
  onChunk: StreamCallback,
): Promise<AIActionResult> {
  if (!text.trim()) return { ok: false, error: "Texto ausente." };
  const targetLang = getTargetLang();
  const systemPrompt =
    `Você é um tradutor literário e técnico de excelência. ` +
    `Traduza o trecho fornecido para ${targetLang}. ` +
    `Respeite o tom, o estilo e o contexto da obra. ` +
    `Devolva APENAS a tradução, sem comentários, sem aspas, sem introdução.`;
  const contextText = buildContext(ctx);
  const meta: CallMeta = { task: "translate", promptText: text, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const captureUsage = (u: UsageInfo) => {
      usage = u;
    };
    if (!provider.stream) {
      // Sem suporte a stream — faz normal e devolve de uma vez.
      const result = await provider.complete(text, {
        systemPrompt,
        context: contextText,
        temperature: 0.3,
        onUsage: captureUsage,
      });
      onChunk(result.text, result.text);
      recordCall({ meta, identity, usage, completionText: result.text });
      return { ok: true, text: result.text };
    }
    const { full, capCut } = await runStreamWithCap({
      streamFn: provider.stream.bind(provider),
      text,
      systemPrompt,
      contextText,
      temperature: 0.3,
      meta,
      onChunk,
      onUsage: captureUsage,
    });
    recordCall({ meta, identity, usage, completionText: full });
    return {
      ok: true,
      text: full,
      warning: capCut ? t(getTargetLang(), "errCapCut", { cap: getPrefs().tokenCap }) : undefined,
    };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err) };
  }
}

/**
 * Núcleo do streaming com trava de consumo. Consome o stream do provider
 * acumulando o texto; se a trava de tokens está ligada e o consumo
 * estimado (entrada + saída até aqui) passa do limite, INTERROMPE o stream
 * e devolve o que já foi gerado — sem travar o app (pedido do Miguel).
 */
async function runStreamWithCap(args: {
  streamFn: (prompt: string, opts?: CompleteOptions) => AsyncIterable<string>;
  text: string;
  systemPrompt: string;
  contextText?: string;
  temperature: number;
  meta: CallMeta;
  onChunk: StreamCallback;
  onUsage: (u: UsageInfo) => void;
  images?: string[];
  shouldCancel?: () => boolean;
}): Promise<{ full: string; capCut: boolean; cancelCut: boolean }> {
  const cap = getPrefs().tokenCap;
  const estIn = inputEstimate(args.meta);
  let full = "";
  let capCut = false;
  let cancelCut = false;
  for await (const chunk of args.streamFn(args.text, {
    systemPrompt: args.systemPrompt,
    context: args.contextText,
    temperature: args.temperature,
    onUsage: args.onUsage,
    images: args.images,
  })) {
    full += chunk;
    args.onChunk(full, chunk);
    // CANCELAR pelo usuário (Miguel, 26/08): corta a despesa de token NA HORA
    // (o break finaliza o stream de rede — o provider para de gerar) e
    // preserva o que já chegou (vai pra nota parcial).
    if (args.shouldCancel?.()) {
      cancelCut = true;
      break;
    }
    // Trava em tempo real: estoura o cap → corta o stream, preserva o texto.
    if (cap > 0 && estIn + estimateTokens(full) > cap) {
      capCut = true;
      break;
    }
  }
  return { full, capCut, cancelCut };
}

/**
 * Traduz a página/capítulo INTEIRO de uma vez.
 *
 * Diferente do `translate` (trecho curto), aqui o texto é longo. O prompt
 * pede parágrafos coerentes e bem separados — porque PDFs costumam ter
 * quebras de linha artificiais (uma por linha impressa) que, preservadas
 * à risca, geram um texto bagunçado. Ao reagrupar em parágrafos naturais,
 * a tradução flui como uma página de livro real, legível e bonita.
 */
export async function translatePage(
  text: string,
  ctx: BookContext,
  note?: string,
): Promise<AIActionResult> {
  if (!text.trim()) return { ok: false, error: "Página sem texto para traduzir." };
  const targetLang = getTargetLang();
  const systemPrompt =
    `Você é um tradutor literário e técnico de excelência. ` +
    `Traduza o texto completo da página a seguir para ${targetLang}. ` +
    `Reagrupe o conteúdo em PARÁGRAFOS coerentes e naturais: ` +
    `uma mudança de ideia = novo parágrafo. ` +
    `Ignore as quebras de linha artificiais do original (PDFs quebram a cada ` +
    `linha impressa) e crie parágrafos que fluam como uma página de livro. ` +
    `Mantenha títulos/heading em linhas próprias. ` +
    `Separe cada parágrafo por UMA linha em branco. ` +
    `Respeite o tom, o estilo e o contexto da obra. ` +
    `Devolva APENAS a tradução, sem comentários, sem aspas, sem introdução.`;
  const contextText = buildContext(ctx);
  const meta: CallMeta = { task: "translate-page", promptText: text, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const result = await provider.complete(text, {
      systemPrompt,
      context: contextText,
      temperature: 0.3,
      onUsage: (u) => {
        usage = u;
      },
    });
    recordCall({ meta, identity, usage, completionText: result.text, note });
    return { ok: true, text: result.text };
  } catch (err) {
    recordCall({ meta, identity, status: "error", note });
    return { ok: false, error: toMessage(err) };
  }
}

/**
 * Versão STREAMING de translatePage: a tradução da página inteira vai
 * aparecendo aos poucos (palavra por palavra). `onChunk` recebe o texto
 * acumulado + o pedaço novo a cada chunk do LLM.
 */
export async function translatePageStream(
  text: string,
  ctx: BookContext,
  onChunk: StreamCallback,
  options?: { shouldCancel?: () => boolean },
): Promise<AIActionResult> {
  if (!text.trim()) return { ok: false, error: "Página sem texto para traduzir." };
  // Custo real da página (usage do provedor ?? estimativa) — nota 💰 no
  // leitor com tokens + US$ + moeda do usuário (Miguel, 25/08).
  const pageCost = async (
    identity: CallIdentity | undefined,
    u: UsageInfo | undefined,
  ): Promise<number | undefined> => {
    if (!identity) return undefined;
    const est =
      u ?? {
        promptTokens: estimateTokens(text) + 200,
        completionTokens: estimateTokens(text),
      };
    return computeCostUsd(
      identity.providerId,
      identity.model,
      est.promptTokens ?? 0,
      est.completionTokens ?? 0,
    );
  };

  const targetLang = getTargetLang();
  const systemPrompt =
    `Você é um tradutor literário e técnico de excelência. ` +
    `Traduza o texto completo da página a seguir para ${targetLang}. ` +
    `Reagrupe o conteúdo em PARÁGRAFOS coerentes e naturais: ` +
    `uma mudança de ideia = novo parágrafo. ` +
    `Ignore as quebras de linha artificiais do original (PDFs quebram a cada ` +
    `linha impressa) e crie parágrafos que fluam como uma página de livro. ` +
    `Mantenha títulos/heading em linhas próprias. ` +
    `Separe cada parágrafo por UMA linha em branco. ` +
    `Respeite o tom, o estilo e o contexto da obra. ` +
    `Devolva APENAS a tradução, sem comentários, sem aspas, sem introdução.`;
  const contextText = buildContext(ctx);
  const meta: CallMeta = { task: "translate-page", promptText: text, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const captureUsage = (u: UsageInfo) => {
      usage = u;
    };
    if (!provider.stream) {
      const result = await provider.complete(text, {
        systemPrompt,
        context: contextText,
        temperature: 0.3,
        onUsage: captureUsage,
      });
      onChunk(result.text, result.text);
      recordCall({ meta, identity, usage, completionText: result.text });
      return { ok: true, text: result.text, usage, costUsd: await pageCost(identity, usage) };
    }
    const { full, capCut, cancelCut } = await runStreamWithCap({
      streamFn: provider.stream.bind(provider),
      text,
      systemPrompt,
      contextText,
      temperature: 0.3,
      meta,
      onChunk,
      onUsage: captureUsage,
      shouldCancel: options?.shouldCancel,
    });
    recordCall({ meta, identity, usage, completionText: full });
    return {
      ok: true,
      text: full,
      usage,
      costUsd: await pageCost(identity, usage),
      cancelCut,
      warning: capCut ? t(getTargetLang(), "errCapCut", { cap: getPrefs().tokenCap }) : undefined,
    };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err, "translate-page", text.length) };
  }
}

/**
 * Traduz a página INTEIRA a partir de uma IMAGEM (PDF escaneado sem camada
 * de texto — pedido do Miguel, 23/08: "traduzir até PDF de imagem").
 *
 * A imagem (data URL do canvas da página) vai anexada na mensagem para um
 * modelo com VISÃO. Transparência de custo (exigência do Miguel):
 * `estimateImagePageCostUsd()` dá o custo ESTIMADO antes de chamar;
 * o retorno traz `costUsd` REAL para exibir depois; tudo cai no ledger
 * da telemetria como tarefa "translate-page-image".
 */

/** Tokens aproximados de UMA imagem de página (jpeg ~1500px) — modelos
 *  visão cobram ~800-1600 tokens por página; usamos 1300 p/ estimativa. */
const IMAGE_TOKENS_EST = 1300;
/** Saída esperada de uma página traduzida (~1800 tokens). */
const IMAGE_OUTPUT_TOKENS_EST = 1800;

/** Custo ESTIMADO em US$ de uma tradução de página-imagem com a chave ativa.
 *  Retorna 0 quando o modelo não tem preço na tabela (aviso "desconhecido"). */
export async function estimateImagePageCostUsd(): Promise<number> {
  try {
    const { provider, config } = resolveProvider();
    const identity = identityOf(provider, config);
    return await computeCostUsd(
      identity.providerId,
      identity.model,
      IMAGE_TOKENS_EST + 400, // imagem + prompts
      IMAGE_OUTPUT_TOKENS_EST,
    );
  } catch {
    return 0;
  }
}

export async function translatePageImageStream(
  imageDataUrl: string,
  ctx: BookContext,
  onChunk: StreamCallback,
): Promise<AIActionResult> {
  const targetLang = getTargetLang();
  const systemPrompt =
    `Você é um tradutor literário e técnico de excelência e também lê ` +
    `páginas digitalizadas de livros (OCR de alta qualidade). ` +
    `A imagem anexa é uma página de livro. Leia TODO o texto visível nela ` +
    `e traduza-o integralmente para ${targetLang}. ` +
    `Reagrupe o conteúdo em PARÁGRAFOS coerentes e naturais: uma mudança ` +
    `de ideia = novo parágrafo, separados por UMA linha em branco. ` +
    `Mantenha títulos em linhas próprias. Ignore marcas da digitalização. ` +
    `Trecho ilegível: marque [ilegível] no lugar. ` +
    `Devolva APENAS a tradução, sem comentários, sem aspas, sem introdução.`;
  const prompt =
    `Traduza o conteúdo completo da página digitalizada na imagem` +
    (ctx.bookTitle
      ? ` (livro: "${ctx.bookTitle}"${ctx.bookAuthor ? `, de ${ctx.bookAuthor}` : ""})`
      : "") +
    `.`;
  const contextText = buildContext(ctx);
  const meta: CallMeta = {
    task: "translate-page-image",
    promptText: prompt,
    systemPrompt,
    contextText,
  };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    const images = [imageDataUrl];
    let usage: UsageInfo | undefined;
    const captureUsage = (u: UsageInfo) => {
      usage = u;
    };
    // Custo real: usage do provedor quando informado; senão estimativa.
    const realCost = async (): Promise<number> => {
      if (!identity) return 0;
      const u =
        usage ?? {
          promptTokens:
            IMAGE_TOKENS_EST +
            estimateTokens([systemPrompt, prompt, contextText].join("\n")),
          completionTokens: IMAGE_OUTPUT_TOKENS_EST,
        };
      return computeCostUsd(identity.providerId, identity.model, u.promptTokens ?? 0, u.completionTokens ?? 0);
    };

    if (!provider.stream) {
      const result = await provider.complete(prompt, {
        systemPrompt,
        context: contextText,
        temperature: 0.3,
        images,
        onUsage: captureUsage,
      });
      onChunk(result.text, result.text);
      recordCall({ meta, identity, usage, completionText: result.text, note: "página-imagem (IA de visão)" });
      return { ok: true, text: result.text, costUsd: await realCost() };
    }
    const { full, capCut } = await runStreamWithCap({
      streamFn: provider.stream.bind(provider),
      text: prompt,
      systemPrompt,
      contextText,
      temperature: 0.3,
      meta,
      onChunk,
      onUsage: captureUsage,
      images,
    });
    recordCall({ meta, identity, usage, completionText: full, note: "página-imagem (IA de visão)" });
    return {
      ok: true,
      text: full,
      costUsd: await realCost(),
      warning: capCut ? t(getTargetLang(), "errCapCut", { cap: getPrefs().tokenCap }) : undefined,
    };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err, "translate-page-image", imageDataUrl.length) };
  }
}

/**
 * Explica a página INTEIRA com streaming.
 * Diferente do explain (trecho), aqui cobre a página toda: sentido geral,
 * contexto, termos-chave, dificuldades de tradução.
 */
export async function explainPageStream(
  text: string,
  ctx: BookContext,
  onChunk: StreamCallback,
  /** Tamanho-alvo em palavras (barra deslizante do modal de anotação). */
  targetWords?: number,
): Promise<AIActionResult> {
  // Custo real da página (usage do provedor ?? estimativa) — nota 💰 no
  // leitor com tokens + US$ + moeda do usuário (Miguel, 25/08).
  const pageCost = async (
    identity: CallIdentity | undefined,
    u: UsageInfo | undefined,
  ): Promise<number | undefined> => {
    if (!identity) return undefined;
    const est =
      u ?? {
        promptTokens: estimateTokens(text) + 200,
        completionTokens: estimateTokens(text),
      };
    return computeCostUsd(
      identity.providerId,
      identity.model,
      est.promptTokens ?? 0,
      est.completionTokens ?? 0,
    );
  };
  if (!text.trim()) return { ok: false, error: "Página sem texto." };
  const targetLang = getTargetLang();
  const lengthRule = targetWords && targetWords > 0
    ? ` A explicação deve ter CERCA de ${targetWords} palavras — nunca ultrapasse ` +
      `${Math.round(targetWords * 1.25)} palavras.`
    : "";
  const systemPrompt =
    `Você é um assistente de leitura. Explique o texto completo da página ` +
    `a seguir em ${targetLang}, de forma clara e didática. ` +
    `Cubra: o sentido geral da página, termos ou conceitos importantes, ` +
    `possíveis dificuldades de tradução (idiotismos, referências culturais), ` +
    `e como este trecho se conecta com o resto da obra.${lengthRule} ` +
    `Use quebras de linha para separar seções. ` +
    `NÃO use asteriscos, negrito, itálico ou markdown — só texto puro. ` +
    `Não invente — se não souber algo, diga.`;
  const contextText = buildContext(ctx);
  const meta: CallMeta = { task: "explain-page", promptText: text, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const captureUsage = (u: UsageInfo) => {
      usage = u;
    };
    if (!provider.stream) {
      const result = await provider.complete(text, {
        systemPrompt,
        context: contextText,
        temperature: 0.4,
        onUsage: captureUsage,
      });
      onChunk(result.text, result.text);
      recordCall({ meta, identity, usage, completionText: result.text });
      return { ok: true, text: result.text, usage, costUsd: await pageCost(identity, usage) };
    }
    const { full, capCut } = await runStreamWithCap({
      streamFn: provider.stream.bind(provider),
      text,
      systemPrompt,
      contextText,
      temperature: 0.4,
      meta,
      onChunk,
      onUsage: captureUsage,
    });
    recordCall({ meta, identity, usage, completionText: full });
    return {
      ok: true,
      text: full,
      usage,
      costUsd: await pageCost(identity, usage),
      warning: capCut ? t(getTargetLang(), "errCapCut", { cap: getPrefs().tokenCap }) : undefined,
    };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err, "explain-page", text.length) };
  }
}

/** Explica um trecho (sentido, idiotismos, contexto). */
export async function explain(
  text: string,
  ctx: BookContext,
): Promise<AIActionResult> {
  if (!text.trim()) return { ok: false, error: "Texto ausente." };
  const targetLang = getTargetLang();
  const systemPrompt =
    `Você é um assistente de leitura. Explique o trecho fornecido em ${targetLang}, ` +
    `de forma clara e didática. ` +
    `Cubra: sentido literal, possíveis sentidos figurados, idiotismos ou ` +
    `referências culturais, e como ele se encaixa no contexto da obra. ` +
    `Seja conciso (2 a 4 parágrafos curtos). ` +
    `Não invente — se não souber algo, diga.`;
  const contextText = buildContext(ctx);
  const promptText = `Explique este trecho:\n\n"${text}"`;
  const meta: CallMeta = { task: "explain", promptText, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const result = await provider.complete(promptText, {
      systemPrompt,
      context: contextText,
      temperature: 0.4,
      onUsage: (u) => {
        usage = u;
      },
    });
    recordCall({ meta, identity, usage, completionText: result.text });
    return { ok: true, text: result.text };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err) };
  }
}

/** Versão STREAMING de explain. */
export async function explainStream(
  text: string,
  ctx: BookContext,
  onChunk: StreamCallback,
): Promise<AIActionResult> {
  if (!text.trim()) return { ok: false, error: "Texto ausente." };
  const targetLang = getTargetLang();
  const systemPrompt =
    `Você é um assistente de leitura. Explique o trecho fornecido em ${targetLang}, ` +
    `de forma clara e didática. ` +
    `Cubra: sentido literal, possíveis sentidos figurados, idiotismos ou ` +
    `referências culturais, e como ele se encaixa no contexto da obra. ` +
    `Seja conciso (2 a 4 parágrafos curtos). ` +
    `Não invente — se não souber algo, diga.`;
  const contextText = buildContext(ctx);
  const promptText = `Explique este trecho:\n\n"${text}"`;
  const meta: CallMeta = { task: "explain", promptText, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const captureUsage = (u: UsageInfo) => {
      usage = u;
    };
    if (!provider.stream) {
      const result = await provider.complete(promptText, {
        systemPrompt,
        context: contextText,
        temperature: 0.4,
        onUsage: captureUsage,
      });
      onChunk(result.text, result.text);
      recordCall({ meta, identity, usage, completionText: result.text });
      return { ok: true, text: result.text };
    }
    const { full, capCut } = await runStreamWithCap({
      streamFn: provider.stream.bind(provider),
      text: promptText,
      systemPrompt,
      contextText,
      temperature: 0.4,
      meta,
      onChunk,
      onUsage: captureUsage,
    });
    recordCall({ meta, identity, usage, completionText: full });
    return {
      ok: true,
      text: full,
      warning: capCut ? t(getTargetLang(), "errCapCut", { cap: getPrefs().tokenCap }) : undefined,
    };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err) };
  }
}

/**
 * Traduz um texto pra um idioma EXPLÍCITO (não o targetLang da config).
 * Uso: preparar texto pra LEITURA EM VOZ ALTA — se o idioma da fala
 * configurado é diferente do idioma do livro, traduzimos primeiro na
 * nuvem da IA e depois falamos a tradução (ex.: livro em inglês,
 * fala em português).
 */
export async function translateForSpeech(
  text: string,
  speechLang: string,
  ctx: BookContext,
): Promise<AIActionResult> {
  if (!text.trim()) return { ok: false, error: "Texto ausente." };
  const systemPrompt =
    `Você é um tradutor literário e técnico de excelência. ` +
    `Traduza o trecho fornecido para ${speechLang}. ` +
    `A tradução será LIDA EM VOZ ALTA: prefira frases fluídas e naturais ` +
    `ao ouvido, mantendo o sentido e o tom da obra. ` +
    `Devolva APENAS a tradução, sem comentários, sem aspas, sem introdução.`;
  const contextText = buildContext(ctx);
  const meta: CallMeta = { task: "translate-speech", promptText: text, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const result = await provider.complete(text, {
      systemPrompt,
      context: contextText,
      temperature: 0.3,
      onUsage: (u) => {
        usage = u;
      },
    });
    recordCall({ meta, identity, usage, completionText: result.text });
    return { ok: true, text: result.text };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err) };
  }
}

/** Responde uma pergunta livre sobre o livro (preview do Q&A — sem RAG ainda). */
export async function ask(
  question: string,
  ctx: BookContext,
): Promise<AIActionResult> {
  if (!question.trim()) return { ok: false, error: "Pergunta ausente." };
  const targetLang = getTargetLang();
  const systemPrompt =
    `Você é um assistente de leitura ajudando alguém com o livro "${ctx.bookTitle ?? "desconhecido"}". ` +
    `Responda em ${targetLang}, de forma útil e honesta. ` +
    `Se não souber algo por falta de contexto do texto, diga — não invente. ` +
    `(Em breve: respostas fundamentadas no texto da obra.)`;
  const contextText = buildContext(ctx);
  const meta: CallMeta = { task: "ask", promptText: question, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const result = await provider.complete(question, {
      systemPrompt,
      context: contextText,
      temperature: 0.4,
      onUsage: (u) => {
        usage = u;
      },
    });
    recordCall({ meta, identity, usage, completionText: result.text });
    return { ok: true, text: result.text };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err) };
  }
}

/**
 * Versão STREAMING de ask: a resposta vai aparecendo aos poucos.
 * Usada pela janela "Pergunte qualquer coisa" do Reader.
 */
export async function askStream(
  question: string,
  ctx: BookContext,
  onChunk: StreamCallback,
): Promise<AIActionResult> {
  if (!question.trim()) return { ok: false, error: "Pergunta ausente." };
  const targetLang = getTargetLang();
  const systemPrompt =
    `Você é um assistente de leitura ajudando alguém com o livro "${ctx.bookTitle ?? "desconhecido"}"` +
    (ctx.bookAuthor ? ` de ${ctx.bookAuthor}` : "") + `. ` +
    `Responda em ${targetLang}, de forma útil, calorosa e honesta. ` +
    `A pessoa pode perguntar sobre a obra, o autor, o tema, ou pedir pra ` +
    `saber mais sobre um capítulo ou passagem. ` +
    `Se não souber algo por falta de contexto do texto, diga — não invente. ` +
    `Use texto puro, sem markdown.`;
  const contextText = buildContext(ctx);
  const meta: CallMeta = { task: "ask", promptText: question, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const captureUsage = (u: UsageInfo) => {
      usage = u;
    };
    if (!provider.stream) {
      const result = await provider.complete(question, {
        systemPrompt,
        context: contextText,
        temperature: 0.4,
        onUsage: captureUsage,
      });
      onChunk(result.text, result.text);
      recordCall({ meta, identity, usage, completionText: result.text });
      return { ok: true, text: result.text };
    }
    const { full, capCut } = await runStreamWithCap({
      streamFn: provider.stream.bind(provider),
      text: question,
      systemPrompt,
      contextText,
      temperature: 0.4,
      meta,
      onChunk,
      onUsage: captureUsage,
    });
    recordCall({ meta, identity, usage, completionText: full });
    return {
      ok: true,
      text: full,
      warning: capCut ? t(getTargetLang(), "errCapCut", { cap: getPrefs().tokenCap }) : undefined,
    };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err) };
  }
}

/**
 * CHAT LIVRE com systemPrompt + contexto customizados (OBRA MOKA · HARNESS).
 *
 * É o motor do "secretário do conhecimento": o HARNESS monta o contexto a
 * partir da MEMÓRIA do usuário (objetos pesquisáveis) e conversa com a IA
 * da própria chave dele (BYOK). Mesma proteção das outras rotas: trava de
 * tokens + ledger de telemetria (o consumo aparece em Suas IAs).
 */
export async function askFreeStream(
  question: string,
  systemPrompt: string,
  contextText: string,
  onChunk: StreamCallback,
): Promise<AIActionResult> {
  if (!question.trim()) return { ok: false, error: "Pergunta ausente." };
  const meta: CallMeta = { task: "harness", promptText: question, systemPrompt, contextText };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const captureUsage = (u: UsageInfo) => {
      usage = u;
    };
    if (!provider.stream) {
      const result = await provider.complete(question, {
        systemPrompt,
        context: contextText,
        temperature: 0.5,
        onUsage: captureUsage,
      });
      onChunk(result.text, result.text);
      recordCall({ meta, identity, usage, completionText: result.text });
      return { ok: true, text: result.text };
    }
    const { full, capCut } = await runStreamWithCap({
      streamFn: provider.stream.bind(provider),
      text: question,
      systemPrompt,
      contextText,
      temperature: 0.5,
      meta,
      onChunk,
      onUsage: captureUsage,
    });
    recordCall({ meta, identity, usage, completionText: full });
    return {
      ok: true,
      text: full,
      warning: capCut ? t(getTargetLang(), "errCapCut", { cap: getPrefs().tokenCap }) : undefined,
    };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err) };
  }
}

/**
 * Resume um texto (página ou compilação do livro) com streaming.
 *
 * `scope` = "page" (a página na tela — resumo direto e fiel) ou
 * "book" (compilação de trechos do livro inteiro — resumo panorâmico,
 * avisando que é baseado numa amostra quando o texto veio truncado).
 */
export async function summarizeStream(
  text: string,
  scope: "page" | "book",
  ctx: BookContext,
  onChunk: StreamCallback,
  /** Tamanho-alvo em palavras (barra deslizante do modal de anotação). */
  targetWords?: number,
): Promise<AIActionResult> {
  if (!text.trim()) return { ok: false, error: "Texto ausente." };
  const targetLang = getTargetLang();
  const lengthRule = targetWords && targetWords > 0
    ? ` O resumo deve ter CERCA de ${targetWords} palavras — nunca ultrapasse ` +
      `${Math.round(targetWords * 1.25)} palavras.`
    : "";
  const systemPrompt =
    scope === "page"
      ? `Você é um assistente de leitura. Resuma a página a seguir em ${targetLang}, ` +
        `de forma clara e fiel: a ideia central, os pontos principais e ` +
        `qualquer virada importante.${lengthRule || " Use de 3 a 6 frases, ou tópicos curtos se couber melhor."} ` +
        `Não comente fora do texto. Não invente. Texto puro, sem markdown.`
      : `Você é um assistente de leitura. A seguir vai uma COMPILAÇÃO de trechos ` +
        `do livro "${ctx.bookTitle ?? "desconhecido"}" (títulos de capítulos e ` +
        `passagens representativas — possivelmente truncada). ` +
        `Escreva em ${targetLang} um resumo panorâmico da obra: tema, enredo ou ` +
        `argumento central, personagens/ideias principais e tom geral. ` +
        `Se a amostra for claramente parcial, diga isso numa frase final honesta. ` +
        `Texto puro, sem markdown. Não invente fatos que não estejam na amostra.`;
  const contextText = buildContext(ctx);
  const meta: CallMeta = {
    task: scope === "page" ? "summarize-page" : "summarize-book",
    promptText: text,
    systemPrompt,
    contextText,
  };

  const capMsg = capBlockedMessage(meta);
  if (capMsg) return { ok: false, error: capMsg };

  let identity: CallIdentity | undefined;
  try {
    const { provider, config } = resolveProvider();
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const captureUsage = (u: UsageInfo) => {
      usage = u;
    };
    if (!provider.stream) {
      const result = await provider.complete(text, {
        systemPrompt,
        context: contextText,
        temperature: 0.4,
        onUsage: captureUsage,
      });
      onChunk(result.text, result.text);
      recordCall({ meta, identity, usage, completionText: result.text });
      return { ok: true, text: result.text };
    }
    const { full, capCut } = await runStreamWithCap({
      streamFn: provider.stream.bind(provider),
      text,
      systemPrompt,
      contextText,
      temperature: 0.4,
      meta,
      onChunk,
      onUsage: captureUsage,
    });
    recordCall({ meta, identity, usage, completionText: full });
    return {
      ok: true,
      text: full,
      warning: capCut ? t(getTargetLang(), "errCapCut", { cap: getPrefs().tokenCap }) : undefined,
    };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, error: toMessage(err) };
  }
}

/**
 * Teste de conexão: faz uma chamada mínima ao provider escolhido.
 * Usado pela tela de Configurações pra validar chave + provedor.
 * Também é registrado na telemetria (consome tokens, ainda que poucos).
 */
export async function testConnection(
  config: AIConfig,
): Promise<{ ok: boolean; message: string }> {
  const meta: CallMeta = { task: "test", promptText: "Diga apenas: OK" };
  let identity: CallIdentity | undefined;
  try {
    const transport = createProxyTransport("/api/proxy");
    const provider = getProvider(config, transport);
    identity = identityOf(provider, config);
    let usage: UsageInfo | undefined;
    const result = await provider.complete("Diga apenas: OK", {
      temperature: 0,
      // 300 tokens: modelos de raciocínio (Grok 4, gpt-5.5, o-series) consomem
      // muitos reasoning_tokens antes de responder — 100 não sobrava pro "OK".
      maxTokens: 300,
      onUsage: (u) => {
        usage = u;
      },
    });
    recordCall({ meta, identity, usage, completionText: result.text });
    return {
      ok: true,
      message: `Conexão bem-sucedida. Resposta: "${result.text.slice(0, 40)}"`,
    };
  } catch (err) {
    recordCall({ meta, identity, status: "error" });
    return { ok: false, message: toMessage(err) };
  }
}

/**
 * Busca a lista de modelos disponíveis do provedor (endpoint /models).
 * Retorna um array de IDs de modelo. Cai pra lista vazia se o provedor
 * não suportar /models ou se a chave for inválida.
 */
export async function listModels(
  config: AIConfig,
): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    const preset = getPreset(config.providerId);
    if (!preset) return { ok: false, error: "Provedor desconhecido." };

    const baseUrl = config.baseUrl ?? preset.baseUrl;
    const transport = createProxyTransport("/api/proxy");

    // O endpoint /models é padrão OpenAI-compatible (GET).
    // Gemini e Anthropic têm formatos diferentes — trato abaixo.
    if (preset.adapter === "gemini") {
      // Gemini: GET /models?key=X
      const { status, body } = await transport.request(
        `${baseUrl}/models?key=${encodeURIComponent(config.apiKey)}`,
        { method: "GET", headers: {}, body: "" },
      );
      if (status >= 400) {
        const b = body as { error?: { message?: string } };
        return { ok: false, error: b?.error?.message ?? `Erro ${status}` };
      }
      const data = body as { models?: Array<{ name?: string }> };
      const models = (data.models ?? [])
        .map((m) => m.name?.replace("models/", "") ?? "")
        .filter(Boolean);
      return { ok: true, models };
    }

    // Anthropic: não tem /models público estável. Devolve defaults.
    if (preset.adapter === "anthropic") {
      return {
        ok: true,
        models: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-sonnet-4-20250514"],
      };
    }

    // OpenAI-compatible: GET /models com Bearer auth.
    const { status, body } = await transport.request(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: "",
    });
    if (status >= 400) {
      const b = body as { error?: { message?: string } };
      return { ok: false, error: b?.error?.message ?? `Erro ${status}` };
    }
    const data = body as { data?: Array<{ id?: string }> };
    const models = (data.data ?? [])
      .map((m) => m.id ?? "")
      .filter(Boolean)
      .sort();
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

/** Resultado da consulta de saldo/crédito do provedor. */
export interface BalanceResult {
  ok: boolean;
  /** Valor do saldo em USD — quando o provedor expõe via API. */
  balanceUsd?: number;
  /** O provedor NÃO expõe saldo via API (a maioria). */
  unsupported?: boolean;
  /** Link do painel de consumo do provedor (fallback universal). */
  usageUrl?: string;
  error?: string;
}

/**
 * Consulta quanto crédito resta na API do usuário (pedido do Miguel,
 * 2026-08-22) — "caso o LLM permita". Pouquíssimos provedores expõem saldo
 * via API; nos demais, devolvemos o link do painel oficial (usageUrl).
 * Nunca lança: qualquer falha vira resultado com `ok: false`.
 */
export async function checkBalance(config: AIConfig): Promise<BalanceResult> {
  const preset = getPreset(config.providerId);
  const usageUrl = preset?.usageUrl;
  try {
    // DeepSeek: GET {baseUrl}/dashboard/balance → { data: { balance } } (USD).
    if (config.providerId === "deepseek") {
      const baseUrl = (config.baseUrl ?? preset?.baseUrl ?? "").replace(/\/$/, "");
      const transport = createProxyTransport("/api/proxy");
      const { status, body } = await transport.request(`${baseUrl}/dashboard/balance`, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: "",
      });
      if (status >= 400) return { ok: false, error: `HTTP ${status}`, usageUrl };
      const data = body as { data?: { balance?: number } };
      const balance = data?.data?.balance;
      if (typeof balance === "number") return { ok: true, balanceUsd: balance, usageUrl };
      return { ok: false, unsupported: true, usageUrl };
    }

    // Demais provedores: sem endpoint público de saldo → painel do provedor.
    return { ok: false, unsupported: true, usageUrl };
  } catch (err) {
    return { ok: false, error: toMessage(err, "balance"), usageUrl };
  }
}
