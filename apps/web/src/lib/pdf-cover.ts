/**
 * pdf-cover — gera a capa de um PDF pra estante bonita
 * (pedido do Miguel, V3: "a estante tem que mostrar a capa dos livros").
 *
 * V4 (pedido do Miguel, 23/08): a capa nem sempre é a página 1. Livros
 * escaneados trazem páginas em branco, chapa da biblioteca, copyright…
 * antes da capa de verdade (caso-escola: "Roman Political Institutions",
 * cuja capa é a página 9). O app agora EXAMINA AS 10 PRIMEIRAS PÁGINAS e
 * elege a melhor candidata, em 3 níveis (calibrados com 6 PDFs reais):
 *
 *   A) Capa de arte (imagem/colorida): página ≥50% coberta de tinta,
 *      colorida (saturação>0.10, ≥40 cores) — elege a primeira. [5/6 livros]
 *   B) PDF digital com texto: página com a MAIOR fonte (folha de rosto),
 *      exigindo ≥3 itens e ≥2% de cobertura (descarta linha solta).
 *   C) Scan P&B (sem texto nem cor): página com LETRAS GRANDES — maior
 *      blob de tinta entre 4% e 25% da altura (título), SEM blob dominante
 *      de ilustração (>25% da altura, ex.: chapa de procedência) e SEM
 *      densidade de miolo (>20% de tinta). Elege a de maior letra.
 *
 * Roda no navegador com o pdfjs local (mesmo worker do leitor). Miniaturas
 * de análise a 150px; capa final a ~360px, JPEG 0.8 — leve pra guardar em
 * data URL. Tudo best-effort: qualquer erro cai de volta na página 1 e
 * NUNCA quebra o upload.
 */

/** Páginas iniciais examinadas em busca da capa. */
const PROBE_PAGES = 10;
/** Largura (px) das miniaturas de análise. */
const PROBE_WIDTH = 150;
/** Largura (px) da capa final. */
const COVER_WIDTH = 360;

/** Progresso reportado durante as varreduras (0..1 do trecho em curso). */
export type CoverProgress = (done: number, total: number) => void;

/**
 * Detecta PDF 100% IMAGEM (scan sem camada de texto): amostra as 10
 * primeiras páginas — se NENHUMA tem item de texto, é imagem pura
 * (caso-escola: Roman Political Institutions, 0 itens nas 436 págs).
 * Usado no UPLOAD pra avisar que traduzir exige IA com visão
 * (pedido do Miguel, 24/08). Best-effort: erro → false (nunca
 * bloqueia upload à toa).
 */
export async function isImagePdf(data: ArrayBuffer, onProgress?: CoverProgress): Promise<boolean> {
  try {
    const pdfjs = await import("pdfjs-dist");
    if (typeof window !== "undefined") {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    }
    const owned = data.slice(0);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(owned) }).promise;
    const n = Math.min(PROBE_PAGES, doc.numPages);
    let anyText = false;
    for (let i = 1; i <= n && !anyText; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      if (
        (tc.items as Array<{ str?: string }>).some((it) =>
          (it.str ?? "").trim(),
        )
      ) {
        anyText = true;
      }
      page.cleanup();
      onProgress?.(i, n);
    }
    await doc.destroy();
    return !anyText;
  } catch {
    return false;
  }
}

interface PageMetrics {
  page: number;
  itens: number; // itens de texto com conteúdo
  maxFont: number; // maior altura de fonte (unidades da página)
  cobertura: number; // % da página coberta por texto
  tinta: number; // % de pixels escuros+médios (lum < 225)
  sat: number; // saturação média (0..1)
  cores: number; // cores distintas (quantizadas 4 bits/canal)
  maxBlobH: number; // altura do maior blob de tinta (0..1 da página)
}

export async function renderPdfCover(data: ArrayBuffer, onProgress?: CoverProgress): Promise<string | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    if (typeof window !== "undefined") {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    }
    // Cópia própria: o pdfjs "detacha" o buffer que recebe.
    const owned = data.slice(0);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(owned) }).promise;

    const n = Math.min(PROBE_PAGES, doc.numPages);
    const metrics: PageMetrics[] = [];
    for (let i = 1; i <= n; i++) {
      metrics.push(await measurePage(doc, i));
      onProgress?.(i, n + 1); // +1 = renderização final da capa escolhida
    }
    const escolhida = pickCoverPage(metrics, n);
    onProgress?.(n + 1, n + 1);

    const page = await doc.getPage(escolhida);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, COVER_WIDTH / base.width);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    const url = canvas.toDataURL("image/jpeg", 0.8);
    await doc.destroy();
    return url;
  } catch {
    return null; // capa é best-effort — nunca quebra o upload
  }
}

