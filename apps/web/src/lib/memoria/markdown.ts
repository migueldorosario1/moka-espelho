/**
 * MOKA MEMÓRIA — conversor markdown ⇄ objeto pesquisável (obra, etapa 1).
 *
 * O formato portátil ("MOKA MD"):
 *
 *   ---
 *   title: Nome do material
 *   author: Autor
 *   date: 2026-08-30
 *   source: https://…
 *   lang: pt
 *   tags: [política, livro]
 *   type: md
 *   summary: Resumo curto…
 *   ---
 *   Corpo do material em markdown…
 *
 * - Import aceita: .md simples (sem frontmatter — título vira o 1º heading
 *   ou a 1ª linha), .md com frontmatter, e o EXPORT consolidado do Moka
 *   (INDEX no topo + objetos separados por `%%%MOKA-OBJ%%%`).
 * - Export consolidado = 1 arquivo .md com o ÍNDICE (INDEX) no topo e todos
 *   os objetos — legível em qualquer editor, sem dependências (DSC-021a).
 *
 * ANTI-POLUIÇÃO (regra do Miguel, DSC-017): a memória só recebe o que for
 * indexável e limpo — sem título e sem corpo mínimo, é rejeitado com motivo.
 */

import type { MemoriaObject, MemoriaObjectType } from "./types";

export const OBJ_SEPARATOR = "%%%MOKA-OBJ%%%";
export const MIN_BODY_CHARS = 200;
const MAX_SUMMARY_CHARS = 500;

// ─── Normalização ─────────────────────────────────────────────────────────

