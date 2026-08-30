/**
 * TRADUÇÃO INTEGRAL EM VOLUMES — motor da feature (ícone 🌍 do Reader).
 *
 * Ideia do Miguel (2026-07-21): traduzir o livro INTEIRO, mas em
 * VOLUMES de ~50 páginas ("de 50 em 50 é melhor"). Cada volume vira:
 *   1. um arquivo .epub de verdade (baixado no dispositivo);
 *   2. um livro novo na estante do Moka (legível na hora, sem re-importar).
 * Depois, o INTEGRADOR junta todos os volumes num livro único.
 *
 * A fatia de 50 páginas usa EXATAMENTE a paginação que o usuário vê na
 * tela (lib/paginate.ts) — "página 31 do volume 2" é a mesma página que
 * o reader mostra.
 *
 * Retomada: o progresso é gravado no localStorage a cada página. Se o
 * app fecha (ou a internet cai) no volume 7 de 20, ao reabrir a janela
 * o usuário continua de onde parou — volumes prontos não são re-traduzidos
 * (já estão na estante; o ID é determinístico e sobrescreve).
 */

import type { Block, Chapter, ParsedBook } from "@igot/parser";
import { buildEpub } from "@igot/parser";
import { blocksToText, paginateBlocks } from "./paginate";
import { translatePage, type BookContext } from "./ai-client";
import { getTargetLang } from "./config";
import { saveToLibrary } from "./repository";
import type { Session } from "./db";

/** Páginas por volume (regra do Miguel: "de 50 em 50"). */
export const VOLUME_PAGES = 50;

/** Uma página global do livro (capítulo + página local + blocos). */
interface GlobalPage {
  chapterIdx: number;
  blocks: Block[];
}

/** Plano da tradução (pro modal mostrar ANTES de gastar tokens). */
export interface TranslationPlan {
  totalPages: number;
  volumesTotal: number;
  volumeSize: number;
  targetLang: string;
}

/** Estado persistido do job (retomada). */
export interface TransJobState {
  fingerprint: string;
  lang: string;
  totalPages: number;
  volumesTotal: number;
  /** Volumes 100% prontos (já salvos na estante + baixados). */
  completedVolumes: number;
  /** Páginas traduzidas do volume EM ANDAMENTO (ainda não fechou). */
  partialPages: string[];
  updatedAt: number;
}

export interface JobProgress {
  /** Volume atual (1-based) e total. */
  volume: number;
  volumesTotal: number;
  /** Página dentro do volume (1-based) e tamanho do volume. */
  pageInVolume: number;
  pagesInVolume: number;
  /** Páginas traduzidas no livro inteiro / total. */
  donePages: number;
  totalPages: number;
}

export interface RunResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
  volumesTotal: number;
  completedVolumes: number;
}

// ─── Fingerprint e persistência ─────────────────────────────────────────

/** ID estável do livro (pra chavear job + IDs dos volumes na estante). */
export function bookFingerprint(book: ParsedBook): string {
  const raw = `${book.title}|${book.author ?? ""}|${book.chapters.length}|${book.chapters
    .map((c) => c.blocks.length)
    .join(",")}`;
  // djb2 — hash simples e determinístico, suficiente pra chave local.
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

const jobKey = (fingerprint: string) => `moka.transjob.${fingerprint}`;

/** Lê o job salvo (null se não houver ou se o idioma mudou). */
export function loadTransJob(book: ParsedBook): TransJobState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(jobKey(bookFingerprint(book)));
    if (!raw) return null;
    const job = JSON.parse(raw) as TransJobState;
    // Se o idioma-alvo mudou desde o job salvo, não dá pra continuar —
    // misturaria idiomas nos volumes. O modal trata como job novo.
    if (job.lang !== getTargetLang()) return null;
    return job;
  } catch {
    return null;
  }
}

function saveTransJob(job: TransJobState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(jobKey(job.fingerprint), JSON.stringify(job));
  } catch (err) {
    console.warn("[moka] Falha ao gravar job de tradução:", err);
  }
}

