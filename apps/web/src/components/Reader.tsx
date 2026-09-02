"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import type { Block, ParsedBook } from "@igot/parser";
import type { SelectionAction } from "@/lib/types";
import { tt } from "@/lib/telemetry-strings";
import { PdfPageCanvas } from "./PdfPageCanvas";
import { CafezinhoLogo } from "./CafezinhoLogo";
import { AuthGate } from "./AuthGate";
import { useI18n } from "./I18nProvider";
import { CloseAppButton } from "./CloseAppButton";
import { LangSwitcher } from "./LangSwitcher";
import { useTTS } from "@/hooks/useTTS";
import { getTargetLang, getAudioLang, getConfigSync, listAllEntriesSync, getTtsVoice, getEntryForVoice } from "@/lib/config";
import { SettingsModal } from "./SettingsModal";
import { AskModal } from "./AskModal";
import { PageActionModal } from "./PageActionModal";
import { TranslateBookModal } from "./TranslateBookModal";
import { translatePageStream, explainPageStream, translateStream, explainStream, translateForSpeech, translatePageImageStream, estimateImagePageCostUsd } from "@/lib/ai-client";
import { blocksToText, paginateBlocks } from "@/lib/paginate";
import { copyDiagnostics, installGlobalErrorCapture, setDiagContext, buildMailtoLink, buildReport, getLastError, getSuggestedCauses, captureError } from "@/lib/diagnostics";

interface ReaderProps {
  book: ParsedBook;
  /** Buffer PDF original (só pra sourceFormat === "pdf"). */
  pdfSource?: ArrayBuffer | null;
  onSelection: (action: SelectionAction) => void;
  /** Capítulo/página inicial (hidratado do IndexedDB). */
  initialChapterIdx?: number;
  /** Zoom inicial (hidratado do IndexedDB). */
  initialZoom?: number;
  /** Avisa o pai quando muda de capítulo/página (pra persistir). */
  onChapterChange?: (n: number) => void;
  /** Avisa o pai quando muda o zoom (pra persistir). */
  onZoomChange?: (z: number) => void;
  /** Fecha o livro atual (volta pro uploader). */
  onCloseBook?: () => void;
  /** Abre as configurações de IA (pra acessar em fullscreen). */
  onOpenSettings?: () => void;
  /** Settings aberto? (controla renderização do modal DENTRO do Reader). */
  settingsOpen?: boolean;
  /** Fecha o modal de settings. */
  onCloseSettings?: () => void;
  /** Callback quando salva config (pra atualizar indicador). */
  onSettingsSaved?: () => void;
  /** True se já tem configuração de IA salva (mostra indicador se falso). */
  configReady?: boolean;
  /** Traduções já prontas (chave = pageKey: "N" no PDF, "cap.pag" no EPUB). */
  translations?: Record<string, string>;
  /** Persiste a tradução de uma página (chaveada por pageKey). */
  onPageTranslation?: (pageKey: string, text: string) => void;
  /** Anotações salvas (pra abrir o modal de Notas). */
  notes?: Array<{ id: string; kind: string; source: string; result: string; savedAt: number }>;
  /** Remove uma anotação. */
  onRemoveNote?: (id: string) => void;
  /** Salva uma nota (auto-save de tradução/explicação em fullscreen). */
  onSaveNote?: (entry: { kind: "translate" | "explain" | "ask" | "summary"; source: string; result: string; chapterId?: string }) => void;
  /** Marcadores salvos (chapterIdx + pageIdx local + timestamp + prévia). */
  bookmarks?: Array<{ chapterIdx: number; pageIdx?: number; savedAt: number; pageLabel?: string; preview?: string }>;
  /** Adiciona/remove um marcador da página atual (com página local + prévia). */
  onToggleBookmark?: (chapterIdx: number, meta?: { pageIdx?: number; pageLabel?: string; preview?: string }) => void;
  /** Volta pra estante (home). */
  onGoToShelf?: () => void;
  /** Painel da IA visível? (pra botão de toggle). */
  panelVisible?: boolean;
  /** Mostra/oculta o painel da IA (sem perder a ação). */
  onTogglePanel?: () => void;
  /** Auth (login Google) — pra mostrar o botão no header. */
  auth?: ReturnType<typeof import("@/lib/auth").useAuth>;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.2;

/** Limites do controle de tamanho da fonte de leitura (A−/A+). */
const FONT_SCALE_MIN = 0.7;
const FONT_SCALE_MAX = 1.8;

/**
 * Mensagens de confirmação (pedido do Miguel, 13/08): marcar/desmarcar
 * marcador, apagar anotação/marcador — sempre "um avisozinho, na língua do
 * usuário". Mapa autocontido (não mexe no ui-strings gigante).
 */
const CONFIRM_MSGS: Record<string, { mark: string; unmark: string; deleteNote: string; deleteBookmark: string }> = {
  "pt-BR": { mark: "Marcar esta página?", unmark: "Desmarcar esta página?", deleteNote: "Apagar esta anotação?", deleteBookmark: "Apagar este marcador?" },
  en: { mark: "Bookmark this page?", unmark: "Remove the bookmark from this page?", deleteNote: "Delete this note?", deleteBookmark: "Delete this bookmark?" },
  es: { mark: "¿Marcar esta página?", unmark: "¿Quitar el marcador de esta página?", deleteNote: "¿Eliminar esta nota?", deleteBookmark: "¿Eliminar este marcador?" },
  fr: { mark: "Marquer cette page ?", unmark: "Retirer le marque-page de cette page ?", deleteNote: "Supprimer cette note ?", deleteBookmark: "Supprimer ce marque-page ?" },
  de: { mark: "Diese Seite markieren?", unmark: "Lesezeichen von dieser Seite entfernen?", deleteNote: "Diese Notiz löschen?", deleteBookmark: "Dieses Lesezeichen löschen?" },
  it: { mark: "Segnare questa pagina?", unmark: "Rimuovere il segnalibro da questa pagina?", deleteNote: "Eliminare questa nota?", deleteBookmark: "Eliminare questo segnalibro?" },
  ru: { mark: "Отметить эту страницу?", unmark: "Убрать закладку с этой страницы?", deleteNote: "Удалить эту заметку?", deleteBookmark: "Удалить эту закладку?" },
  zh: { mark: "标记此页？", unmark: "取消此页的标记？", deleteNote: "删除这条笔记？", deleteBookmark: "删除这个书签？" },
  ja: { mark: "このページをブックマークしますか？", unmark: "このページのブックマークを外しますか？", deleteNote: "このメモを削除しますか？", deleteBookmark: "このブックマークを削除しますか？" },
  ko: { mark: "이 페이지를 북마크할까요?", unmark: "이 페이지의 북마크를 해제할까요?", deleteNote: "이 메모를 삭제할까요?", deleteBookmark: "이 북마크를 삭제할까요?" },
  ar: { mark: "هل تريد وضع علامة على هذه الصفحة؟", unmark: "هل تريد إزالة العلامة من هذه الصفحة؟", deleteNote: "هل تريد حذف هذه الملاحظة؟", deleteBookmark: "هل تريد حذف هذه العلامة؟" },
  hi: { mark: "इस पेज को बुकमार्क करें?", unmark: "इस पेज से बुकमार्क हटाएँ?", deleteNote: "इस नोट को हटाएँ?", deleteBookmark: "इस बुकमार्क को हटाएँ?" },
};
const FONT_SCALE_STEP = 0.1;
const FONT_SCALE_KEY = "moka.fontScale";

/**
 * Painel de leitura.
 *
 * Renderiza os capítulos do livro. Quando o leitor seleciona um trecho,
 * mostra um menu flutuante (Traduzir / Explicar) que dispara `onSelection`.
 * Pra PDF: zoom + botão "Traduzir página" (overlay traduzido).
 *
 * `chapterIdx` e `zoom` são inicializados dos props `initial*` (hidratados
 * do IndexedDB no boot) e notificam o pai via `onChapterChange/onZoomChange`
 * pra persistência. Internamente continuam useState.
 */
/**
 * Provedores que têm voz neural (TTS) compatível com o endpoint /api/tts.
 * Adicionado Grok (xAI) e Groq em 09/08 (pedido do Miguel) — ambos têm TTS.
 */
const NEURAL_TTS_PROVIDERS = new Set(["openai", "grok", "groq"]);

/**
 * Retorna a config de TTS (baseUrl, model, voice) pro provedor ativo, ou
 * null se o provedor não tem TTS. O baseUrl vem do config do usuário (se
 * custom) ou do preset do registry. Voz padrão: "nova" (OpenAI), "alloy"
 * (fallback universal OpenAI-compatible).
 */
function getNeuralTtsConfig(config: {
  providerId: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  label?: string;
}): { baseUrl: string; apiKey: string; model: string; voice: string; providerId: string; providerName: string } | null {
  if (!NEURAL_TTS_PROVIDERS.has(config.providerId)) return null;
  if (!(config.apiKey || "").trim()) return null;
  // baseUrl/model custom do usuário, senão defaults do preset.
  const PRESET_BASE: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    grok: "https://api.x.ai/v1",
    groq: "https://api.groq.com/openai/v1",
  };
  const baseUrl = config.baseUrl || PRESET_BASE[config.providerId] || PRESET_BASE.openai;
  // Modelo de TTS: se o usuário customizou um modelo de chat, ignoramos pra TTS
  // (TTS usa modelo específico). OpenAI = tts-1; demais = fallback tts-1.
  const model = "tts-1";
  const voice = getTtsVoice(); // voz escolhida pelo usuário nas Configurações
  return {
    baseUrl,
    apiKey: config.apiKey,
    model,
    voice,
    // Identidade pra telemetria de gastos (a voz neural usa a chave do usuário).
    providerId: config.providerId,
    providerName: config.label || config.providerId,
  };
}

