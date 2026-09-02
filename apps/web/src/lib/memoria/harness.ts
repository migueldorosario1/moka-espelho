/**
 * MOKA HARNESS beta (obra MOKA, etapa 2 — DSC-014/021, 30/08/2026).
 *
 * O "secretário particular do conhecimento": conversa com a IA da PRÓPRIA
 * chave do usuário (BYOK — nada passa por servidores nossos) dando a ela
 * ACESSO À MEMÓRIA (livros traduzidos, resumos, materiais importados — os
 * objetos pesquisáveis da etapa 1).
 *
 * A cada pergunta: busca os objetos relevantes na memória → injeta como
 * contexto → responde (streaming) citando o que consultou. Zero install:
 * é o próprio site (PWA do Moka).
 */

import { askFreeStream } from "../ai-client";
import { getTargetLang } from "../config";
import type { MemoriaObject } from "./types";
import { searchMemoria } from "./store";

/** Uma volta do diálogo. */
export interface HarnessTurn {
  role: "user" | "assistant";
  text: string;
}

/** Quanto do corpo de cada objeto entra no contexto (cap honesto). */
const BODY_SLICE = 1500;
/** Teto total do contexto de memória (tokens sob controle). */
const CONTEXT_CAP = 8000;
/** Máximo de objetos consultados por pergunta. */
const TOP_K = 5;

export interface HarnessAnswer {
  ok: boolean;
  text?: string;
  error?: string;
  /** Objetos da memória que fundamentaram a resposta. */
  consulted: MemoriaObject[];
}

function systemPrompt(lang: string, nObjetos: number): string {
  return (
    `Você é o secretário particular do conhecimento desta pessoa — o Moka Harness. ` +
    `Responda em ${lang}, com calor humano e honestidade. ` +
    `Você conhece a MEMÓRIA dela: ${nObjetos} material(is) que a pessoa leu, viu ou guardou ` +
    `(livros traduzidos, resumos, anotações). Na resposta, use o que for relevante ` +
    `da memória e cite de onde veio (título do material). ` +
    `Se a memória não tiver nada sobre o assunto, diga isso com clareza e ` +
    `responda com o seu conhecimento geral, avisando que não é da memória dela. ` +
    `Nunca invente conteúdo atribuindo-o à memória. Texto puro, sem markdown pesado.`
  );
}

/** Monta o bloco de contexto: diálogo + bagagem + operacional (kinds do Miguel). */
export function buildHarnessContext(
  history: HarnessTurn[],
  consulted: MemoriaObject[],
  consultedOp: MemoriaObject[] = [],
): string {
  const parts: string[] = [];

  const dialog = history.slice(-8);
  if (dialog.length) {
    parts.push(
      "=== CONVERSA ATÉ AQUI ===\n" +
        dialog
          .map((t) => `${t.role === "user" ? "Pessoa" : "Você"}: ${t.text}`)
          .join("\n"),
    );
  }

  if (consulted.length) {
    let used = 0;
    const blocks: string[] = [];
    for (const o of consulted) {
      const slice = o.body.slice(0, BODY_SLICE);
      if (used + slice.length > CONTEXT_CAP) break;
      used += slice.length;
      const meta = [o.author, o.date, o.tags.map((x) => `#${x}`).join(" ")]
        .filter(Boolean)
        .join(" · ");
      blocks.push(
        `--- MATERIAL: ${o.title}${meta ? ` (${meta})` : ""} ---\n${slice}`,
      );
    }
    parts.push(
      "=== MEMÓRIA DE BAGAGEM (o que a pessoa leu/viu — trechos relevantes) ===\n" +
        blocks.join("\n\n"),
    );
  }

  if (consultedOp.length) {
    const blocksOp = consultedOp.map((o) =>
      `--- ${o.title} ---\n${o.body.slice(0, 800)}`,
    );
    parts.push(
      "=== MEMÓRIA OPERACIONAL (contexto de trabalho/decisões) ===\n" +
        blocksOp.join("\n\n"),
    );
  }

  return parts.join("\n\n");
}

/**
 * Pergunta algo ao harness. A IA responde fundamentada nos objetos da
 * memória (busca instantânea por relevância) e no diálogo recente.
 */
export async function askHarnessStream(
  question: string,
  objetos: MemoriaObject[],
  history: HarnessTurn[],
  onChunk: (full: string, chunk: string) => void,
  objetosOperacional: MemoriaObject[] = [],
): Promise<HarnessAnswer> {
  // Relevância: busca completa pela pergunta; se a pergunta é curta/vazia
  // de termos úteis, consulta os mais recentes.
  let consulted: MemoriaObject[] = searchMemoria(objetos, question)
    .slice(0, TOP_K)
    .map((h) => h.obj);
  if (!consulted.length && objetos.length) {
    consulted = objetos.slice(0, 3); // memória sem match: dá os 3 recentes
  }

  const lang = getTargetLang();
  const consultedOp = searchMemoria(objetosOperacional, question)
    .slice(0, 3)
    .map((h) => h.obj);
  const contextText = buildHarnessContext(history, consulted, consultedOp);
  const result = await askFreeStream(
    question,
    systemPrompt(lang, objetos.length),
    contextText,
    onChunk,
  );
  return {
    ok: result.ok,
    text: result.text,
    error: result.error,
    consulted: [...consultedOp, ...consulted],
  };
}