/** Limpa o job (tradução concluída ou recomeço do zero). */
export function clearTransJob(book: ParsedBook): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(jobKey(bookFingerprint(book)));
}

// ─── Plano ──────────────────────────────────────────────────────────────

/** Achata a paginação por capítulo num array GLOBAL de páginas. */
function flattenPages(book: ParsedBook): GlobalPage[] {
  const pages: GlobalPage[] = [];
  book.chapters.forEach((ch, chapterIdx) => {
    for (const pageBlocks of paginateBlocks(ch.blocks)) {
      pages.push({ chapterIdx, blocks: pageBlocks });
    }
  });
  return pages;
}

/** Calcula o plano (páginas → volumes) sem gastar um token sequer. */
export function planTranslation(book: ParsedBook): TranslationPlan {
  const totalPages = flattenPages(book).length;
  return {
    totalPages,
    volumesTotal: Math.max(1, Math.ceil(totalPages / VOLUME_PAGES)),
    volumeSize: VOLUME_PAGES,
    targetLang: getTargetLang(),
  };
}

// ─── Montagem dos livros traduzidos ─────────────────────────────────────

/** Nome de arquivo seguro (sem acentos/caracteres problemáticos). */
function safeFileName(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "livro"
  );
}

/**
 * Monta o ParsedBook de um volume a partir das páginas traduzidas.
 * Espelha os capítulos originais que caem dentro da fatia do volume
 * (se um capítulo é cortado pela fronteira, aparece nos dois volumes —
 * cada um com o seu pedaço).
 */
function buildVolumeBook(
  book: ParsedBook,
  pages: GlobalPage[],
  translatedPages: string[],
  volumeIdx: number,
  volumesTotal: number,
  lang: string,
): ParsedBook {
  const byChapter = new Map<number, string[]>();
  translatedPages.forEach((text, i) => {
    const g = pages[volumeIdx * VOLUME_PAGES + i];
    if (!g) return;
    const list = byChapter.get(g.chapterIdx) ?? [];
    list.push(text);
    byChapter.set(g.chapterIdx, list);
  });

  const chapters: Chapter[] = [];
  for (const [chapterIdx, texts] of [...byChapter.entries()].sort((a, b) => a[0] - b[0])) {
    const original = book.chapters[chapterIdx];
    const blocks: Block[] = [];
    texts.forEach((text, pageIdx) => {
      // A tradução vem com parágrafos separados por linha em branco
      // (o prompt de translatePage garante isso).
      text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .forEach((paragraph, paraIdx) => {
          blocks.push({
            id: `v${volumeIdx + 1}-c${chapterIdx}-p${pageIdx}-b${paraIdx}`,
            type: "paragraph",
            text: paragraph,
          });
        });
    });
    if (blocks.length > 0) {
      chapters.push({
        id: `v${volumeIdx + 1}-c${chapterIdx}`,
        title: original?.title || `Capítulo ${chapterIdx + 1}`,
        blocks,
      });
    }
  }

  const fp = bookFingerprint(book);
  return {
    title:
      volumesTotal > 1
        ? `${book.title} — Vol. ${volumeIdx + 1}/${volumesTotal}`
        : `${book.title} (${lang})`,
    author: book.author,
    language: lang,
    sourceFormat: "epub",
    chapters,
    metadata: {
      mokaTranslated: "1",
      seriesId: `${fp}-${lang}`,
      volumeIdx: String(volumeIdx + 1),
      volumesTotal: String(volumesTotal),
      sourceTitle: book.title,
    },
  };
}

/** Converte um ParsedBook traduzido nos bytes de um EPUB. */
async function volumeToEpub(
  volumeBook: ParsedBook,
  identifier: string,
): Promise<Uint8Array> {
  return buildEpub({
    title: volumeBook.title,
    author: volumeBook.author,
    language: volumeBook.language,
    identifier,
    chapters: volumeBook.chapters.map((ch) => ({
      title: ch.title ?? "Capítulo",
      paragraphs: ch.blocks.map((b) => b.text ?? "").filter(Boolean),
    })),
  });
}