export function Reader({
  book,
  pdfSource,
  onSelection,
  initialChapterIdx = 0,
  initialZoom = 1,
  onChapterChange,
  onZoomChange,
  onCloseBook,
  onOpenSettings,
  settingsOpen = false,
  onCloseSettings,
  onSettingsSaved,
  configReady = true,
  translations = {},
  onPageTranslation,
  notes = [],
  onRemoveNote,
  onSaveNote,
  bookmarks = [],
  onToggleBookmark,
  onGoToShelf,
  panelVisible = false,
  onTogglePanel,
  auth,
}: ReaderProps) {
  const { t, lang } = useI18n();
  const tts = useTTS();

  /** Lê a página atual em voz alta (na língua do livro). */
  const [ttsLoading, setTtsLoading] = useState(false);
  /**
   * Etapa da PREPARAÇÃO do áudio (mostrada no balão central):
   * "translate" = traduzindo o trecho pro idioma da fala;
   * "voice" = gerando a voz (TTS neural).
   */
  const [ttsPrep, setTtsPrep] = useState<null | "translate" | "voice">(null);
  /** Cronômetro da preparação (noção de quanto tá demorando). */
  const [ttsPrepSecs, setTtsPrepSecs] = useState(0);
  /** Geração da preparação: se mudar, o processo em andamento foi cancelado. */
  const ttsPrepGen = useRef(0);

  // Cronômetro do balão de preparação (roda enquanto ttsPrep != null).
  useEffect(() => {
    if (!ttsPrep) {
      setTtsPrepSecs(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(
      () => setTtsPrepSecs(Math.floor((Date.now() - start) / 1000)),
      500,
    );
    return () => clearInterval(id);
  }, [ttsPrep]);

  /** Cancela a preparação do áudio (balão some, nada toca). */
  const cancelTtsPrep = () => {
    ttsPrepGen.current++;
    setTtsPrep(null);
    setTtsLoading(false);
    tts.stop();
  };

  /**
   * Prepara o texto pra FALA conforme o idioma do áudio (⚙️ Config):
   *   - "original" (ou igual ao idioma do texto) → fala como está;
   *   - idioma diferente → TRADUZ PRIMEIRO na nuvem da IA e fala a
   *     tradução (ex.: livro em inglês, fala em português).
   * Devolve null se cancelado ou se a tradução falhou.
   */
  const prepareSpeech = async (
    text: string,
    textLang: string,
  ): Promise<{ text: string; lang: string } | null> => {
    const audioLang = getAudioLang();
    if (audioLang === "original" || audioLang === textLang) {
      return { text, lang: audioLang === "original" ? textLang : audioLang };
    }
    const gen = ttsPrepGen.current;
    setTtsPrep("translate");
    setTtsLoading(true);
    const res = await translateForSpeech(text, audioLang, {
      bookTitle: book.title,
      bookAuthor: book.author,
      bookLanguage: book.language,
    });
    if (gen !== ttsPrepGen.current) return null; // cancelado durante a tradução
    if (!res.ok || !res.text) {
      setTtsPrep(null);
      setTtsLoading(false);
      // Erro cru (ex.: "deepseek respondeu 401") só no console — o usuário
      // vê um aviso amigável na língua dele, com a saída (chave ⚙️ / original).
      console.warn("Tradução pra fala falhou:", res.error);
      alert(t("reader_speech_translate_error"));
      return null;
    }
    // AUTO-SAVE: a tradução gerada pra fala também vira nota.
    onSaveNote?.({
      kind: "translate",
      source: text.length > 500 ? `${text.slice(0, 500)}…` : text,
      result: res.text,
      chapterId: chapter?.id,
    });
    return { text: res.text, lang: audioLang };
  };

  /**
   * Aviso amigável (na língua do usuário) de que a voz natural precisa da
   * chave da OpenAI — mostra UMA VEZ por sessão pra não encher o saco.
   * A voz gratuita do dispositivo continua funcionando (fallback mecânico).
   * Modal com 2 botões: "Configurar voz neural" (→ /configuracoes) ou
   * "Seguir com voz mecânica gratuita" (só fala). Tem também "não mostrar
   * de novo" (grava no localStorage — depois muda em Configurações).
   */
  const [showTtsModal, setShowTtsModal] = useState(false);
  const warnNeuralKeyOnce = () => {
    if (typeof window === "undefined") return;
    // "Não mostrar de novo" = preferência persistente (não só da sessão).
    if (window.localStorage.getItem("moka.ttsWarned") === "1") return;
    if (sessionStorage.getItem("moka.ttsWarned") === "1") return;
    sessionStorage.setItem("moka.ttsWarned", "1");
    setShowTtsModal(true);
  };

  const readPageAloud = async () => {
    // Se tá pausado, CONTINUA de onde parou.
    if (tts.state === "paused") {
      tts.resume();
      return;
    }
    // Se tá tocando, PAUSA (não para — pode continuar).
    if (tts.state === "playing") {
      tts.pause();
      return;
    }
    if (ttsLoading) {
      cancelTtsPrep();
      return;
    }

    // Determina o texto a ler e o IDIOMA DELE (original do livro ou a
    // tradução visível na tela — cada um tem sua língua).
    let rawText = "";
    let textLang = "";

    if (showTranslation && pageTranslation && overlayMode === "translate") {
      rawText = pageTranslation;
      textLang = getTargetLang();
    } else {
      if (book.sourceFormat === "pdf") {
        rawText = currentPageText || chapter?.blocks.map((b) => b.text ?? "").join(" ") || "";
      } else {
        // EPUB: lê só a PÁGINA visível (não o capítulo corrido inteiro).
        rawText = blocksToText(currentBlocks, ". ");
      }
      textLang = book.language || "en";
    }

    if (!rawText.trim()) {
      alert(t("reader_no_text"));
      return;
    }

    // Se o idioma da FALA (⚙️) é diferente do idioma do texto, TRADUZ
    // PRIMEIRO na nuvem da IA — aí fala a tradução (ex.: livro em inglês,
    // fala em português). Com "original", fala no idioma do texto mesmo.
    const prepared = await prepareSpeech(rawText, textLang);
    if (!prepared) return;

    // Tenta voz NEURAL primeiro (se há entry marcada pra voz — OpenAI/Grok/Groq).
    const voiceConfig = getEntryForVoice();
    const ttsCfg = voiceConfig ? getNeuralTtsConfig(voiceConfig) : null;
    if (ttsCfg) {
      const gen = ttsPrepGen.current;
      setTtsPrep("voice");
      setTtsLoading(true);
      const neural = await tts.speakNeural(prepared.text, prepared.lang, ttsCfg);
      // Chave inválida/vencida (400/401/403): já caiu pra voz gratuita —
      // explica o que houve com um aviso amigável (1× por sessão).
      if (!neural.ok && (neural.status === 400 || neural.status === 401 || neural.status === 403)) {
        warnNeuralKeyOnce();
      }
      if (gen === ttsPrepGen.current) {
        setTtsLoading(false);
        setTtsPrep(null);
      }
      return;
    }

    // Não há provedor de TTS ativo. Mas há um (OpenAI/Grok/Groq) NO COFRE
    // inativo? Avisa que é só ativar — voz neural a um clique.
    const hasInactiveTts = listAllEntriesSync().some(
      (e) => NEURAL_TTS_PROVIDERS.has(e.providerId) && !e.active,
    );
    if (hasInactiveTts) {
      setShowTtsModal(false);
      alert(t("tts_neural_activate"));
      setTtsPrep(null);
      setTtsLoading(false);
      tts.speak(prepared.text, prepared.lang);
      return;
    }

    // Sem chave da OpenAI configurada: avisa (1× por sessão, na língua do
    // usuário) e segue com a voz GRATUITA do dispositivo.
    warnNeuralKeyOnce();

    // Usa voz NATIVA do dispositivo.
    setTtsPrep(null);
    setTtsLoading(false);
    tts.speak(prepared.text, prepared.lang);
  };
  const [chapterIdx, setChapterIdxState] = useState(initialChapterIdx);
  // Quando initialChapterIdx muda (IndexedDB carregou DEPOIS do render),
  // atualiza o chapterIdx. Isto é o que faltava pro cache funcionar.
  useEffect(() => {
    if (initialChapterIdx > 0 && initialChapterIdx !== chapterIdx) {
      setChapterIdxState(initialChapterIdx);
    }
  }, [initialChapterIdx]);
  // Salva no localStorage a CADA mudança de página (síncrono, não debounce).
  const goToChapter = useCallback((n: number) => {
    setChapterIdxState(n);
    if (typeof window !== "undefined" && book.title) {
      const key = "moka.chap." + book.title.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
      window.localStorage.setItem(key, String(n));
      window.localStorage.setItem("moka.lastChapter", String(n));
    }
    onChapterChange?.(n);
  }, [book.title, onChapterChange]);

  // ─── Diagnóstico de erros (pedido do Miguel, 13/08) ──────────────────
  // Instala o capturador de erros GLOBAIS 1x e mantém o "contexto" (livro/
  // página) atualizado pra o relatório sair completo quando algo falha.
  const [diagCopied, setDiagCopied] = useState(false);
  useEffect(() => {
    installGlobalErrorCapture();
  }, []);
  useEffect(() => {
    setDiagContext({
      bookTitle: book.title,
      bookAuthor: book.author,
      bookFormat: book.sourceFormat,
      pageLabel: `pág. ${chapterIdx + 1}`,
    });
  }, [book.title, book.author, book.sourceFormat, chapterIdx]);

  /** Copia o relatório de diagnóstico pro clipboard e mostra "Copiado!". */
  const handleCopyDiag = async () => {
    const ok = await copyDiagnostics();
    if (ok) {
      setDiagCopied(true);
      setTimeout(() => setDiagCopied(false), 2500);
    }
  };

  // Envio automático do diagnóstico pro suporte (pedido Miguel, 13/08):
  // o app manda o relatório pro info@ (via /api/report-error) + resposta
  // automática pro e-mail do usuário. Cai pro mailto se a rota falhar.
  const [diagSending, setDiagSending] = useState(false);
  const [diagSent, setDiagSent] = useState(false);
  const handleSendDiag = async () => {
    if (diagSending || diagSent) return;
    setDiagSending(true);
    try {
      const e = getLastError();
      const res = await fetch("/api/report-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report: buildReport(),
          userEmail: auth?.user?.email ?? "",
          userName: auth?.user?.user_metadata?.full_name ?? "",
          lang: getTargetLang(),
          kind: e?.kind ?? "erro",
          bookTitle: e?.bookTitle ?? book.title,
        }),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (res.ok && data.ok) {
        setDiagSent(true);
      } else {
        window.location.href = buildMailtoLink(); // fallback: abre o e-mail
      }
    } catch {
      window.location.href = buildMailtoLink(); // fallback: abre o e-mail
    } finally {
      setDiagSending(false);
    }
  };

  /** Página LOCAL dentro do capítulo (só EPUB — PDF tem 1 página por índice). */
  const [pageIdx, setPageIdx] = useState(0);
  /** Pulo pendente: ao trocar de capítulo, abre nesta página local (ex.: última ao voltar). */
  const pendingPage = useRef<number | null>(null);
  /** Janelas "Pergunte qualquer coisa" e "Resumo". */
  const [askOpen, setAskOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  // Hub 📊 (Suas IAs + Mural) — 1 ícone, 2 submenus (Miguel, 25/08).
  const [statsHubOpen, setStatsHubOpen] = useState(false);
  // Reforma 31/08 (ordem do Miguel): 3 BOTÕES GRANDES com submenu
  // (📖 Página · 📌 Marcar · 🎤 Perguntar) + menu "⋯" único à direita.
  const [bigMenu, setBigMenu] = useState<"page" | "mark" | "more" | null>(null);
  // LLM/modelo em uso (recado de espera — Miguel, 25/08: 'tem que dizer
  // você está usando a LLM X, modelo Y') + progresso estimado em %.
  const [textEntry, setTextEntry] = useState<{ providerName?: string; providerId: string; model?: string } | null>(null);
  const [pageProgress, setPageProgress] = useState(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  useEffect(() => {
    let alive = true;
    void import("@/lib/config")
      .then((mod) => mod.getEntryForText())
      .then((e) => {
        if (alive && e) setTextEntry(e);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [transBookOpen, setTransBookOpen] = useState(false);
  /** Escala da fonte de leitura (A−/A+) — persistida no localStorage. */
  const [fontScale, setFontScale] = useState(() => {
    if (typeof window === "undefined") return 1;
    const saved = Number(window.localStorage.getItem(FONT_SCALE_KEY));
    return saved >= FONT_SCALE_MIN && saved <= FONT_SCALE_MAX ? saved : 1;
  });
  // Dica inicial (só 1x por livro, guardado no localStorage por título)
  const [showTip, setShowTip] = useState(false);
  const [tipStep, setTipStep] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tipKey = `moka.tipShown.${book.title}`;
    if (!window.localStorage.getItem(tipKey)) {
      // Mostra a primeira dica após 1.5s (deixa a página carregar primeiro).
      const timer = setTimeout(() => { setShowTip(true); setTipStep(0); }, 1500);
      return () => clearTimeout(timer);
    }
  }, [book.title]);
  const nextTip = () => {
    if (tipStep < 2) {
      setTipStep(tipStep + 1);
    } else {
      setShowTip(false);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(`moka.tipShown.${book.title}`, "1");
      }
    }
  };
  const dismissTip = () => {
    setShowTip(false);
    setTipStep(0);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`moka.tipShown.${book.title}`, "1");
    }
  };
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    text: string;
    /** "above" = menu acima da seleção (padrão); "below" = quando não cabe em cima. */
    placement: "above" | "below";
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Canvas do PDF renderizado (pra snapshot/foto da página).
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Input de arquivo escondido (pra abrir novo livro direto do Reader).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [menuVisible, setMenuVisible] = useState(true);

  /** Entra/sai do modo tela cheia (só a página do livro visível). */
  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => {
        setIsFullscreen(true);
        setMenuVisible(false);
      }).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => {
        setIsFullscreen(false);
        setMenuVisible(true);
      }).catch(() => {});
    }
  };

  // Atualiza estado se sair do fullscreen via ESC ou mudar a tela.
  useEffect(() => {
    const onFsChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs) {
        setMenuVisible(true);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Garante que o menu superior fique SEMPRE visível ao abrir configurações,
  // ao carregar a obra, ao abrir modais (fala/tradução/ajuda) — cura definitiva
  // do BUG-20260801-MOKA-MENU-SUPERIOR-SOME: qualquer interação reexibe o menu.
  useEffect(() => {
    if (!isFullscreen) setMenuVisible(true);
    // Deps ampliadas (Miguel, 25/08): o menu sumiu ao FECHAR Anotações —
    // painel que não estava na lista. Todos os modais/painéis do leitor
    // agora reexibem o menu ao fechar.
  }, [book, settingsOpen, isFullscreen, showTtsModal, transBookOpen, askOpen, summaryOpen, notesOpen, bookmarksOpen, statsHubOpen]);

  // Cura da RECAÍDA (Miguel, 24/08: "voltei à página do livro e o menu
  // desapareceu — só metade do botão de zoom"): navegar pra outra página
  // AINDA EM TELA CHEIA congela o estado; o VOLTAR do navegador restaura
  // isFullscreen=true órfão (o fullscreen real já caiu com a navegação) e
  // nenhuma cura acima reexibe o menu (elas acreditam no estado interno).
  // Aqui conferimos a VERDADE do DOM: sem fullscreenElement, não há tela
  // cheia — corrija o estado e traga o menu de volta.
  useEffect(() => {
    if (isFullscreen && typeof document !== "undefined" && !document.fullscreenElement) {
      setIsFullscreen(false);
      setMenuVisible(true);
    }
  }, [isFullscreen, book]);

  /** Esta página já está marcada? Compara capítulo E página local
   *  (pedido Miguel, 13/08: "o 🔖 tem que aparecer só na página marcada"). */
  const isBookmarked = bookmarks.some((b) => b.chapterIdx === chapterIdx && (b.pageIdx ?? 0) === pageIdx);

  /** Marca/desmarca a página atual — salvando o rótulo + a página local + as
   *  primeiras ~50 palavras (pedido Miguel, 13/08). SEMPRE pede confirmação
   *  antes (avisozinho na língua do usuário). */
  const toggleBookmark = () => {
    const m = CONFIRM_MSGS[lang] ?? CONFIRM_MSGS["en"] ?? CONFIRM_MSGS["pt-BR"];
    if (!window.confirm(isBookmarked ? m.unmark : m.mark)) return;
    const preview = (currentPageText || "").trim().split(/\s+/).filter(Boolean).slice(0, 50).join(" ");
    onToggleBookmark?.(chapterIdx, { pageIdx, pageLabel, preview });
  };

  /**
   * Marcador invisível: clica no canto superior direito da página do livro
   * pra marcar/desmarcar. Zona de 60×60px discreta. Não interfere no texto.
   */
  const handleInvisibleMark = (e: React.MouseEvent) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const rect = scrollEl.getBoundingClientRect();
    // Canto superior direito (60×60px).
    const inCorner =
      e.clientX > rect.right - 60 && e.clientY < rect.top + 60;
    if (inCorner) {
      e.preventDefault();
      toggleBookmark();
    }
  };

  /**
   * Print da página atual: abre um iframe escondido com o texto do capítulo
   * e dispara o diálogo de impressão do navegador. Funciona em PDF (texto
   * extraído) e EPUB (conteúdo renderizado).
   */
  const printPage = () => {
    const titleText = `${book.title} — ${
      book.sourceFormat === "pdf"
        ? t("reader_page_n", { n: chapterIdx + 1 })
        : chapter?.title || t("reader_chapter_n", { n: chapterIdx + 1 })
    }`;
    // Coleta o texto: do currentPageText (PDF extraído) ou dos blocos da
    // página visível (EPUB paginado).
    const textContent =
      book.sourceFormat === "pdf"
        ? currentPageText ||
          chapter?.blocks.map((b) => b.text ?? b.items?.join(" ") ?? "").join("\n\n") ||
          ""
        : currentBlocks
            .map((b) => {
              if (b.type === "heading") return `${"#".repeat(b.level || 1)} ${b.text}`;
              if (b.type === "list") return (b.items ?? []).map((i) => `• ${i}`).join("\n");
              if (b.type === "quote") return `> ${b.text}`;
              if (b.type === "page-break") return "---";
              return b.text ?? "";
            })
            .join("\n\n");

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titleText}</title>
      <style>
        body{font-family:Georgia,serif;max-width:680px;margin:40px auto;padding:0 24px;line-height:1.7;color:#222}
        h1{font-size:18px;margin:0 0 4px}h2,h3,h4{margin:18px 0 6px}
        blockquote{border-left:3px solid #ccc;padding-left:12px;color:#555;font-style:italic}
        @media print{body{margin:0}}
      </style></head><body><h1>${titleText}</h1>${
        book.author ? `<p style="color:#888;font-size:13px">${book.author}</p>` : ""
      }<hr><div style="white-space:pre-wrap">${escapeHtml(textContent)}</div></body></html>`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 1000);
      }, 300);
    }
  };

  /**
   * Salva a página atual como imagem PNG no dispositivo do usuário.
   *
   * PDF: reaproveita o canvas em alta resolução já renderizado pelo pdfjs
   *      (inclui Retina/devicePixelRatio — fica nítido).
   * EPUB: desenha um canvas novo com a tipografia serifada do livro, fundo
   *       branco, título do capítulo e blocos de texto — uma "foto da página".
   *
   * O download usa um <a download> temporário (funciona em iOS Safari 14.5+
   * e Android Chrome). Em iOS mais antigo, abre num blob URL pra o usuário
   * segurar e salvar.
   */
  const savePageAsImage = () => {
    const safeTitle = (book.title || "livro").replace(/[^\w\u00C0-\u017F\s-]/g, "").trim().replace(/\s+/g, "_");
    const pageLabel = book.sourceFormat === "pdf" ? `pag${chapterIdx + 1}` : `cap${chapterIdx + 1}`;
    const fileName = `moka-${safeTitle}-${pageLabel}.png`;

    let canvas: HTMLCanvasElement | null = null;

    if (book.sourceFormat === "pdf" && pdfCanvasRef.current) {
      // PDF: usa o canvas já renderizado (inclui alta resolução Retina).
      canvas = pdfCanvasRef.current;
    } else {
      // EPUB: desenha a página num canvas novo.
      canvas = renderEpubToCanvas();
    }

    if (!canvas) return;

    try {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        // Dica visual antes de baixar (iOS mostra nome do arquivo).
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 2000);
      }, "image/png");
    } catch {
      // Fallback: alguns navegadores bloqueiam toBlob em canvas grande.
      alert(t("reader_photo_error"));
    }
  };

  /**
   * Desenha o conteúdo do capítulo EPUB num canvas (uma "foto da página").
   * Usa tipografia serifada, fundo branco, quebra de linha por palavra.
   * Mede o texto primeiro pra dimensionar o canvas na altura certa.
   */
  const renderEpubToCanvas = (): HTMLCanvasElement | null => {
    const ch = chapter;
    if (!ch) return null;
    // A "foto" é da PÁGINA visível (EPUB paginado), não do capítulo inteiro.
    const pageBlocks = currentBlocks;

    // Configurações tipográficas (espelham o .reader-text).
    const PAGE_W = 1000; // largura fixa em px (depois escala no CSS)
    const MARGIN = 64;
    const FONT = "20px Georgia, 'Times New Roman', serif";
    const LINE_H = 32;
    const H1_SIZE = "bold 30px Georgia, serif";
    const H1_LINE_H = 40;
    const COLOR = "#1a1a1a";
    const MUTED = "#777";

    // Mede largura do texto pra quebrar linhas.
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return null;
    measure.font = FONT;

    const wrapText = (text: string, maxWidth: number): string[] => {
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let line = "";
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (measure!.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    const maxW = PAGE_W - MARGIN * 2;
    // Constrói lista de blocos renderizáveis (tipo + linhas quebradas).
    type Block = { type: string; lines: string[] };
    const blocks: Block[] = [];
    let totalLines = 0;

    for (const b of pageBlocks) {
      let lines: string[] = [];
      let type = "p";
      if (b.type === "heading") {
        type = `h${b.level || 1}`;
        lines = wrapText(b.text ?? "", maxW);
        totalLines += lines.length + 1; // +1 espaçamento
      } else if (b.type === "list") {
        type = "li";
        for (const it of b.items ?? []) {
          const wrapped = wrapText(`• ${it}`, maxW);
          lines.push(...wrapped);
          totalLines += wrapped.length;
        }
        totalLines += 1;
      } else if (b.type === "quote") {
        type = "quote";
        lines = wrapText(b.text ?? "", maxW);
        totalLines += lines.length + 1;
      } else if (b.type === "page-break") {
        continue;
      } else {
        lines = wrapText(b.text ?? "", maxW);
        totalLines += lines.length + 1;
      }
      blocks.push({ type, lines });
    }

    // Altura do canvas = linhas * altura da linha + margens + título.
    const HEADER_H = 100; // título do livro + capítulo
    const canvasH = Math.max(800, HEADER_H + totalLines * LINE_H + MARGIN * 2);

    const canvas = document.createElement("canvas");
    const SCALE = 2; // alta nitidez (x2)
    canvas.width = PAGE_W * SCALE;
    canvas.height = canvasH * SCALE;
    canvas.style.width = `${PAGE_W}px`;
    canvas.style.height = `${canvasH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(SCALE, SCALE);

    // Fundo branco.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PAGE_W, canvasH);

    // Cabeçalho: título do livro (pequeno, cinza) + capítulo (maior).
    let y = MARGIN;
    ctx.fillStyle = MUTED;
    ctx.font = "italic 14px Georgia, serif";
    ctx.fillText(book.title.slice(0, 80), MARGIN, y);
    y += 22;
    ctx.fillStyle = COLOR;
    ctx.font = H1_SIZE;
    const chTitle = ch.title || t("reader_chapter_n", { n: chapterIdx + 1 });
    ctx.fillText(chTitle.slice(0, 90), MARGIN, y);
    y += H1_LINE_H;
    // Linha separadora.
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN, y);
    ctx.lineTo(PAGE_W - MARGIN, y);
    ctx.stroke();
    y += 32;

    // Blocos de texto.
    for (const blk of blocks) {
      if (blk.type.startsWith("h")) {
        ctx.fillStyle = COLOR;
        ctx.font = blk.type === "h1" ? "bold 26px Georgia, serif" : "bold 22px Georgia, serif";
        for (const ln of blk.lines) {
          ctx.fillText(ln, MARGIN, y);
          y += LINE_H;
        }
      } else if (blk.type === "quote") {
        ctx.fillStyle = MUTED;
        ctx.font = `italic ${FONT}`;
        // Indentação pra quote.
        for (const ln of blk.lines) {
          ctx.fillText(ln, MARGIN + 20, y);
          y += LINE_H;
        }
        ctx.fillStyle = COLOR;
        ctx.font = FONT;
      } else if (blk.type === "li") {
        ctx.fillStyle = COLOR;
        ctx.font = FONT;
        for (const ln of blk.lines) {
          ctx.fillText(ln, MARGIN + 16, y);
          y += LINE_H;
        }
      } else {
        ctx.fillStyle = COLOR;
        ctx.font = FONT;
        for (const ln of blk.lines) {
          ctx.fillText(ln, MARGIN, y);
          y += LINE_H;
        }
      }
      y += 12; // espaçamento entre blocos.
    }

    // Rodapé discreto com marca.
    ctx.fillStyle = "#bbb";
    ctx.font = "12px Georgia, serif";
    ctx.fillText("Moka · Cafezinho Media Group", MARGIN, canvasH - 24);

    return canvas;
  };

  // Aba ativa no modal unificado: "notes" | "bookmarks" | "audio"
  const [notesTab, setNotesTab] = useState<"notes" | "bookmarks" | "audio">("notes");

  // --- Resultado de trecho em fullscreen (painel flutuante) ---
  const [fsResult, setFsResult] = useState<string | null>(null);
  const [fsLoading, setFsLoading] = useState(false);
  const [fsAction, setFsAction] = useState<"translate" | "explain" | null>(null);

  /** Em fullscreen, processa seleção de trecho internamente (sem ir pro AIPanel externo). */
  const handleFsSelectionAction = async (
    action: "translate" | "explain",
    text: string,
  ) => {
    setFsAction(action);
    setFsLoading(true);
    setFsResult("");
    const ctx = { bookTitle: book.title, bookAuthor: book.author, bookLanguage: book.language };
    const onChunk = (full: string) => setFsResult(full);
    const res =
      action === "translate"
        ? await translateStream(text, ctx, onChunk)
        : await explainStream(text, ctx, onChunk);
    setFsLoading(false);
    if (res.ok && res.text) {
      setFsResult(res.text);
      // AUTO-SAVE: salva a tradução/explicação nas notas automaticamente.
      onSaveNote?.({
        kind: action,
        source: text,
        result: res.text,
        chapterId: chapter?.id,
      });
    } else {
      setFsResult(`⚠️ ${res.error ?? "Erro."}`);
    }
  };

  // --- Swipe horizontal: passar página passando o dedo ---
  // Threshold GENEROSO pra evitar trocas acidentais durante scroll/seleção.
  // Só vira "passar página" se o gesto for longo E claramente horizontal.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // BUG-20260723-IPAD-PAN: guarda o scrollLeft no início do gesto — se o
  // contêiner rolou na horizontal, o gesto era PAN do PDF (zoom), não
  // intenção de virar página.
  const panStartX = useRef<number | null>(null);
  const SWIPE_MIN = 80;         // mínimo de 80px pra contar como swipe
  const SWIPE_MAX_VERTICAL = 50; // se scrollou >50px na vertical, ignora (era scroll)
  // Em tela pequena (celular), só conta swipe se começou no centro da tela
  // (longe da borda esquerda/direita) pra não conflitar com o gesture de
  // "voltar" do navegador (swipe da borda).
  const EDGE_MARGIN = 30; // pixels de margem das bordas laterais

  // --- Pinch-to-zoom: pinça com 2 dedos pra aumentar/diminuir o zoom do PDF ---
  // Funciona em iPad/iPhone e Android. Mede a distância entre os 2 dedos
  // e ajusta o zoom proporcionalmente (igual Maps, Fotos, etc).
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartZoom = useRef<number>(1);

  const handleTouchStart = (e: React.TouchEvent) => {
    // PINCH: se tem 2 dedos na tela, captura a distância inicial.
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      pinchStartDist.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      pinchStartZoom.current = zoom;
      touchStart.current = null; // cancela swipe enquanto faz pinch
      return;
    }
    // SWIPE (1 dedo): só registra se não tava fazendo pinch.
    if (pinchStartDist.current !== null) return;
    const t = e.touches[0];
    // Não registra swipe se começou muito na borda (gesture de voltar do sistema).
    if (t.clientX < EDGE_MARGIN || t.clientX > window.innerWidth - EDGE_MARGIN) {
      return;
    }
    // Registra SEMPRE (mesmo sobre o texto). A decisão swipe-vs-seleção
    // acontece no touchend: se há texto selecionado, era seleção; senão,
    // gesto claramente horizontal = virar página. Com a página paginada,
    // a tela é quase toda texto — travar o swipe aqui matava o gesto.
    touchStart.current = { x: t.clientX, y: t.clientY };
    panStartX.current = scrollRef.current ? scrollRef.current.scrollLeft : null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // PINCH em andamento: ajusta o zoom conforme os dedos se aproximam/afastam.
    if (pinchStartDist.current === null || e.touches.length !== 2) return;
    // Previne o pinch-to-zoom do navegador (não queremos que ele faça zoom da página,
    // e sim do nosso PDF interno).
    e.preventDefault();
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    // Razão entre a distância atual e a inicial = quanto cresceu/encolheu.
    const ratio = dist / pinchStartDist.current;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(pinchStartZoom.current * ratio).toFixed(2)));
    setZoom(newZoom);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // Se tava fazendo pinch e soltou um dedo, termina o pinch.
    if (pinchStartDist.current !== null && e.touches.length < 2) {
      pinchStartDist.current = null;
      return;
    }
    // SWIPE (1 dedo).
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    // Descarta se: gesto curto, OU scrollou muito na vertical, OU não é
    // claramente horizontal (dx precisa ser pelo menos 2x o dy).
    if (absDx < SWIPE_MIN) return;
    if (absDy > SWIPE_MAX_VERTICAL) return;
    if (absDx < absDy * 2) return;
    // Se o contêiner ROLou na horizontal durante o gesto, era PAN do PDF
    // com zoom — não vira página (BUG-20260723-IPAD-PAN). Se já estava
    // colado na borda, o scrollLeft não muda e o swipe vira página normal.
    const scrollEl = scrollRef.current;
    if (scrollEl && panStartX.current !== null &&
        Math.abs(scrollEl.scrollLeft - panStartX.current) > 5) {
      panStartX.current = null;
      return;
    }
    panStartX.current = null;
    // Se o gesto SELECIONOU texto, era seleção — não vira página.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;
    if (dx > 0) goPrev(); // dedo da esquerda pra direita = anterior
    else goNext(); // dedo da direita pra esquerda = próxima
  };

  // iOS/Safari marca onTouchMove como "passive" por padrão, o que impede
  // e.preventDefault() (necessário pro pinch não disparar o zoom do navegador).
  // Este useEffect registra um listener NON-PASSIVE direto no DOM.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const preventPinch = (e: TouchEvent) => {
      // Só previne quando tem 2+ dedos (pinch). Com 1 dedo, deixa o scroll rolar.
      if (e.touches.length >= 2) e.preventDefault();
    };
    el.addEventListener("touchmove", preventPinch, { passive: false });
    return () => el.removeEventListener("touchmove", preventPinch);
  }, []);

  // Zoom e tradução de página (só fazem sentido pra PDF).
  const [zoom, setZoomState] = useState(initialZoom);
  const [pageTranslation, setPageTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [overlayMode, setOverlayMode] = useState<"translate" | "explain" | null>(null);
  const [translatingPage, setTranslatingPage] = useState(false);
  const [currentPageText, setCurrentPageText] = useState("");
  // BUG-20260809-MOKA-SLIDER-RENDER-RACE: rascunho do slider durante o
  // arrasto — o knob segue o dedo imediatamente, mas o salto de página real
  // só é commitado após 120ms de silêncio. Antes, cada micromovimento do
  // arrasto disparava um render completo que era cancelado logo em seguida;
  // a chuva de cancelamentos podia travar a página final em "Carregando…".
  const [sliderDraft, setSliderDraft] = useState<number | null>(null);
  const sliderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    },
    [],
  );

  const chapter = book.chapters[chapterIdx];
  const [pdfNumPages, setPdfNumPages] = useState(0);
  // Nav bar usa o MAIOR entre chapters.length e pdfNumPages (do PdfPageCanvas).
  // Isso garante que a barra nunca some, mesmo se chapters estiver vazio na nuvem.
  const totalChapters = Math.max(
    Array.isArray(book.chapters) ? book.chapters.length : 0,
    pdfNumPages,
  );

  // ── Paginação do EPUB ─────────────────────────────────────────────
  // PDF já é paginado por natureza (1 chapterIdx = 1 página). EPUB vinha
  // "correndo" (capítulo inteiro num scroll só) — aqui quebramos os blocos
  // de cada capítulo em páginas de ~EPUB_PAGE_CHARS caracteres.
  const isEpub = book.sourceFormat !== "pdf";
  const chapterPages = useMemo(
    () => (isEpub ? book.chapters.map((ch) => paginateBlocks(ch.blocks)) : null),
    [book, isEpub],
  );
  const pages = chapterPages ? chapterPages[chapterIdx] ?? [[]] : null;
  const safePageIdx = pages ? Math.min(pageIdx, pages.length - 1) : 0;
  /** Blocos da PÁGINA visível (EPUB: fatia do capítulo; PDF: capítulo todo). */
  const currentBlocks = pages ? pages[safePageIdx] ?? [] : chapter?.blocks ?? [];
  // Índice GLOBAL de página (soma das páginas de todos os capítulos) —
  // usado no slider, no contador e na barra de progresso.
  const pageOffsets = useMemo(() => {
    if (!chapterPages) return null;
    const offsets: number[] = [];
    let acc = 0;
    for (const p of chapterPages) {
      offsets.push(acc);
      acc += p.length;
    }
    return { offsets, total: acc };
  }, [chapterPages]);
  const totalPages = pageOffsets?.total ?? totalChapters;
  const globalPageIdx = pageOffsets ? pageOffsets.offsets[chapterIdx] + safePageIdx : chapterIdx;
  /** Chave da página pra mapa de traduções: "3" (PDF) ou "2.4" (EPUB cap.pag). */
  const pageKey = isEpub ? `${chapterIdx + 1}.${safePageIdx + 1}` : String(chapterIdx + 1);
  /** Rótulo amigável da página (pra modais de resumo/foto). */
  const pageLabel =
    book.sourceFormat === "pdf"
      ? t("reader_page_n", { n: chapterIdx + 1 })
      : `${chapter?.title || t("reader_chapter_n", { n: chapterIdx + 1 })} · ${t("reader_page_n", { n: safePageIdx + 1 })}`;

  /**
   * Compilação de trechos do livro inteiro (pro resumo 📚): título de cada
   * capítulo + o começo do seu texto, limitado a ~12k chars totais pra não
   * explodir o gasto de tokens. O prompt avisa que é uma amostra.
   */
  const buildBookCompilation = (): string => {
    const MAX_TOTAL = 12000;
    const PER_CHAPTER = 900;
    const parts: string[] = [];
    let size = 0;
    for (const ch of book.chapters) {
      const text = blocksToText(ch.blocks, " ").trim();
      if (!text) continue;
      const part = `### ${ch.title}\n${text.slice(0, PER_CHAPTER)}`;
      if (size + part.length > MAX_TOTAL) break;
      parts.push(part);
      size += part.length;
    }
    return parts.join("\n\n");
  };

  // Wrappers que atualizam o estado E avisam o pai (pra persistir).
  const setChapterIdx = (n: number | ((prev: number) => number)) => {
    setChapterIdxState((prev) => {
      const next = typeof n === "function" ? n(prev) : n;
      // Salva no localStorage a CADA mudança (síncrono — sobrevive a F5).
      if (typeof window !== "undefined" && book.title) {
        const key = "moka.chap." + book.title.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
        window.localStorage.setItem(key, String(next));
        window.localStorage.setItem("moka.lastChapter", String(next));
      }
      onChapterChange?.(next);
      return next;
    });
  };
  const setZoom = (n: number | ((prev: number) => number)) => {
    setZoomState((prev) => {
      const next = typeof n === "function" ? n(prev) : n;
      onZoomChange?.(next);
      return next;
    });
  };

  // Navegação por PÁGINA: no EPUB anda primeiro pelas páginas locais do
  // capítulo; na fronteira, troca de capítulo (indo pro fim/início dele).
  const goPrev = () => {
    if (pages && safePageIdx > 0) {
      setPageIdx((p) => p - 1);
      return;
    }
    if (chapterIdx > 0) {
      if (pages && chapterPages) {
        pendingPage.current = chapterPages[chapterIdx - 1].length - 1;
      }
      setChapterIdx((i) => Math.max(0, i - 1));
    }
  };
  const goNext = () => {
    if (pages && safePageIdx < pages.length - 1) {
      setPageIdx((p) => p + 1);
      return;
    }
    setChapterIdx((i) => Math.min(totalChapters - 1, i + 1));
  };

  /** Slider global: converte o índice global de página em (capítulo, página local). */
  const goToGlobalPage = (g: number) => {
    if (!chapterPages || !pageOffsets) {
      setChapterIdx(g);
      return;
    }
    let target = chapterPages.length - 1;
    for (let i = 0; i < chapterPages.length; i++) {
      if (g < pageOffsets.offsets[i] + chapterPages[i].length) {
        target = i;
        break;
      }
    }
    const local = g - pageOffsets.offsets[target];
    if (target === chapterIdx) {
      setPageIdx(local);
    } else {
      pendingPage.current = local;
      setChapterIdx(target);
    }
  };

  /** Slider da nav bar (BUG-20260809): o knob acompanha o dedo na hora
      (sliderDraft), mas o salto de página de verdade só acontece depois de
      120ms sem mover — evita a chuva de renders cancelados que travava a
      página final em "Carregando página…". */
  const handleSliderChange = (v: number) => {
    setSliderDraft(v);
    if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    sliderTimerRef.current = setTimeout(() => {
      sliderTimerRef.current = null;
      setSliderDraft(null);
      goToGlobalPage(v);
    }, 120);
  };

  // Ao trocar de CAPÍTULO: abre na página local pendente (navegação entre
  // capítulos) ou recomeça da primeira.
  useEffect(() => {
    setPageIdx(pendingPage.current ?? 0);
    pendingPage.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIdx]);

  // ─── Cache de POSIÇÃO EXATA (pedido Miguel, 13/08): antes o cache salvava
  // só o chapterIdx → reiniciava no começo do capítulo. Agora salva/restaura
  // o índice GLOBAL de página, voltando na página exata em que parou. ────
  const posKey = "moka.pos." + book.title.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  const restoredPos = useRef(false);
  // Restaura a posição exata UMA vez (depois que a paginação do EPUB carrega).
  useEffect(() => {
    if (restoredPos.current || typeof window === "undefined") return;
    if (isEpub && !chapterPages) return; // EPUB: espera a paginação carregar
    const saved = Number(window.localStorage.getItem(posKey));
    restoredPos.current = true;
    if (saved > 0 && saved < totalPages && saved !== globalPageIdx) {
      goToGlobalPage(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterPages, globalPageIdx]);
  // Salva a posição exata sempre que muda (só depois da 1ª restauração).
  useEffect(() => {
    if (!restoredPos.current || typeof window === "undefined") return;
    window.localStorage.setItem(posKey, String(globalPageIdx));
  }, [globalPageIdx, posKey]);

  // Ao trocar de PÁGINA (capítulo ou página local): RESTAURA do mapa de
  // traduções se houver tradução salva pra essa página (não re-traduz).
  // No EPUB, também define o "texto da página" = só o que está na tela
  // (alimenta traduzir/explicar página, TTS e resumo) e rola pro topo.
  useEffect(() => {
    const saved = translations[pageKey];
    if (saved) {
      setPageTranslation(saved);
      setShowTranslation(false);
    } else {
      setPageTranslation(null);
      setShowTranslation(false);
    }
    setOverlayMode(null);
    if (isEpub) {
      setCurrentPageText(blocksToText(currentBlocks, "\n\n"));
      scrollRef.current?.scrollTo({ top: 0 });
    } else {
      setCurrentPageText("");
    }
    setMenu(null);
    clearCustomHighlight(); // limpa highlight ao trocar de página
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIdx, safePageIdx]);

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));
  const zoomReset = () => setZoom(1);

  /** A−/A+ da FONTE (EPUB): a "chave de zoom" do canto superior direito. */
  const bumpFont = (dir: 1 | -1) => {
    const next = +Math.min(
      FONT_SCALE_MAX,
      Math.max(FONT_SCALE_MIN, fontScale + dir * FONT_SCALE_STEP),
    ).toFixed(2);
    setFontScale(next);
    window.localStorage.setItem(FONT_SCALE_KEY, String(next));
  };

  /** Captura a página PDF renderizada como imagem JPEG (data URL) para a
   *  IA de VISÃO — páginas de scan não têm texto selecionável (Miguel, 23/08:
   *  "traduzir até PDF de imagem"). Downscale p/ ~1500px: chega nítido pro
   *  modelo e economiza tokens. */
  const capturePageImage = (): string | null => {
    const c = pdfCanvasRef.current;
    if (!c || !c.width || !c.height) return null;
    const MAX_W = 1500;
    const scale = Math.min(1, MAX_W / c.width);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(c.width * scale));
    out.height = Math.max(1, Math.round(c.height * scale));
    const octx = out.getContext("2d");
    if (!octx) return null;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(c, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", 0.85);
  };

  // Traduz OU explica a página inteira. Estados SEPARADOS — um botão não
  // ativa o outro. overlayMode rastreia qual ação está sendo mostrada.
  const sourcePreviewOf = (ctx: "cancelled" | "page"): string =>
    ctx === "cancelled"
      ? `[tradução interrompida pelo usuário] ${pageLabel}`
      : currentPageText.length > 500
        ? `${currentPageText.slice(0, 500)}…`
        : currentPageText;

  const handlePageAction = async (
    action: "translate" | "explain" | "translate-image",
  ) => {
    // Se já estamos mostrando ESTA ação, toggle (esconde).
    if (overlayMode === action && showTranslation) {
      setShowTranslation(false);
      return;
    }
    // Se tem tradução salva e é translate, mostra ela sem re-traduzir.
    // (Erro "⚠️ …" NÃO é tradução salva: clicar de novo TENTA DE NOVO.)
    if (
      action === "translate" &&
      pageTranslation &&
      !pageTranslation.startsWith("⚠️") &&
      overlayMode !== "explain"
    ) {
      setOverlayMode("translate");
      setShowTranslation(true);
      return;
    }
    if ((!currentPageText && action !== "translate-image") || translatingPage)
      return;

    // Página-IMAGEM (Miguel, 23/08): captura o canvas no momento da ação.
    let pageImage: string | null = null;
    if (action === "translate-image") {
      pageImage = capturePageImage();
      if (!pageImage) {
        setPageTranslation(`⚠️ ${t("reader_scan_no_text")}`);
        return;
      }
    }

    setTranslatingPage(true);
    setPageProgress(0);
    cancelledRef.current = false;
    // BARRA DA ESPERA por TEMPO (Miguel, 26/08): antes do 1º chunk a IA está
    // "pensando" (thinking) e a barra ficava presa em 0%. Aqui ela sobe
    // gradualmente até 35% (rápido no início, desacelerando perto do teto);
    // quando o texto começa a chegar, o % real do texto assume (nunca volta).
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      setPageProgress((prev) => (prev >= 35 ? prev : prev + Math.max(0.4, (35 - prev) * 0.06)));
    }, 1200);
    setOverlayMode(action === "explain" ? "explain" : "translate");
    setPageTranslation("");
    setShowTranslation(true);

    const ctx = {
      bookTitle: book.title,
      bookAuthor: book.author,
      bookLanguage: book.language,
    };
    const alvoLen = Math.max(200, (action === "translate-image" ? 2500 : currentPageText.length) * 1.05 + 80);
    const onChunk = (full: string) => {
      setPageTranslation(full);
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setPageProgress((prev) =>
        Math.max(prev, Math.min(95, Math.round((full.length / alvoLen) * 100))),
      );
    };

    const result =
      action === "translate-image" && pageImage
        ? await translatePageImageStream(pageImage, ctx, onChunk)
        : action === "translate"
          ? await translatePageStream(currentPageText, ctx, onChunk, { shouldCancel: () => cancelledRef.current })
          : await explainPageStream(currentPageText, ctx, onChunk);

    setTranslatingPage(false);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    // CANCELADO pelo usuário (Miguel, 26/08): guarda a PARTE PRONTA que já
    // chegou como nota parcial (nada se perde do que já foi feito).
    if (result.cancelCut) {
      if (pageTranslation) {
        setPageTranslation(
          pageTranslation + `\n\n—\n⏹ ${t("reader_cancelled_partial")}`
        );
        onSaveNote?.({
          kind: "translate",
          source: sourcePreviewOf("cancelled"),
          result: pageTranslation,
          chapterId: chapter?.id,
        });
      } else {
        setPageTranslation(null);
      }
      setOverlayMode(null);
      return;
    }
    if (result.ok && result.text) {
      // Custo NÃO cola mais na página (Miguel, 25/08): só no pop-up.
      setPageProgress(100);
      setPageTranslation(result.text);
      if (action === "translate" || action === "translate-image") {
        onPageTranslation?.(pageKey, result.text);
      }
      // AUTO-SAVE: toda tradução/explicação de página inteira vai pra notas.
      // O source traz o trecho original da página (truncado pra não ficar enorme).
      const sourcePreview =
        action === "translate-image"
          ? `[página de imagem — traduzida por IA de visão] ${pageLabel}`
          : currentPageText.length > 500
            ? `${currentPageText.slice(0, 500)}…`
            : currentPageText;
      onSaveNote?.({
        kind: action === "translate-image" ? "translate" : action,
        source: sourcePreview,
        result: result.text,
        chapterId: chapter?.id,
      });
    } else {
      setPageTranslation(`⚠️ ${result.error ?? "Erro."}`);
      // Segunda camada de captura (garante pegar o erro mesmo se o toMessage
      // não capturar — ex.: stream cortado por timeout). Com contexto completo.
      captureError({
        kind: action === "translate" ? "translate-page" : "explain-page",
        message: result.error ?? "Erro.",
        textLen: currentPageText?.length,
        pageLabel,
        bookTitle: book.title,
        bookFormat: book.sourceFormat,
      });
    }
  };

  /** Atalho pra traduzir. */
  const handleTranslatePage = () => handlePageAction("translate");

  /** Rótulo dinâmico do botão conforme o estado. */
  const translateBtnLabel = translatingPage && overlayMode === "translate"
    ? t("reader_translating")
      : pageTranslation && overlayMode === "translate"
      ? showTranslation
        ? t("reader_view_original")
        : t("reader_view_translation")
      : t("reader_translate_page");

  /** Versão SÓ ÍCONE do botão de tradução (cabe numa linha só).
   *  O texto completo vai no `title` (tooltip ao passar o dedo/mouse). */
  const translateIcon = translatingPage && overlayMode === "translate"
    ? "⏳"
    : pageTranslation && overlayMode === "translate"
      ? showTranslation ? "📖" : "🌐"
      : "🌐";

  // Detecta seleção dentro do conteúdo e, se houver texto, mostra o menu.
  const handleSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setMenu(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text || text.length < 2) {
      setMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    const menuW = 300;
    const menuH = 52;
    const contW = containerRect?.width ?? 800;
    const rawX = rect.right - (containerRect?.left ?? 0);
    const clampedX = Math.max(menuW / 2 + 8, Math.min(contW - menuW / 2 - 8, rawX - menuW / 2));
    const relTop = rect.top - (containerRect?.top ?? 0);
    const placement: "above" | "below" = relTop < menuH + 16 ? "below" : "above";
    const y = placement === "above" ? relTop - 12 : rect.bottom - (containerRect?.top ?? 0) + 12;
    setMenu({ x: clampedX, y: Math.max(20, y), text, placement });
  };

  // Guard: ignora o próximo selectionchange causado pelo NOSSO removeAllRanges.
  // Movido pra CIMA das funções que o usam (snap/expand).
  const ignoreNextSelChange = useRef(false);

  /**
   * Botão "⇤" do menu de seleção: move o INÍCIO da seleção pro começo do
   * parágrafo onde ela começa, mantendo o fim. Saída determinística pra
   * quando a alça do iOS escorrega — não depende de heurística nenhuma.
   */
  const snapSelectionStartToParagraph = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const startEl =
      range.startContainer.nodeType === 1
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const startBlock = startEl?.closest(
      "p, h1, h2, h3, h4, h5, h6, blockquote, li",
    );
    const newRange = range.cloneRange();
    if (startBlock) {
      newRange.setStart(startBlock, 0);
    } else {
      // PDF: a camada de texto não tem <p> — acha o começo do parágrafo
      // pela geometria das linhas (indento, espaçamento, fonte, margem).
      const pdf = pdfParagraphSpanRange(range);
      if (!pdf) return;
      newRange.setStart(pdf.first, 0);
    }
    sel.removeAllRanges();
    sel.addRange(newRange);
    // No iPad, a seleção recém-adicionada pode não estar disponível
    // sincronicamente — dá um respiro antes de reabrir o menu.
    setTimeout(() => handleSelection(), 50);
  };

  /**
   * Botão "¶" do menu de seleção: expande a seleção pro(s) parágrafo(s)
   * inteiro(s) que ela toca. Útil no iOS, onde a alça inicial às vezes
   * "escorrega" pra segunda linha — um toque corrige sem brigar com a alça.
   */
  const expandSelectionToParagraph = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const asEl = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement);
    const startBlock = asEl(range.startContainer)?.closest(
      "p, h1, h2, h3, h4, h5, h6, blockquote, li",
    );
    const endBlock = asEl(range.endContainer)?.closest(
      "p, h1, h2, h3, h4, h5, h6, blockquote, li",
    );
    const newRange = document.createRange();
    if (startBlock && endBlock) {
      newRange.setStart(startBlock, 0);
      newRange.setEnd(endBlock, endBlock.childNodes.length);
    } else {
      // PDF: a camada de texto não tem <p> — expande até os limites do(s)
      // parágrafo(s) pela geometria das linhas.
      const pdf = pdfParagraphSpanRange(range);
      if (!pdf) return;
      newRange.setStart(pdf.first, 0);
      newRange.setEnd(pdf.last, pdf.last.childNodes.length);
    }
    // Guard: evita que o selectionchange feche o menu.
    ignoreNextSelChange.current = true;
    sel.removeAllRanges();
    sel.addRange(newRange);
    // No iPad, dá um respiro antes de reabrir o menu (seleção assíncrona).
    setTimeout(() => handleSelection(), 50);
  };

  /**
   * Escuta mudanças de seleção no documento (funciona em mouse E touch).
   * No iPad/touch puro, o onMouseUp às vezes não dispara depois de arrastar
   * pra selecionar — o selectionchange é o evento confiável. Mostra o menu
   * quando a seleção estabiliza (debounce curto: 180ms pra aparecer antes do
   * menu nativo do iOS, que costuma demorar ~300ms).
   */

  /** Limpa o highlight customizado (chamar ao trocar página/fechar menu). */
  const clearCustomHighlight = useCallback(() => {
    if (typeof CSS !== "undefined" && "highlights" in CSS) {
      (CSS as any).highlights.delete("moka-sel");
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      // Guard: se fomos nós que limpamos a seleção, ignora o evento.
      if (ignoreNextSelChange.current) {
        ignoreNextSelChange.current = false;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setMenu(null);
          clearCustomHighlight();
          return;
        }
        const text = sel.toString().trim();
        if (!text || text.length < 2) {
          setMenu(null);
          clearCustomHighlight();
          return;
        }
        // Só mostra o menu se a seleção está DENTRO do reader.
        const range = sel.getRangeAt(0);
        if (!containerRef.current?.contains(range.commonAncestorContainer)) {
          return;
        }
        const rect = range.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();
        const menuW = 300;
        const menuH = 52;
        const rawX = rect.right - (containerRect?.left ?? 0);
        const contW = containerRect?.width ?? 800;
        const clampedX = Math.max(menuW / 2 + 8, Math.min(contW - menuW / 2 - 8, rawX - menuW / 2));
        const relTop = rect.top - (containerRect?.top ?? 0);
        const placement: "above" | "below" = relTop < menuH + 16 ? "below" : "above";
        const y = placement === "above" ? relTop - 12 : rect.bottom - (containerRect?.top ?? 0) + 12;

        // NÃO limpa a seleção nem usa removeAllRanges (quebra a seleção no iOS).
        // O menu nativo pode aparecer junto, mas nosso menu tem z-index alto
        // e posição diferente (acima/direita) pra não conflitar tanto.
        // No celular, o menu nosso fica no rodapé (longe do nativo).
        setMenu({ x: clampedX, y: Math.max(20, y), text, placement });
      }, 500);
    };
    document.addEventListener("selectionchange", check);
    return () => {
      document.removeEventListener("selectionchange", check);
      if (timer) clearTimeout(timer);
    };
  }, [clearCustomHighlight]);

  /**
   * ASSISTENTE anti-escorregão (iOS): ao SOLTAR o dedo, se a seleção
   * começou logo depois da 1ª palavra do parágrafo (assinatura clássica
   * do deslize: o iOS re-ancora a alça no começo da palavra 2 por causa
   * das caixas de linha altas), estica o início de volta pro começo do
   * parágrafo. Só age no FIM do gesto — mexer na seleção DURANTE o
   * arraste quebra a alça do iOS. Se o usuário realmente quiser começar
   * na 2ª palavra, o botão ¶ e um novo arraste continuam disponíveis.
   */
  useEffect(() => {
    const fixSlippedStart = () => {
      // Pequeno atraso: no touchend a seleção ainda está assentando.
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const startEl =
          range.startContainer.nodeType === 1
            ? (range.startContainer as Element)
            : range.startContainer.parentElement;
        const block = startEl?.closest(
          "p, h1, h2, h3, h4, h5, h6, blockquote, li",
        );
        if (!block || !containerRef.current?.contains(block)) return;
        // Texto entre o começo do parágrafo e o começo da seleção.
        const pre = document.createRange();
        pre.selectNodeContents(block);
        pre.setEnd(range.startContainer, range.startOffset);
        const prefix = pre.toString();
        // Caso 1 — deslize clássico: ficou de fora só a 1ª palavra.
        if (/^\S+\s+$/.test(prefix)) {
          const fixed = range.cloneRange();
          fixed.setStart(block, 0);
          sel.removeAllRanges();
          sel.addRange(fixed);
          handleSelection(); // reabre o menu com o texto corrigido
          return;
        }
        // Caso 2 — a âncora caiu no FIM do parágrafo ANTERIOR (arrastou
        // pro vão e o iOS ancorou pra cima) e a seleção segue pro bloco
        // seguinte. Mover o início pro começo do próximo bloco não perde
        // texto nenhum (do bloco atual nada foi selecionado).
        const post = document.createRange();
        post.selectNodeContents(block);
        post.setStart(range.startContainer, range.startOffset);
        const next = block.nextElementSibling;
        if (
          post.toString().trim() === "" &&
          next?.matches("p, h1, h2, h3, h4, h5, h6, blockquote, li") &&
          !block.contains(range.endContainer)
        ) {
          const fixed = range.cloneRange();
          fixed.setStart(next, 0);
          sel.removeAllRanges();
          sel.addRange(fixed);
          handleSelection();
        }
      }, 60);
    };
    document.addEventListener("touchend", fixSlippedStart, { passive: true });
    document.addEventListener("mouseup", fixSlippedStart);
    return () => {
      document.removeEventListener("touchend", fixSlippedStart);
      document.removeEventListener("mouseup", fixSlippedStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Toque duplo (double-click/double-tap): seleciona o parágrafo inteiro
   * sob o cursor. Muito útil em touch, onde arrastar pra selecionar é
   * impreciso. Encontra o ancestral <p> (ou block mais próximo) e seleciona
   * todo o seu conteúdo, depois dispara o menu Traduzir/Explicar.
   */
  const handleDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Sobe até achar um parágrafo, heading, quote ou listItem.
    const block = target.closest("p, h1, h2, h3, h4, h5, h6, blockquote, li, span");
    if (!block) return;

    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(block);
    sel.removeAllRanges();
    sel.addRange(range);

    // Dispara o menu na posição do parágrafo.
    const rect = block.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    const text = sel.toString().trim();
    if (text.length >= 2) {
      const menuW = 300;
      const menuH = 52;
      const contW = containerRect?.width ?? 800;
      const rawX = rect.right - (containerRect?.left ?? 0);
      const clampedX = Math.max(menuW / 2 + 8, Math.min(contW - menuW / 2 - 8, rawX - menuW / 2));
      const relTop = rect.top - (containerRect?.top ?? 0);
      const placement: "above" | "below" = relTop < menuH + 16 ? "below" : "above";
      const y = placement === "above" ? relTop - 12 : rect.bottom - (containerRect?.top ?? 0) + 12;
      setMenu({ x: clampedX, y: Math.max(20, y), text, placement });
    }
  };

  const fire = (type: "translate" | "explain") => {
    if (!menu) return;
    if (isFullscreen) {
      // Em fullscreen, processa internamente (painel flutuante).
      handleFsSelectionAction(type, menu.text);
    } else {
      // Normal: manda pro AIPanel externo.
      onSelection({
        type,
        text: menu.text,
        chapterId: chapter?.id,
      });
    }
    setMenu(null);
    clearCustomHighlight();
    window.getSelection()?.removeAllRanges();
  };

  /** Lê um trecho selecionado em voz alta (neural ou nativa). */
  const fireSpeak = async (text: string) => {
    setMenu(null);
    clearCustomHighlight();
    window.getSelection()?.removeAllRanges();
    if (tts.state === "playing") tts.stop();

    // Respeita o idioma da fala: se for diferente do livro, traduz antes.
    const prepared = await prepareSpeech(text, book.language || "en");
    if (!prepared) return;

    const voiceConfig = getEntryForVoice();
    const ttsCfg = voiceConfig ? getNeuralTtsConfig(voiceConfig) : null;
    if (ttsCfg) {
      const gen = ttsPrepGen.current;
      setTtsPrep("voice");
      setTtsLoading(true);
      const neural = await tts.speakNeural(prepared.text, prepared.lang, ttsCfg);
      // Chave inválida (400/401/403): já caiu pra voz gratuita — avisa 1×.
      if (!neural.ok && (neural.status === 400 || neural.status === 401 || neural.status === 403)) {
        warnNeuralKeyOnce();
      }
      if (gen === ttsPrepGen.current) {
        setTtsLoading(false);
        setTtsPrep(null);
      }
    } else {
      // Sem provedor de TTS ativo. Mas há um (OpenAI/Grok/Groq) NO COFRE
      // inativo? Avisa que é só ativar.
      const hasInactiveTts = listAllEntriesSync().some(
        (e) => NEURAL_TTS_PROVIDERS.has(e.providerId) && !e.active,
      );
      if (hasInactiveTts) {
        alert(t("tts_neural_activate"));
      } else {
        // Sem TTS nenhum: aviso genérico (1×).
        warnNeuralKeyOnce();
      }
      setTtsPrep(null);
      setTtsLoading(false);
      tts.speak(prepared.text, prepared.lang);
    }
  };

  /** Para o áudio completamente (diferente de pausar). */
  const stopTTS = () => {
    cancelTtsPrep();
  };

  const renderedBlocks = useMemo(
    () => currentBlocks.map((b) => <BlockView key={b.id} block={b} />),
    [currentBlocks],
  );

  return (
    <section className="reader" ref={containerRef} data-menu-hidden={!menuVisible}>
      {/* Botão flutuante da xicrinha (☕) para reexibir o menu quando oculto */}
      {!menuVisible && (
        <button
          onClick={() => setMenuVisible(true)}
          className="moka-teacup-float-btn"
          title={t("reader_show_menu")}
          aria-label={t("reader_show_menu")}
        >
          ☕
        </button>
      )}

      <header className="reader-header" data-hidden={!menuVisible}>
        {/* ── Menu: row-scroll (ações do livro, scrollável) + row-right (controles, fixo) ── */}
        <div className="reader-row-main">
        <div className="reader-row-scroll">
          {/* Logo Cafezinho — canto esquerdo, vai para a home central (/) */}
          <a
            href="/"
            className="cafezinho-mark"
            title={t("reader_home_title")}
            aria-label={t("reader_home_title")}
          >
            <CafezinhoLogo size={26} opacity={0.85} />
          </a>
          {/* ➕ Abrir novo arquivo (dispara seletor de arquivo direto) */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="icon-btn"
            title={t("reader_open_new")}
            aria-label={t("reader_open_new")}
          >
            ➕
          </button>
          {/* 📚 Estante */}
          <button
            onClick={() => onGoToShelf?.()}
            className="icon-btn"
            title={t("reader_shelf")}
            aria-label={t("reader_shelf")}
          >
            📚
          </button>
          {/* ⏹ Stop áudio (só aparece quando tem áudio rolando) */}
          {(tts.state !== "idle" || ttsLoading) && (
            <button
              onClick={stopTTS}
              className="icon-btn tts-stop-btn"
              title={t("reader_stop")}
              aria-label={t("reader_stop")}
            >
              ⏹
            </button>
          )}

        </div>
        {/* ══ REFORMA 31/08 (ordem do Miguel): 3 BOTÕES GRANDES com
            submenu — "página inteira ler/explicar num só; marcar/foto num
            só; microfone pra perguntar" — bem visíveis, abrem submenu. ══ */}
        <div className="reader-big-group">
          {/* ── 📖 PÁGINA — ler em voz alta, resumir/explicar, traduzir ── */}
          <div className="reader-big-wrap">
            <button
              type="button"
              className={`reader-big-btn ${bigMenu === "page" ? "open" : ""}`}
              onClick={() => setBigMenu((v) => (v === "page" ? null : "page"))}
              aria-expanded={bigMenu === "page"}
              aria-haspopup="menu"
            >
              <span className="reader-big-ico" aria-hidden>📖</span>
              <span className="reader-big-label">{t("reader_big_page")}</span>
              <span className="reader-big-caret" aria-hidden>▾</span>
            </button>
            {bigMenu === "page" && (
              <>
                <div className="big-menu-backdrop" onClick={() => setBigMenu(null)} />
                <div className="reader-big-menu" role="menu">
                  {/* 🔊 Ler em voz alta (TTS) — neural (IA) ou nativa */}
                  <button
                    type="button"
                    role="menuitem"
                    className="reader-big-item"
                    onClick={() => {
                      setBigMenu(null);
                      if (tts.state === "paused") { tts.resume(); return; }
                      if (tts.state === "playing") { tts.pause(); return; }
                      if (confirm(t("reader_confirm_audio"))) readPageAloud();
                    }}
                    disabled={!tts.supported}
                  >
                    <span aria-hidden>{ttsLoading ? "⏳" : tts.state === "playing" ? "⏸" : tts.state === "paused" ? "▶️" : "🔊"}</span>
                    <span>
                      {ttsLoading ? t("reader_preparing_audio")
                      : tts.state === "playing" ? t("reader_pause")
                      : tts.state === "paused" ? t("reader_resume")
                      : t("reader_read_aloud")}
                    </span>
                  </button>
                  {/* 📝 Resumir / Explicar a página (com barra de tamanho) */}
                  <button
                    type="button"
                    role="menuitem"
                    className="reader-big-item"
                    onClick={() => { setBigMenu(null); setSummaryOpen(true); }}
                  >
                    <span aria-hidden>📝</span> <span>{t("pa_title")}</span>
                  </button>
                  {/* 🌐 Traduzir a página na tela */}
                  <button
                    type="button"
                    role="menuitem"
                    className="reader-big-item"
                    onClick={() => {
                      setBigMenu(null);
                      if (overlayMode === "translate" && showTranslation) {
                        setShowTranslation(false);
                        return;
                      }
                      if (!currentPageText) {
                        if (capturePageImage()) {
                          (async () => {
                            const est = await estimateImagePageCostUsd();
                            const costTxt = est > 0
                              ? est < 0.01 ? `US$ ${est.toFixed(4)}` : `US$ ${est.toFixed(2)}`
                              : t("reader_vision_cost_unknown");
                            if (confirm(t("reader_vision_confirm", { cost: costTxt }))) {
                              handlePageAction("translate-image");
                            }
                          })();
                          return;
                        }
                        alert(t("reader_scan_no_text"));
                        return;
                      }
                      if (confirm(t("reader_confirm_translate_page"))) {
                        handleTranslatePage();
                      }
                    }}
                    disabled={translatingPage}
                  >
                    <span aria-hidden>{translatingPage && overlayMode === "translate" ? "⏳" : "🌐"}</span>
                    <span>{t("reader_menu_translate_page")}</span>
                  </button>
                  {/* 🌍 Traduzir o LIVRO INTEIRO em volumes (só EPUB) */}
                  {isEpub && (
                    <button
                      type="button"
                      role="menuitem"
                      className="reader-big-item"
                      onClick={() => { setBigMenu(null); setTransBookOpen(true); }}
                    >
                      <span aria-hidden>🌍</span> <span>{t("tb_icon")}</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── 📌 MARCAR — marcar página, foto, notas ── */}
          <div className="reader-big-wrap">
            <button
              type="button"
              className={`reader-big-btn ${bigMenu === "mark" ? "open" : ""}`}
              onClick={() => setBigMenu((v) => (v === "mark" ? null : "mark"))}
              aria-expanded={bigMenu === "mark"}
              aria-haspopup="menu"
            >
              <span className="reader-big-ico" aria-hidden>📌</span>
              <span className="reader-big-label">{t("reader_big_mark")}</span>
              <span className="reader-big-caret" aria-hidden>▾</span>
            </button>
            {bigMenu === "mark" && (
              <>
                <div className="big-menu-backdrop" onClick={() => setBigMenu(null)} />
                <div className="reader-big-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={`reader-big-item ${isBookmarked ? "active" : ""}`}
                    onClick={() => { setBigMenu(null); toggleBookmark(); }}
                    aria-pressed={isBookmarked}
                  >
                    <span aria-hidden>{isBookmarked ? "🔖" : "🏷"}</span>
                    <span>{isBookmarked ? t("reader_bookmark_remove") : t("reader_bookmark")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="reader-big-item"
                    onClick={() => {
                      setBigMenu(null);
                      if (confirm(t("reader_confirm_photo", { page: pageLabel }))) {
                        savePageAsImage();
                      }
                    }}
                  >
                    <span aria-hidden>📸</span> <span>{t("reader_photo")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="reader-big-item"
                    onClick={() => { setBigMenu(null); setNotesOpen(true); }}
                  >
                    <span aria-hidden>📓</span>
                    <span>{t("reader_notes")}{notes.length > 0 ? ` (${notes.length})` : ""}</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── 🎤 PERGUNTAR — qualquer coisa sobre a página/livro ── */}
          <button
            type="button"
            className="reader-big-btn"
            onClick={() => setAskOpen(true)}
            title={t("reader_ask_anything")}
            aria-label={t("reader_ask_anything")}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="6" y="2" width="6" height="10.5" rx="3" />
              <path d="M3.5 10.5a5.5 5.5 0 0 0 9.4 3.9" />
              <path d="M14.2 20.4l4.9-4.9a1.56 1.56 0 0 1 2.2 2.2l-4.9 4.9-2.9.7z" fill="currentColor" stroke="none" />
            </svg>
            <span className="reader-big-label">{t("reader_big_ask")}</span>
          </button>
        </div>
        {/* Fim reader-row-scroll. Início reader-row-right (controles fixos). */}
          <div className="reader-row-right">
            <LangSwitcher />
            {/* 👤 Login (AuthGate: Google OU e-mail) */}
            {auth && <AuthGate />}
            {/* ══ Reforma 31/08 (ordem do Miguel): "esse menu da direita —
                ajuda, suas IAs/telemetria, mural e configurações TUDO NUM
                SÓ". A bandeirinha de idioma fica de fora, solta. ══ */}
            <div className="reader-big-wrap">
              <button
                type="button"
                className={`reader-big-btn reader-more-btn ${bigMenu === "more" ? "open" : ""}`}
                onClick={() => setBigMenu((v) => (v === "more" ? null : "more"))}
                aria-expanded={bigMenu === "more"}
                aria-haspopup="menu"
                title={t("reader_menu_more")}
                aria-label={t("reader_menu_more")}
              >
                <span className="reader-big-ico" aria-hidden>☰</span>
                <span className="reader-big-caret" aria-hidden>▾</span>
              </button>
              {bigMenu === "more" && (
                <>
                  <div className="big-menu-backdrop" onClick={() => setBigMenu(null)} />
                  <div className="reader-big-menu reader-more-menu" role="menu">
                    <a href="/ajuda" target="_blank" rel="noreferrer" role="menuitem" className="reader-big-item">
                      <span aria-hidden>❓</span> <span>{t("help_title")}</span>
                    </a>
                    <Link href="/telemetria" role="menuitem" className="reader-big-item" onClick={() => setBigMenu(null)}>
                      <span aria-hidden>📊</span> <span>{tt(lang, "tele_nav")}</span>
                    </Link>
                    <Link href="/mural-das-ias" role="menuitem" className="reader-big-item" onClick={() => setBigMenu(null)}>
                      <span aria-hidden>🏆</span> <span>{tt(lang, "tele_mural_btn")}</span>
                    </Link>
                    {onOpenSettings && (
                      <button
                        type="button"
                        role="menuitem"
                        className={`reader-big-item ${configReady ? "" : "muted-unset"}`}
                        onClick={() => { setMenuVisible(true); setBigMenu(null); onOpenSettings(); }}
                      >
                        <span aria-hidden>⚙️</span> <span>{t("reader_settings")}</span>
                        {!configReady && <span className="badge-dot" aria-hidden />}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Barra de progresso de leitura (estilo Kindle) */}
        <div className="reader-progress" aria-hidden>
          <div
            className="reader-progress-bar"
            style={{ width: `${totalPages > 0 ? ((globalPageIdx + 1) / totalPages) * 100 : 0}%` }}
          />
        </div>
      </header>

      {/* Zoom VERTICAL no canto superior direito — pra TODO livro:
          PDF: +/− dão zoom na página. EPUB: +/− aumentam/reduzem a FONTE.
          Some quando o menu é ocultado (fullscreen). */}
      <div className="zoom-rail" data-hidden={!menuVisible} title={t("reader_zoom")}>
        <button
          onClick={() => (isEpub ? bumpFont(1) : zoomIn())}
          disabled={isEpub ? fontScale >= FONT_SCALE_MAX : zoom >= MAX_ZOOM}
          aria-label={isEpub ? t("reader_font_increase") : t("reader_zoom_in")}
          title={isEpub ? t("reader_font_increase") : t("reader_zoom_in")}
          className="zoom-rail-btn"
        >
          +
        </button>
        <button
          onClick={() => (isEpub ? bumpFont(-1) : zoomOut())}
          disabled={isEpub ? fontScale <= FONT_SCALE_MIN : zoom <= MIN_ZOOM}
          aria-label={isEpub ? t("reader_font_decrease") : t("reader_zoom_out")}
          title={isEpub ? t("reader_font_decrease") : t("reader_zoom_out")}
          className="zoom-rail-btn"
        >
          −
        </button>
        {/* ⛶ Tela cheia + 👁 esconder menu vieram DO HEADER pra cá (Miguel,
            25/08: "deixar o ícone de maximizar e o olho de esconder o menu
            logo abaixo/da chave de +− do zoom" — o menu de cima tinha itens
            demais e quebrava em 2 linhas). Mantida a cura 09/08: 👁 só age
            em fullscreen (modo imersivo explícito). */}
        <button
          onClick={toggleFullscreen}
          className="zoom-rail-btn"
          title={isFullscreen ? t("reader_exit_fullscreen") : t("reader_fullscreen")}
          aria-label={isFullscreen ? t("reader_exit_fullscreen") : t("reader_fullscreen")}
        >
          {isFullscreen ? "🗗" : "⛶"}
        </button>
        {/* 👁 DESTRAVADOR UNIVERSAL (ideia do Miguel, 25/08 — após o menu
            sumir de novo ao fechar Anotações): fora de fullscreen, clicar
            SEMPRE TRAZ o menu de volta (destrava qualquer estado preso);
            em fullscreen, alterna mostrar/esconder como antes. */}
        <button
          onClick={() => {
            if (!isFullscreen) {
              setIsFullscreen(false);
              setMenuVisible(true);
            } else {
              setMenuVisible((v) => !v);
            }
          }}
          className="zoom-rail-btn"
          title={menuVisible ? t("reader_hide_menu") : t("reader_show_menu")}
          aria-label={menuVisible ? t("reader_hide_menu") : t("reader_show_menu")}
        >
          {menuVisible ? "👁" : "🙈"}
        </button>
        {/* Indicador de marcador (pedido Miguel, 13/08): aparece 🔖 na "chave
            de zoom" (direita) quando a página atual está marcada. */}
        {isBookmarked && (
          <div className="zoom-rail-bookmark" title={t("reader_bookmark")}>🔖</div>
        )}
      </div>

      <div
        ref={scrollRef}
        className={`reader-scroll ${book.sourceFormat === "pdf" ? "pdf-mode" : ""}`}
        onDoubleClick={handleDoubleClick}
        onClick={handleInvisibleMark}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {book.sourceFormat === "pdf" && pdfSource ? (
          <PdfPageCanvas
            data={pdfSource}
            pageNum={chapterIdx + 1}
            zoom={zoom}
            translationOverlay={pageTranslation}
            showTranslation={showTranslation}
            translating={translatingPage}
            onPageText={setCurrentPageText}
            onCanvasReady={(c) => (pdfCanvasRef.current = c)}
            onNumPages={setPdfNumPages}
            modelHint={
              textEntry
                ? `🤖 ${textEntry.providerName || textEntry.providerId}${textEntry.model ? ` · ${textEntry.model}` : ""}`
                : undefined
            }
            progress={translatingPage ? pageProgress : undefined}
          />
        ) : showTranslation && overlayMode === "translate" ? (
          /* Tradução da página inteira em EPUB: troca o conteúdo da área da
             página. BUG (Miguel, 04/08 — "cliquei, veio a ampulheta e não
             traduziu"): antes a tradução só aparecia em PDF; em EPUB o
             resultado nunca era renderizado. E a espera agora é EXPLÍCITA:
             a página toda mostra o estado (pedido do Miguel). */
          <article
            className="reader-text"
            style={{ fontSize: `calc(var(--text-lg) * ${fontScale})` }}
          >
            {/* BARRA DE PROGRESSO viva durante TODA a tradução (Miguel, 26/08):
                antes só existia DENTRO do recado de espera — quando o texto
                começava a chegar, o recado sumia e a barra morria em 0%.
                Agora encima do texto que vai fluindo, enchendo de verdade. */}
            {translatingPage && pageTranslation && (
              <>
                <div className="page-ai-progress-bar-top" role="progressbar" aria-valuenow={pageProgress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="page-ai-progress-fill" style={{ width: `${Math.round(pageProgress)}%` }} />
                  <span className="page-ai-progress-label">{Math.round(pageProgress)}% · {t("reader_translating")}</span>
                </div>
                <button
                  type="button"
                  className="page-ai-cancel-btn page-ai-cancel-inline"
                  onClick={() => {
                    if (confirm(t("reader_cancel_confirm"))) {
                      cancelledRef.current = true;
                    }
                  }}
                >
                  ⏹ {t("reader_cancel_btn")}
                </button>
              </>
            )}
            {translatingPage && !pageTranslation ? (
              <div className="page-ai-waiting">
                <div className="page-ai-spinner" />
                <strong>{t("reader_translating_page")}</strong>
                <span>{t("reader_translating_page_sub")}</span>
                {/* LLM em uso + progresso estimado (Miguel, 25/08). */}
                {textEntry && (
                  <span className="page-ai-model">
                    🤖 {textEntry.providerName || textEntry.providerId}
                    {textEntry.model ? ` · ${textEntry.model}` : ""}
                  </span>
                )}
                <div
                  className="page-ai-progress"
                  role="progressbar"
                  aria-valuenow={pageProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="page-ai-progress-fill" style={{ width: `${Math.round(pageProgress)}%` }} />
                  <span className="page-ai-progress-label">{Math.round(pageProgress)}%</span>
                </div>
                {/* ⏹ CANCELAR (Miguel, 26/08): cor chamativa, para a despesa
                    NA HORA. Com confirmação simpática — liberdade do usuário,
                    sem perder o que já foi feito (a parte pronta vira nota). */}
                <button
                  type="button"
                  className="page-ai-cancel-btn"
                  onClick={() => {
                    if (confirm(t("reader_cancel_confirm"))) {
                      cancelledRef.current = true;
                    }
                  }}
                >
                  ⏹ {t("reader_cancel_btn")}
                </button>
                {/* Aviso de paciência + link pro Mural das IAs (pedido Miguel, 13/08).
                    Traduzido nos 12 idiomas via i18n (pedido Miguel, 22/08:
                    "se tiver em inglês, vai aparecer em inglês?") — antes só
                    pt/en/es/fr tinham texto próprio; o resto caía em português. */}
                <a className="page-ai-tip" href="/mural-das-ias" target="_blank" rel="noreferrer">
                  {t("reader_patience_pre")}{" "}
                  <b>{t("reader_patience_wall")}</b>{" "}
                  {t("reader_patience_post")}
                </a>
              </div>
            ) : pageTranslation?.startsWith("⚠️") ? (
              <div className="page-ai-error">
                {/* Recado humanizado (pedido Miguel, 13/08) */}
                <div className="diag-sorry">
                  😔 Desculpe o transtorno — ocorreu um erro. Agradecemos se
                  enviar o diagnóstico pro nosso especialista analisar e
                  resolver o quanto antes.
                </div>
                <div className="diag-err-text">{pageTranslation}</div>

                {/* Atalho PRINCIPAL (Miguel, 24/08 — ampliado 25/08): TODO
                    erro de IA oferece as CONFIGURAÇÕES primeiro — é lá que
                    se troca chave, modelo ou provedor (resolve chave, modelo
                    errado, crédito e rate na maioria dos casos). Ajuda e
                    causas específicas ficam embaixo, como detalhe. */}
                {onOpenSettings ? (
                  <button
                    type="button"
                    className="diag-copy-btn diag-settings-btn"
                    onClick={() => onOpenSettings()}
                  >
                    ⚙️ Abrir configurações e trocar de IA
                  </button>
                ) : (
                  <a className="diag-copy-btn diag-settings-btn" href="/configuracoes">
                    ⚙️ Abrir configurações e trocar de IA
                  </a>
                )}

                {/* Causas auto-corrigíveis (autocura): o usuário tenta resolver
                    sozinho ANTES de chamar o suporte. */}
                {getSuggestedCauses().length > 0 && (
                  <div className="diag-causes">
                    <strong>{t("diag_causes_title")}</strong>
                    <ul>
                      {getSuggestedCauses().map((c) => (
                        <li key={c.text}>
                          <a href={c.href} target="_blank" rel="noreferrer">{c.text}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Ações: ENVIAR (mailto, sem servidor) + COPIAR. */}
                <div className="diag-actions">
                  <button
                    type="button"
                    onClick={handleSendDiag}
                    disabled={diagSending || diagSent}
                    className="diag-copy-btn diag-send-btn"
                    title="Envia o diagnóstico pro suporte (info@mokareader.com) — você recebe uma confirmação por e-mail"
                  >
                    {diagSent
                      ? "✅ Enviado! Respondemos em até 24h"
                      : diagSending
                        ? "⏳ Enviando…"
                        : "📤 Enviar diagnóstico"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyDiag}
                    className="diag-copy-btn"
                    title="Copia o relatório pra você me mandar"
                  >
                    {diagCopied ? "✅ Copiado!" : "📋 Copiar"}
                  </button>
                </div>
              </div>
            ) : (
              (pageTranslation ?? "").split(/\n{2,}/).map((para, i) => (
                <p key={i}>{para}</p>
              ))
            )}
          </article>
        ) : (
          <article
            className="reader-text"
            style={{ fontSize: `calc(var(--text-lg) * ${fontScale})` }}
          >
            {renderedBlocks}
          </article>
        )}
      </div>

      {/* Barra de navegação rápida — slider horizontal pra pular páginas.
          Sempre mostra (mesmo com 1 página) pra não sumir em nenhum caso. */}
      {totalPages >= 1 && (
        <div className="reader-nav-bar">
          <button onClick={goPrev} disabled={globalPageIdx === 0} aria-label={t("reader_nav_prev")}>
            ‹
          </button>
          <input
            type="range"
            min={0}
            max={totalPages - 1}
            value={sliderDraft ?? globalPageIdx}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
            className="nav-slider"
            aria-label={t("reader_nav_label")}
          />
          <button
            onClick={goNext}
            disabled={globalPageIdx >= totalPages - 1}
            aria-label={t("reader_nav_next")}
          >
            ›
          </button>
          <span className="nav-counter-bottom">
            {(sliderDraft ?? globalPageIdx) + 1}/{totalPages}
          </span>
        </div>
      )}

      {menu && (
        <div
          className={`selection-menu ${menu.placement === "below" ? "placement-below" : "placement-above"}`}
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <button onClick={snapSelectionStartToParagraph} role="menuitem">
            {t("reader_sel_from_start")}
          </button>
          <button onClick={expandSelectionToParagraph} role="menuitem">
            {t("reader_sel_paragraph")}
          </button>
          <button onClick={() => fire("translate")} role="menuitem">
            {t("reader_sel_translate")}
          </button>
          <button onClick={() => fire("explain")} role="menuitem">
            {t("reader_sel_explain")}
          </button>
          <button onClick={() => fireSpeak(menu.text)} role="menuitem">
            🔊 {t("reader_sel_speak")}
          </button>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(menu.text).catch(() => {});
              setMenu(null);
              clearCustomHighlight();
            }}
            role="menuitem"
          >
            📋 {t("reader_sel_copy")}
          </button>
          <button
            className="selection-menu-close"
            onClick={() => { setMenu(null); clearCustomHighlight(); window.getSelection()?.removeAllRanges(); }}
            role="menuitem"
            aria-label={t("close")}
            title={t("close")}
          >
            ✕
          </button>
        </div>
      )}

      {/* DICA INICIAL — só 1x por livro, 3 passos */}
      {showTip && (
        <div className="tip-overlay" onClick={dismissTip}>
          <div className="tip-balloon" onClick={(e) => e.stopPropagation()}>
            {tipStep === 0 && (
              <>
                <span className="tip-emoji">👆</span>
                <p className="tip-text">{t("reader_tip_selection")}</p>
                <p className="tip-subtext">{t("reader_tip_selection_sub")}</p>
              </>
            )}
            {tipStep === 1 && (
              <>
                <span className="tip-emoji">🔊</span>
                <p className="tip-text">{t("reader_tip_audio")}</p>
                <p className="tip-subtext">{t("reader_tip_audio_sub")}</p>
              </>
            )}
            {tipStep === 2 && (
              <>
                <span className="tip-emoji">🌐</span>
                <p className="tip-text">{t("reader_tip_translate")}</p>
                <p className="tip-subtext">{t("reader_tip_translate_sub")}</p>
              </>
            )}
            <div className="tip-dots">
              <span className={tipStep === 0 ? "tip-dot active" : "tip-dot"} />
              <span className={tipStep === 1 ? "tip-dot active" : "tip-dot"} />
              <span className={tipStep === 2 ? "tip-dot active" : "tip-dot"} />
            </div>
            <div className="tip-buttons">
              <button className="tip-skip" onClick={dismissTip}>{t("reader_tip_skip")}</button>
              <button className="tip-btn" onClick={nextTip}>
                {tipStep < 2 ? t("reader_tip_next") : t("reader_tip_ok")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BALÃO CENTRAL de loading do áudio — chama atenção, some quando entra.
          Mostra a ETAPA (traduzindo pra falar / gerando voz), o cronômetro
          e um botão de cancelar. */}
      {ttsLoading && (
        <div className="tts-loading-overlay">
          <div className="tts-loading-balloon">
            <div className="tts-loading-anim">
              <span className="tts-dot" />
              <span className="tts-dot" />
              <span className="tts-dot" />
            </div>
            <p className="tts-loading-text">
              {ttsPrep === "translate" ? t("reader_tts_translating") : t("reader_preparing_audio")}
            </p>
            <span className="tts-loading-secs">{ttsPrepSecs}s</span>
            <button
              className="tts-loading-cancel"
              onClick={cancelTtsPrep}
              aria-label={t("cancel")}
              title={t("cancel")}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Painel flutuante de resultado em FULLSCREEN (tradução/explicação de trecho) */}
      {isFullscreen && (fsResult !== null || fsLoading) && (
        <div className="fs-result-panel">
          <div className="fs-result-header">
            <span>{fsAction === "translate" ? t("reader_fs_translation") : t("reader_fs_explanation")}</span>
            <button onClick={() => { setFsResult(null); setFsAction(null); }}>✕</button>
          </div>
          <div className="fs-result-body">
            {fsLoading && !fsResult && <p>{t("reader_processing")}</p>}
            {fsResult && <p>{fsResult}</p>}
          </div>
        </div>
      )}

      {/* Botão flutuante pra re-mostrar o menu quando oculto em fullscreen */}
      {isFullscreen && !menuVisible && (
        <button
          onClick={() => setMenuVisible(true)}
          className="fs-show-menu-btn"
          title={t("reader_show_menu")}
          aria-label={t("reader_show_menu")}
        >
          <CafezinhoLogo size={22} opacity={0.9} />
        </button>
      )}

      {/* Modal UNIFICADO: Anotações + Marcadores + Áudios (3 abas) */}
      {notesOpen && (
        <div className="notes-overlay" onClick={() => setNotesOpen(false)}>
          <div className="notes-modal" onClick={(e) => e.stopPropagation()}>
            <header className="notes-header">
              <h2>📓 {t("reader_notes_title")}</h2>
              <button onClick={() => setNotesOpen(false)} aria-label={t("close")}>✕</button>
            </header>
            {/* Abas */}
            <div className="notes-tabs">
              <button
                className={`notes-tab ${notesTab === "notes" ? "active" : ""}`}
                onClick={() => setNotesTab("notes")}
              >
                📝 {t("reader_notes_title").replace("📓 ", "")}
                {notes.length > 0 && <span className="tab-count">{notes.length}</span>}
              </button>
              <button
                className={`notes-tab ${notesTab === "bookmarks" ? "active" : ""}`}
                onClick={() => setNotesTab("bookmarks")}
              >
                🔖 {t("reader_bookmarks_title").replace("🔖 ", "")}
                {bookmarks.length > 0 && <span className="tab-count">{bookmarks.length}</span>}
              </button>
              <button
                className={`notes-tab ${notesTab === "audio" ? "active" : ""}`}
                onClick={() => setNotesTab("audio")}
              >
                🔊 Áudios
              </button>
            </div>
            {/* Conteúdo da aba */}
            <div className="notes-body">
              {notesTab === "notes" && (
                <>
                  {notes.length === 0 ? (
                    <p className="notes-empty">{t("reader_notes_empty")}</p>
                  ) : (
                    notes.map((n) => (
                      <div key={n.id} className="note-card">
                        <div className="note-meta">
                          <span className={`note-kind note-${n.kind}`}>
                            {n.kind === "translate" ? t("reader_note_translate") : n.kind === "explain" ? t("reader_note_explain") : n.kind === "summary" ? t("reader_note_summary") : t("reader_note_question")}
                          </span>
                          <time>{new Date(n.savedAt).toLocaleString(lang)}</time>
                          <button
                            className="note-delete"
                            onClick={() => {
                              const m = CONFIRM_MSGS[lang] ?? CONFIRM_MSGS["en"] ?? CONFIRM_MSGS["pt-BR"];
                              if (window.confirm(m.deleteNote)) onRemoveNote?.(n.id);
                            }}
                            aria-label={t("remove")}
                          >
                            🗑
                          </button>
                        </div>
                        {n.source && (
                          <blockquote className="note-source">{n.source}</blockquote>
                        )}
                        <div className="note-result">{n.result}</div>
                      </div>
                    ))
                  )}
                </>
              )}
              {notesTab === "bookmarks" && (
                <>
                  {bookmarks.length === 0 ? (
                    <p className="notes-empty">{t("reader_bookmarks_empty")}</p>
                  ) : (
                    [...bookmarks]
                      .sort((a, b) => b.savedAt - a.savedAt)
                      .map((bm) => {
                        const ch = book.chapters[bm.chapterIdx];
                        const label =
                          bm.pageLabel ||
                          (book.sourceFormat === "pdf"
                            ? t("reader_page_n", { n: bm.chapterIdx + 1 })
                            : ch?.title || t("reader_chapter_n", { n: bm.chapterIdx + 1 }));
                        return (
                          <div key={`${bm.chapterIdx}-${bm.savedAt}`} className="bookmark-item">
                            {/* Área que NAVEGA pra página marcada */}
                            <button
                              type="button"
                              className="bookmark-goto"
                              onClick={() => {
                                // Navega pra página marcada (pedido Miguel, 13/08).
                                // Seta a página LOCAL pendente ANTES de trocar de
                                // capítulo (o useEffect [chapterIdx] aplica
                                // pendingPage). Assim volta na página exata, não no
                                // começo do capítulo.
                                pendingPage.current = bm.pageIdx ?? 0;
                                if (bm.chapterIdx === chapterIdx) {
                                  // Mesmo capítulo: aplica direto a página local.
                                  setPageIdx(bm.pageIdx ?? 0);
                                }
                                setChapterIdx(bm.chapterIdx);
                                setNotesOpen(false);
                                setTimeout(() => scrollRef.current?.scrollTo({ top: 0 }), 60);
                              }}
                            >
                              <span className="bookmark-label">🔖 {label}</span>
                              {bm.preview && (
                                <span className="bookmark-preview">{bm.preview}…</span>
                              )}
                              <span className="bookmark-date">
                                {new Date(bm.savedAt).toLocaleDateString(lang, {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </button>
                            {/* Lixeira pra apagar o marcador (com confirmação) */}
                            <button
                              type="button"
                              className="bookmark-delete"
                              aria-label={(CONFIRM_MSGS[lang] ?? CONFIRM_MSGS["en"]).deleteBookmark}
                              onClick={() => {
                                const m = CONFIRM_MSGS[lang] ?? CONFIRM_MSGS["en"] ?? CONFIRM_MSGS["pt-BR"];
                                if (window.confirm(m.deleteBookmark)) onToggleBookmark?.(bm.chapterIdx);
                              }}
                            >
                              🗑
                            </button>
                          </div>
                        );
                      })
                  )}
                </>
              )}
              {notesTab === "audio" && (
                <p className="notes-empty">
                  🔊 Áudios gerados aparecerão aqui. (Em breve)
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CSS migrado para globals.css — cura FOUC (era <style jsx>) */}

      {/* Settings renderizado DENTRO da <section.reader> — assim aparece
          tanto no modo normal quanto no fullscreen (que só mostra o
          elemento que pediu fullscreen e seus filhos). */}
      {settingsOpen && (
        <SettingsModal
          onClose={() => onCloseSettings?.()}
          onSaved={() => onSettingsSaved?.()}
        />
      )}

      {/* Janela "Pergunte qualquer coisa" (ícone microfone+caneta) —
          pergunta por voz ou escrita, resposta com streaming na janela. */}
      {askOpen && (
        <AskModal
          book={book}
          chapterId={chapter?.id}
          onClose={() => setAskOpen(false)}
          onSaveNote={onSaveNote}
        />
      )}

      {/* Janela "Traduzir livro inteiro" (🌍) — volumes de ~50 páginas,
          EPUB baixado + estante, com retomada e integrador de volumes. */}
      {transBookOpen && (
        <TranslateBookModal
          book={book}
          userId={auth?.user?.id ?? null}
          onClose={() => setTransBookOpen(false)}
        />
      )}

      {/* Janela ANOTAR (📝) — Resumir ou Explicar a página inteira com
          barra de tamanho; resumo também cobre o livro inteiro. */}
      {summaryOpen && (
        <PageActionModal
          book={book}
          pageText={currentPageText || blocksToText(currentBlocks, "\n\n")}
          pageLabel={pageLabel}
          totalPages={totalPages}
          buildBookCompilation={buildBookCompilation}
          onClose={() => setSummaryOpen(false)}
          onSaveNote={onSaveNote}
        />
      )}

      {/* Input de arquivo escondido — aberto pelo botão ➕ "Abrir novo".
          Vai pra home que abre o seletor de arquivo automaticamente. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,.pdf"
        hidden
        onChange={(e) => {
          // Se selecionou algo, vai pra home processar.
          if (e.target.files?.[0]) {
            sessionStorage.setItem("moka.openUploader", "1");
            onCloseBook?.();
          }
        }}
      />

      {/* Modal de primeira vez: voz neural (OpenAI) vs mecânica (gratuita).
          Pedido do Miguel: em vez de um alert() que só diz "configure", um
          modal com 2 botões de ação + "não mostrar de novo". Depois, a
          preferência fica acessível em /configuracoes. */}
      {showTtsModal && (
        <div
          className="tts-modal-overlay"
          onClick={() => setShowTtsModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="tts-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="tts-modal-title">🔊 {t("tts_modal_title")}</h3>
            <p className="tts-modal-body">{t("tts_modal_body")}</p>
            <div className="tts-modal-actions">
              {onOpenSettings && (
                <button
                  className="tts-modal-btn tts-modal-primary"
                  onClick={() => {
                    setShowTtsModal(false);
                    onOpenSettings(); // → /configuracoes
                  }}
                >
                  ⚙️ {t("tts_modal_configure")}
                </button>
              )}
              <button
                className="tts-modal-btn tts-modal-secondary"
                onClick={() => setShowTtsModal(false)}
              >
                {t("tts_modal_mechanical")}
              </button>
            </div>
            <button
              className="tts-modal-dontshow"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.localStorage.setItem("moka.ttsWarned", "1");
                }
                setShowTtsModal(false);
              }}
            >
              {t("tts_modal_dont_show")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * PDF: a camada de texto do pdf.js não tem <p>/<h1> — só <span> posicionados.
 * Detecta os limites do(s) parágrafo(s) VISUAL(is) que a seleção toca usando
 * a GEOMETRIA das linhas: indento de primeira linha, espaço vertical extra,
 * mudança de tamanho de fonte e linha anterior terminando bem antes da
 * margem direita. Retorna o primeiro span do parágrafo inicial e o último
 * span do parágrafo final (ou null se não der pra determinar).
 */
function pdfParagraphSpanRange(
  range: Range,
): { first: Element; last: Element } | null {
  const asEl = (n: Node): Element | null =>
    n.nodeType === 1 ? (n as Element) : n.parentElement;
  const startEl = asEl(range.startContainer);
  const endEl = asEl(range.endContainer);
  const layer = startEl?.closest(".pdf-text-layer");
  if (!layer || !endEl || endEl.closest(".pdf-text-layer") !== layer) return null;

  const spanOf = (el: Element | null): Element | null => {
    if (!el) return null;
    const s = el.closest(".pdf-text-layer span");
    return s && layer.contains(s) ? s : null;
  };
  const startSpan = spanOf(startEl);
  const endSpan = spanOf(endEl);
  if (!startSpan || !endSpan) return null;

  // Agrupa os spans em LINHAS pelo top do retângulo (tolerância ~meia letra).
  type Line = { top: number; bottom: number; x0: number; x1: number; h: number; spans: Element[] };
  const lines: Line[] = [];
  const lineOfSpan = new Map<Element, number>();
  for (const s of Array.from(layer.querySelectorAll("span"))) {
    if (!(s.textContent ?? "").trim()) continue;
    const r = s.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    const prev = lines[lines.length - 1];
    if (prev && Math.abs(r.top - prev.top) < Math.max(3, prev.h * 0.5)) {
      // Mesmo andar: estende a linha.
      prev.x0 = Math.min(prev.x0, r.left);
      prev.x1 = Math.max(prev.x1, r.right);
      prev.bottom = Math.max(prev.bottom, r.bottom);
      prev.h = Math.max(prev.h, r.height);
      prev.spans.push(s);
    } else {
      lines.push({ top: r.top, bottom: r.bottom, x0: r.left, x1: r.right, h: r.height, spans: [s] });
    }
    lineOfSpan.set(s, lines.length - 1);
  }
  const li = lineOfSpan.get(startSpan);
  const lj = lineOfSpan.get(endSpan);
  if (li === undefined || lj === undefined) return null;

  const rightEdge = lines.reduce((m, l) => Math.max(m, l.x1), 0);
  /** A linha i começa um parágrafo NOVO (em relação à linha anterior)? */
  const isParaStart = (i: number): boolean => {
    if (i <= 0) return true;
    const prev = lines[i - 1];
    const cur = lines[i];
    // 1. Mudança de tamanho de fonte (título, nota).
    if (Math.abs(cur.h - prev.h) > ((prev.h + cur.h) / 2) * 0.2) return true;
    // 2. Espaço vertical extra entre as linhas.
    if (cur.top - prev.bottom > prev.h * 0.5) return true;
    // 3. Indento de primeira linha.
    if (cur.x0 - prev.x0 > Math.max(4, cur.h * 0.6)) return true;
    // 4. Linha anterior terminou bem antes da margem direita (fim de parágrafo).
    if (rightEdge - prev.x1 > prev.h * 1.2) return true;
    return false;
  };

  // Sobe até o começo do parágrafo inicial; desce até o fim do final.
  let a = Math.min(li, lj);
  let b = Math.max(li, lj);
  while (a > 0 && !isParaStart(a)) a--;
  while (b < lines.length - 1 && !isParaStart(b + 1)) b++;

  const firstSpans = lines[a].spans;
  const lastSpans = lines[b].spans;
  return { first: firstSpans[0], last: lastSpans[lastSpans.length - 1] };
}

/** Escapa HTML pra injetar com segurança no iframe de print. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Renderiza um bloco conforme seu tipo. */
function BlockView({ block }: { block: import("@igot/parser").Block }) {
  switch (block.type) {
    case "heading":
      switch (block.level) {
        case 1:
          return <h1>{block.text}</h1>;
        case 2:
          return <h2>{block.text}</h2>;
        case 3:
          return <h3>{block.text}</h3>;
        default:
          return <h4>{block.text}</h4>;
      }
    case "quote":
      return <blockquote>{block.text}</blockquote>;
    case "list":
      return (
        <ul>
          {block.items?.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      );
    case "image":
      return block.src ? <img src={block.src} alt={block.alt ?? ""} /> : null;
    case "page-break":
      return <hr />;
    default:
      return <p>{block.text}</p>;
  }
}