/** Remove acentos (p/ busca e slugs) mantendo legibilidade. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, (c) => c) // CJK intacto
    .toLowerCase();
}

/** Slug ASCII p/ nome de arquivo de export. */
export function slugify(s: string): string {
  const n = normalizeText(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return n.slice(0, 60) || "memoria";
}

// ─── Frontmatter (YAML simples à mão — sem dependências) ─────────────────

export interface Frontmatter {
  title?: string;
  author?: string;
  date?: string;
  source?: string;
  lang?: string;
  tags?: string[];
  type?: string;
  summary?: string;
}

/** Faz parse do bloco `--- … ---` se existir. Retorna dados + corpo restante. */
export function parseFrontmatter(text: string): { data: Frontmatter; body: string } {
  const raw = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!m) return { data: {}, body: raw.trim() };

  const data: Frontmatter = {};
  const lines = m[1].split("\n");
  let currentArrayKey: string | null = null;
  let tags: string[] = [];

  for (const line of lines) {
    if (/^\s*-\s+/.test(line) && currentArrayKey) {
      const item = line.replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, "");
      if (item) tags.push(item);
      continue;
    }
    currentArrayKey = null;
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let value = kv[2].trim();
    // Escapa aspas externas.
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) {
      value = value.slice(1, -1);
    }
    switch (key) {
      case "title":
      case "author":
      case "date":
      case "source":
      case "lang":
      case "summary":
        (data as Record<string, string | undefined>)[key] = value || undefined;
        break;
      case "type":
        data.type = value || undefined;
        break;
      case "tags": {
        const inline = /^\[(.*)\]$/.exec(value);
        if (inline) {
          tags = inline[1]
            .split(",")
            .map((t) => t.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        } else if (value) {
          // tags: a, b, c (sem colchetes)
          tags = value
            .split(",")
            .map((t) => t.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        } else {
          currentArrayKey = "tags"; // lista multi-linha vem a seguir
        }
        break;
      }
      default:
        break;
    }
  }
  data.tags = tags.map((t) => t.toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
  return { data, body: raw.slice(m[0].length).trim() };
}

/** Serializa frontmatter (ordem estável, legível). */
export function serializeFrontmatter(f: Frontmatter): string {
  const lines: string[] = ["---"];
  const push = (k: string, v?: string | number) => {
    if (v === undefined || v === "") return;
    lines.push(`${k}: ${String(v).replace(/\n/g, " ")}`);
  };
  push("title", f.title);
  push("author", f.author);
  push("date", f.date);
  push("source", f.source);
  push("lang", f.lang);
  push("type", f.type);
  push("summary", f.summary);
  if (f.tags?.length) lines.push(`tags: [${f.tags.join(", ")}]`);
  lines.push("---");
  return lines.join("\n");
}

// ─── Anti-poluição ────────────────────────────────────────────────────────

export interface Validation {
  ok: boolean;
  motivo?: string;
}

/** Regra do Miguel (DSC-017): só entra na memória o que for limpo e indexável. */
export function validateObject(title: string, body: string): Validation {
  const t = title.trim();
  const b = body
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
  if (!t) return { ok: false, motivo: "sem título" };
  if (t.length < 2) return { ok: false, motivo: "título curto demais" };
  if (b.length < MIN_BODY_CHARS)
    return { ok: false, motivo: `corpo com menos de ${MIN_BODY_CHARS} caracteres` };
  return { ok: true };
}

// ─── Import (conversor) ───────────────────────────────────────────────────

export interface ParsedImport {
  ok: boolean;
  motivo?: string;
  title?: string;
  body?: string;
  fm?: Frontmatter;
}

/** Converte UM bloco de markdown em entrada válida p/ a memória. */
export function parseOneMarkdown(text: string): ParsedImport {
  const { data, body } = parseFrontmatter(text);
  // Título: frontmatter > 1º heading > 1ª linha não vazia.
  let title = data.title?.trim();
  if (!title) {
    const h = /^#{1,3}\s+(.+)$/m.exec(body);
    title = h?.[1].trim();
  }
  if (!title) {
    const firstLine = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    title = firstLine?.replace(/^[#>*\-\s]+/, "");
  }
  title = (title ?? "").trim().slice(0, 200);
  const v = validateObject(title, body);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  return {
    ok: true,
    title,
    body,
    fm: {
      ...data,
      title,
      summary: data.summary?.slice(0, MAX_SUMMARY_CHARS),
    },
  };
}

/**
 * Quebra um arquivo nos blocos (nosso export usa `%%%MOKA-OBJ%%%`).
 * Se for o NOSSO export consolidado, o cabeçalho do Índice (antes do
 * primeiro separador) é DESCARTADO — só os objetos voltam pra memória.
 */
export function splitImportFile(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.includes(OBJ_SEPARATOR)) {
    return normalized
      .split(OBJ_SEPARATOR)
      .slice(1) // descarta o INDEX do export (não é objeto)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  const single = normalized.trim();
  return single ? [single] : [];
}

// ─── Export ───────────────────────────────────────────────────────────────

/** Serializa UM objeto como .md portátil. */
export function serializeObject(o: MemoriaObject): string {
  const fm = serializeFrontmatter({
    title: o.title,
    author: o.author,
    date: o.date,
    source: o.source,
    lang: o.lang,
    type: o.type,
    summary: o.summary,
    tags: o.tags,
  });
  return `${fm}\n\n${o.body}\n`;
}

/**
 * Export CONSOLIDADO da memória inteira: INDEX no topo + objetos separados.
 * Este é o "INDEX.md" da arquitetura da obra (DSC-021a) — o arquivo que a
 * pessoa abre em qualquer lugar e entende o que está guardado.
 */
export function exportMemoriaMarkdown(
  nomeMemoria: string,
  objetos: MemoriaObject[],
): string {
  const gerado = new Date().toISOString().slice(0, 10);
  const header = [
    "<!-- MOKA MEMÓRIA — export portátil -->",
    `# Índice da memória: ${nomeMemoria}`,
    "",
    `- Objetos: ${objetos.length}`,
    `- Exportado em: ${gerado}`,
    "- Formato: cada objeto abaixo tem frontmatter + corpo (separados pelo marcador oficial do Moka).",
    "- Importar de volta: Moka → Memória → Importar .md (este mesmo arquivo).",
    "",
    "## Índice",
    "",
    ...objetos.map(
      (o) =>
        `- **${o.title}**${o.author ? ` — ${o.author}` : ""}${
          o.tags.length ? ` · ${o.tags.map((t) => `#${t}`).join(" ")}` : ""
        } (${o.chars.toLocaleString("pt-BR")} chars)`,
    ),
    "",
    "---",
    "",
  ].join("\n");
  const corpo = objetos.map(serializeObject).join(`\n${OBJ_SEPARATOR}\n\n`);
  // Separador TAMBÉM entre o Índice e o 1º objeto: assim o importador
  // descarta o header com segurança (tudo antes do 1º separador é Índice).
  return `${header}${OBJ_SEPARATOR}\n\n${corpo}\n`;
}