/** Dispara o download de um arquivo no navegador. */
function downloadBytes(fileName: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Salva o volume na estante (Session completa — legível na hora). */
async function saveVolumeToLibrary(
  book: ParsedBook,
  volumeBook: ParsedBook,
  fileName: string,
  fileSize: number,
  suffix: string,
  userId: string | null | undefined,
): Promise<void> {
  const fp = bookFingerprint(book);
  const session: Session = {
    id: `tr-${fp}-${volumeBook.language}-${suffix}`,
    fileName,
    fileSize,
    book: volumeBook,
    pdfSource: null,
    chapterIdx: 0,
    zoom: 1,
    savedAt: Date.now(),
  };
  await saveToLibrary(session, userId);
}

// ─── Motor principal ────────────────────────────────────────────────────

/**
 * Roda a tradução integral em volumes.
 *
 * @param resume  Se true, continua do job salvo (volumes prontos não
 *                refeitos; volume em andamento retoma da página salva).
 * @param isCancelled  Consultado entre páginas — retornar true pausa o
 *                job (estado persistido; dá pra continuar depois).
 */
export async function runTranslationJob(opts: {
  book: ParsedBook;
  userId?: string | null;
  resume?: boolean;
  onProgress?: (p: JobProgress) => void;
  isCancelled?: () => boolean;
}): Promise<RunResult> {
  const { book, userId, onProgress, isCancelled } = opts;
  const fp = bookFingerprint(book);
  const lang = getTargetLang();
  const pages = flattenPages(book);
  const totalPages = pages.length;
  const volumesTotal = Math.max(1, Math.ceil(totalPages / VOLUME_PAGES));

  // Retomada: job salvo (mesmo idioma) OU começa do zero.
  const saved = opts.resume ? loadTransJob(book) : null;
  const job: TransJobState = saved ?? {
    fingerprint: fp,
    lang,
    totalPages,
    volumesTotal,
    completedVolumes: 0,
    partialPages: [],
    updatedAt: Date.now(),
  };
  job.totalPages = totalPages;
  job.volumesTotal = volumesTotal;

  const ctx: BookContext = {
    bookTitle: book.title,
    bookAuthor: book.author,
    bookLanguage: book.language,
  };

  const baseName = safeFileName(book.title);

  for (let v = job.completedVolumes; v < volumesTotal; v++) {
    const start = v * VOLUME_PAGES;
    const end = Math.min(start + VOLUME_PAGES, totalPages);
    const pagesInVolume = end - start;
    // Páginas já traduzidas deste volume (retomada no meio do volume).
    const translated: string[] = [...job.partialPages];

    for (let i = translated.length; i < pagesInVolume; i++) {
      if (isCancelled?.()) {
        job.partialPages = translated;
        job.updatedAt = Date.now();
        saveTransJob(job);
        return { ok: false, cancelled: true, volumesTotal, completedVolumes: job.completedVolumes };
      }

      const pageText = blocksToText(pages[start + i].blocks, "\n\n").trim();
      // Página vazia (só imagem, por ex.) — não gasta token, segue vazia.
      const translatedText = pageText
        ? await translatePage(
            pageText,
            ctx,
            `livro: vol ${v + 1}/${volumesTotal} · pág ${start + i + 1}/${totalPages}`,
          ).then((r) => {
            if (!r.ok || !r.text) {
              throw new Error(r.error ?? "Erro na tradução.");
            }
            return r.text;
          })
        : "";

      translated.push(translatedText);
      job.partialPages = translated;
      job.updatedAt = Date.now();
      saveTransJob(job);

      onProgress?.({
        volume: v + 1,
        volumesTotal,
        pageInVolume: i + 1,
        pagesInVolume,
        donePages: start + i + 1,
        totalPages,
      });
    }

    // Volume fechado: vira ParsedBook + EPUB (baixado) + livro na estante.
    const volumeBook = buildVolumeBook(book, pages, translated, v, volumesTotal, lang);
    const volNum = String(v + 1).padStart(2, "0");
    const fileName = `${baseName}.vol${volNum}.${lang}.epub`;
    try {
      const epubBytes = await volumeToEpub(volumeBook, `urn:moka:${fp}-${lang}-v${v + 1}`);
      downloadBytes(fileName, epubBytes, "application/epub+zip");
      await saveVolumeToLibrary(book, volumeBook, fileName, epubBytes.length, `v${v + 1}`, userId);
    } catch (err) {
      console.warn("[moka] Falha ao gerar/salvar volume:", err);
      // Não aborta o job por causa do arquivo — o texto tá salvo no job.
    }

    job.completedVolumes = v + 1;
    job.partialPages = [];
    job.updatedAt = Date.now();
    saveTransJob(job);
  }

  clearTransJob(book);
  return { ok: true, volumesTotal, completedVolumes: volumesTotal };
}

// ─── Integrador de volumes ──────────────────────────────────────────────

/**
 * INTEGRADOR: junta todos os volumes traduzidos num livro único.
 *
 * Lê os volumes da estante (IDs determinísticos), concatena os capítulos
 * em ordem (fundindo capítulos cortados pela fronteira de volumes — mesmo
 * título vira um capítulo só), gera UM epub (baixado) e salva na estante.
 */
export async function mergeTranslatedVolumes(opts: {
  book: ParsedBook;
  userId?: string | null;
  volumesTotal?: number;
  /** Sessões de volume já carregadas (evita reler a estante). */
  getVolumeSession?: (volumeIdx: number) => Promise<Session | null>;
}): Promise<{ ok: boolean; error?: string }> {
  const { book, userId } = opts;
  const fp = bookFingerprint(book);
  const lang = getTargetLang();
  const plan = planTranslation(book);
  const volumesTotal = opts.volumesTotal ?? plan.volumesTotal;

  // Coleta os volumes (da estante ou do provedor injetado).
  const volumes: ParsedBook[] = [];
  if (opts.getVolumeSession) {
    for (let v = 1; v <= volumesTotal; v++) {
      const s = await opts.getVolumeSession(v);
      if (!s?.book) return { ok: false, error: `Volume ${v} não encontrado.` };
      volumes.push(s.book);
    }
  } else {
    const { getBookById } = await import("./db");
    for (let v = 1; v <= volumesTotal; v++) {
      const s = await getBookById(`tr-${fp}-${lang}-v${v}`);
      if (!s?.book) return { ok: false, error: `Volume ${v} não encontrado na estante.` };
      volumes.push(s.book);
    }
  }

  // Concatena capítulos; funde os de mesmo título (corte na fronteira).
  const chapters: Chapter[] = [];
  for (const vol of volumes) {
    for (const ch of vol.chapters) {
      const last = chapters[chapters.length - 1];
      if (last && last.title === ch.title) {
        last.blocks.push(...ch.blocks);
      } else {
        chapters.push({ ...ch, id: `m-c${chapters.length}`, blocks: [...ch.blocks] });
      }
    }
  }

  const merged: ParsedBook = {
    title: `${book.title} (${lang})`,
    author: book.author,
    language: lang,
    sourceFormat: "epub",
    chapters,
    metadata: {
      mokaTranslated: "1",
      mokaMerged: "1",
      seriesId: `${fp}-${lang}`,
      sourceTitle: book.title,
    },
  };

  const fileName = `${safeFileName(book.title)}.completo.${lang}.epub`;
  const epubBytes = await volumeToEpub(merged, `urn:moka:${fp}-${lang}-full`);
  downloadBytes(fileName, epubBytes, "application/epub+zip");
  await saveVolumeToLibrary(book, merged, fileName, epubBytes.length, "full", userId);
  return { ok: true };
}