/** Mede uma página (texto + miniatura renderizada) pra eleger a capa. */
async function measurePage(
  doc: Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]>,
  pageNum: number,
): Promise<PageMetrics> {
  const page = await doc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  const pageArea = vp.width * vp.height;

  // ── Texto ──
  const tc = await page.getTextContent();
  let itens = 0, maxFont = 0, areaTxt = 0;
  for (const it of tc.items as Array<{
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
  }>) {
    const s = (it.str ?? "").trim();
    if (!s || !it.transform) continue;
    itens++;
    const fs = Math.hypot(it.transform[2], it.transform[3]);
    maxFont = Math.max(maxFont, fs);
    areaTxt += (it.width || 0) * (it.height || fs * fs * 0.6);
  }

  // ── Miniatura (pixels) ──
  let tinta = 0, sat = 0, cores = 0, maxBlobH = 0;
  try {
    const vps = page.getViewport({ scale: PROBE_WIDTH / vp.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vps.width);
    canvas.height = Math.ceil(vps.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vps }).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const Wc = canvas.width, Hc = canvas.height, N = Wc * Hc;
      let escMed = 0, satSum = 0;
      const ink = new Uint8Array(N);
      const colorSet = new Set<number>();
      for (let p = 0, k = 0; p < img.length; p += 4, k++) {
        const r = img[p], g = img[p + 1], b = img[p + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 225) {
          escMed++;
          ink[k] = 1;
        }
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        satSum += mx === 0 ? 0 : (mx - mn) / mx;
        colorSet.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
      tinta = escMed / N;
      sat = satSum / N;
      cores = colorSet.size;
      maxBlobH = maxInkBlobHeight(ink, Wc, Hc) / Hc;
    }
  } catch {
    // render da miniatura falhou (fonte/exótico): segue só com texto
  }
  page.cleanup();

  return {
    page: pageNum, itens, maxFont,
    cobertura: areaTxt / pageArea,
    tinta, sat, cores, maxBlobH,
  };
}

/** Maior componente conexo (4-conexos) de pixels de tinta; retorna a ALTURA
 *  do maior blob em px — letras de título são blobs altos e médios; texto
 *  corrido, bolinhas; ilustrações de procedência, um blob gigante. */
function maxInkBlobHeight(ink: Uint8Array, Wc: number, Hc: number): number {
  const seen = new Uint8Array(ink.length);
  let maxH = 0;
  for (let k = 0; k < ink.length; k++) {
    if (!ink[k] || seen[k]) continue;
    const stack = [k];
    seen[k] = 1;
    let y0 = Infinity, y1 = -1;
    while (stack.length) {
      const j = stack.pop() as number;
      const x = j % Wc, y = (j / Wc) | 0;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && ink[j - 1] && !seen[j - 1]) { seen[j - 1] = 1; stack.push(j - 1); }
      if (x < Wc - 1 && ink[j + 1] && !seen[j + 1]) { seen[j + 1] = 1; stack.push(j + 1); }
      if (y > 0 && ink[j - Wc] && !seen[j - Wc]) { seen[j - Wc] = 1; stack.push(j - Wc); }
      if (y < Hc - 1 && ink[j + Wc] && !seen[j + Wc]) { seen[j + Wc] = 1; stack.push(j + Wc); }
    }
    maxH = Math.max(maxH, y1 - y0 + 1);
  }
  return maxH;
}

/** Eleição da melhor página de capa (níveis A → B → C → fallback 1). */
function pickCoverPage(m: PageMetrics[], n: number): number {
  // A) Capa de arte: cheia de tinta E colorida. Primeira que satisfaz.
  for (const p of m) {
    if (p.tinta >= 0.5 && p.sat > 0.10 && p.cores >= 40) return p.page;
  }

  // B) PDF digital: folha de rosto = maior fonte, com corpo (≥3 itens,
  //    ≥2% de cobertura — descarta cabeçalho/rodapé solto).
  const comTexto = m.filter((p) => p.itens >= 3 && p.cobertura >= 0.02);
  if (comTexto.length > 0) {
    let best = comTexto[0];
    for (const p of comTexto) {
      if (p.maxFont > best.maxFont) best = p;
    }
    return best.page;
  }

  // C) Scan P&B: página com LETRAS GRANDES (blob 4–25% da altura),
  //    sem ilustração dominante (>25%) e sem densidade de miolo (>20%).
  const candidatas = m.filter(
    (p) =>
      p.tinta >= 0.02 &&
      p.tinta <= 0.20 &&
      p.maxBlobH >= 0.04 &&
      p.maxBlobH <= 0.25,
  );
  if (candidatas.length > 0) {
    let best = candidatas[0];
    for (const p of candidatas) {
      if (p.maxBlobH > best.maxBlobH) best = p;
    }
    return best.page;
  }

  return Math.min(1, n); // fallback: página 1
}
