/**
 * MOKA MEMÓRIA — tipos do objeto pesquisável (obra MOKA, etapa 1 — 30/08/2026).
 *
 * Especificação: DSC-014 (memória local-first) / DSC-017 (objeto pesquisável
 * com metadados completos + anti-poluição) / DSC-018 (orçamento de tokens p/
 * tarefas grandes) / DSC-019 (módulo MOKA MEMÓRIA com ícone próprio).
 *
 * O formato é PORTÁTIL por design: dentro do app vive em IndexedDB, mas o
 * MESMO conteúdo serializa pra markdown + frontmatter (ver ./markdown.ts) —
 * "o rclone do conhecimento pessoal" (parecer DSC-014). Nada de lock-in.
 */

/** De onde veio o objeto. */
export type MemoriaObjectType =
  | "md" // arquivo .md importado (conversor da v1)
  | "livro" // livro da estante jogado na memória (ordem do Miguel 30/08)
  | "resumo" // resumo de livro gerado pelo Reader
  | "traducao" // tradução integral de livro (tarefa grande orçada)
  | "video" // resumo/transcrição do Moka Vídeo
  | "nota"; // anotação livre jogada na memória

/**
 * Um OBJETO PESQUISÁVEL da memória (DSC-017).
 * Regra anti-poluição: só entra com título + corpo mínimo (ver markdown.ts).
 */
export interface MemoriaObject {
  id: string;
  /** Qual memória (perfil) o objeto pertence. */
  memoriaId: string;
  type: MemoriaObjectType;
  title: string;
  author?: string;
  /** Data do MATERIAL (não da importação) — texto livre ISO ou legível. */
  date?: string;
  /** URL ou fonte de origem. */
  source?: string;
  /** Idioma do conteúdo (ex: "pt"). */
  lang?: string;
  tags: string[];
  /** Resumo curto (≤ 500 chars) — gerado à mão ou pela IA. */
  summary?: string;
  /** Texto integral normalizado (o conteúdo pesquisável de verdade). */
  body: string;
  /** Tamanho do corpo em caracteres (pré-computado p/ lista leve). */
  chars: number;
  /** Custo REAL em USD se o objeto nasceu de tarefa grande orçada (DSC-018). */
  costUsd?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Tipo de memória (ordem do Miguel 30/08 ~17h): a pessoa tem MEMÓRIA DE
 * BAGAGEM (o que consumiu: livros, vídeos, traduções) e MEMÓRIA OPERACIONAL
 * (contexto de trabalho — decisões e notas da conversa com a IA).
 */
export type MemoriaKind = "bagagem" | "operacional";

/** Uma memória (perfil nomeado — DSC-019: "criar outra memória"). */
export interface MemoriaMeta {
  id: string;
  nome: string;
  kind: MemoriaKind;
  createdAt: number;
}

/** Resultado de busca com snippet destacado. */
export interface MemoriaHit {
  obj: MemoriaObject;
  /** Trecho do corpo ao redor do 1º match (~160 chars). */
  snippet: string;
  score: number;
}
