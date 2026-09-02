"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CafezinhoLogo } from "@/components/CafezinhoLogo";
import { SettingsModal } from "@/components/SettingsModal";
import { VideoAskModal } from "@/components/VideoAskModal";
import { TopNav, TopNavActions } from "@/components/TopNav";
import { LangSwitcher } from "@/components/LangSwitcher";
import { useAuth } from "@/lib/auth";
import { Markdown } from "@/components/Markdown";
import { hasConfig, loadConfigCache } from "@/lib/config";
import {
  getVideo,
  saveVideo,
  formatTime,
  transcriptText,
  type VideoRecord,
  type AnalysisKind,
} from "@/lib/video/db";
import {
  quickExplain,
  summarize,
  characters,
  politicalContext,
  critique,
  correctTranscript,
  setVideoContentLang,
} from "@/lib/video/ai-client";
import { detectContentLang, LANG_NOMES } from "@/lib/lang-detect";
import { getTargetLang } from "@/lib/config";
import { useI18n } from "@/components/I18nProvider";
import type { UIStringKey } from "@/lib/ui-strings";

/** Pseudo-tipo: "summary" abre o seletor de minutos; o kind real é summary-N. */
type ToolKind = AnalysisKind | "transcript" | "summary" | "ask";

/** Ferramentas de análise — os ícones da barra, no espírito do Moka Reader. */
const TOOLS: Array<{
  kind: ToolKind;
  icon: string;
  label: string;
  title: string;
}> = [
  { kind: "quick", icon: "⚡", label: "Explicação", title: "Explicação rápida — o que foi o vídeo, em poucas linhas" },
  { kind: "summary", icon: "📖", label: "Resumo", title: "Resumo regulável — de 1 a 10 minutos de leitura" },
  { kind: "characters", icon: "👥", label: "Personagens", title: "Personagens — quem fala e quem aparece" },
  { kind: "politics", icon: "🏛️", label: "Contexto", title: "Contexto — datas e conjuntura do tema discutido" },
  { kind: "critique", icon: "🖊️", label: "Crítica", title: "Crítica — teses, argumentos, vieses e veredito" },
  { kind: "transcript", icon: "📜", label: "Transcrição", title: "Transcrição completa" },
  { kind: "ask", icon: "❓", label: "Perguntar", title: "Pergunte qualquer coisa sobre o vídeo — a IA pesquisa na transcrição" },
];

/** Rótulos das ferramentas via i18n (bandeirinha traduz — pedido do Miguel). */
const TOOL_LABEL_KEYS: Record<ToolKind, UIStringKey> = {
  quick: "video_tool_quick",
  summary: "video_tool_summary",
  characters: "video_tool_characters",
  politics: "video_tool_politics",
  critique: "video_tool_critique",
  ask: "video_tool_ask",
  transcript: "video_tool_transcript",
};

type PanelState =
  | { kind: AnalysisKind | "transcript"; text: string; streaming: boolean }
  | null;

/**
 * Página do vídeo = a "sala de leitura" do Moka Video.
 *
 * Layout: ficha do vídeo no topo (thumb, título, canal), barra de ícones
 * de análise (mesmo padrão da toolbar do Moka Reader) e o painel de
 * leitura em Literata. Ao abrir um vídeo novo, a ⚡ explicação rápida
 * já começa sozinha — é o "em um minuto você entende" do Miguel.
 */
export default function VideoPage() {
  const { t } = useI18n();
  const params = useParams();
  const router = useRouter();
  const auth = useAuth();
  const id = String(params?.id ?? "");

  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<PanelState>(null);
  // Modo de visualização da transcrição: "timecode" (com timestamps) ou
  // "edited" (texto limpo formatado pela IA). Pedido do Miguel 10/08.
  const [transcriptView, setTranscriptView] = useState<"timecode" | "edited" | "ai">("edited");
  // Texto corrigido pela IA (preenchido sob demanda quando clicar em "editada").
  const [transcriptEdited, setTranscriptEdited] = useState<string | null>(null);
  const [transcriptEditing, setTranscriptEditing] = useState(false);
  const [minutes, setMinutes] = useState(3);
  const [summaryPickerOpen, setSummaryPickerOpen] = useState(false);
  // Progresso + LLM + cancelar (Miguel, 27/08 — modernização igual ao Reader)
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisLLM, setAnalysisLLM] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRan = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Boot: carrega o vídeo da videoteca.
  useEffect(() => {
    let cancelled = false;
    loadConfigCache().then(() => {
      if (!cancelled) setConfigReady(hasConfig());
    });
    getVideo(id)
      .then((rec) => {
        if (cancelled) return;
        // V2.4: auto-detecta o idioma da transcrição (pedido do Miguel).
        // O selo 🌐 no cabeçalho avisa se o conteúdo é de outro idioma.
        if (rec && rec.segments?.length) {
          if (!rec.detectedLang) {
            const amostra = transcriptText(rec.segments).slice(0, 8000);
            const det = detectContentLang(amostra);
            rec = { ...rec, detectedLang: det.code };
            void saveVideo(rec);
          }
          setVideoContentLang(rec.detectedLang ?? "pt");
        }
        setVideo(rec);
        setLoading(false);
        // Reabre a última análise cacheada, se houver.
        if (rec) {
          const cached = Object.entries(rec.analyses).find(([, v]) => v);
          if (cached && cached[1]) {
            setPanel({
              kind: cached[0] as AnalysisKind,
              text: cached[1],
              streaming: false,
            });
          }
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  /** Persiste uma análise no registro (cache anti-token). */
  const cacheAnalysis = useCallback(
    async (kind: AnalysisKind, text: string) => {
      setVideo((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          analyses: { ...prev.analyses, [kind]: text },
        };
        void saveVideo(next);
        return next;
      });
    },
    [],
  );

  /** Roda uma análise com streaming no painel. */
  const runAnalysis = useCallback(
    async (kind: AnalysisKind, force = false) => {
      if (!video) return;
      // Cache: não gasta token de novo sem necessidade.
      const cached = video.analyses[kind];
      if (cached && !force) {
        setPanel({ kind, text: cached, streaming: false });
        return;
      }
      if (!hasConfig()) {
        setSettingsOpen(true);
        return;
      }

      setError(null);
      setPanel({ kind, text: "", streaming: true });
      setAnalysisProgress(0);
      cancelledRef.current = false;
      // LLM em uso (recado — Miguel, 27/08)
      void import("@/lib/config").then((mod) => {
        const e = mod.getEntryForText();
        if (e) setAnalysisLLM(`${(e as { providerName?: string }).providerName || e.providerId}${e.model ? ` · ${e.model}` : ""}`);
      }).catch(() => {});
      // Barra da espera por tempo (até 35%, igual Reader)
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      progressTimerRef.current = setInterval(() => {
        setAnalysisProgress((prev) => (prev >= 35 ? prev : prev + Math.max(0.4, (35 - prev) * 0.06)));
      }, 1200);
      // Estimativa baseada no tamanho da transcrição
      const estLen = Math.max(500, (video.segments?.length ?? 10) * 150);
      const onChunk = (text: string) => {
        setPanel((p) => (p && p.kind === kind ? { ...p, text } : p));
        if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
        setAnalysisProgress((prev) =>
          Math.max(prev, Math.min(95, Math.round((text.length / estLen) * 100))),
        );
      };

      try {
        let final = "";
        if (kind === "quick") final = await quickExplain(video.meta, video.segments, onChunk, { shouldCancel: () => cancelledRef.current });
        else if (kind === "characters") final = await characters(video.meta, video.segments, onChunk, { shouldCancel: () => cancelledRef.current });
        else if (kind === "politics") final = await politicalContext(video.meta, video.segments, onChunk, { shouldCancel: () => cancelledRef.current });
        else if (kind === "critique") final = await critique(video.meta, video.segments, onChunk, { shouldCancel: () => cancelledRef.current });
        else if (kind.startsWith("summary-")) {
          const m = Number(kind.split("-")[1]) || minutes;
          final = await summarize(video.meta, video.segments, m, onChunk, { shouldCancel: () => cancelledRef.current });
        }
        setAnalysisProgress(100);
        setPanel({ kind, text: final, streaming: false });
        await cacheAnalysis(kind, final);
      } catch (err) {
        setPanel(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
      }
    },
    [video, minutes, cacheAnalysis],
  );

  // ⚡ Auto-explicação: vídeo recém-lido, sem análises → começa sozinho.
  useEffect(() => {
    if (autoRan.current || !video || !configReady) return;
    if (Object.keys(video.analyses).length > 0) return;
    autoRan.current = true;
    void runAnalysis("quick");
  }, [video, configReady, runAnalysis]);

  /** Envia/compartilha a análise atual ("manda pra você"). */
  const handleShare = useCallback(async () => {
    if (!video || !panel || panel.kind === "transcript") return;
    const tool = TOOLS.find((t) => t.kind === panel.kind || panel.kind.startsWith("summary"));
    const text = `${tool?.label ?? "Análise"} — ${video.meta.title}\n\n${panel.text}\n\n— Moka Video ☕`;
    if (navigator.share) {
      try {
        await navigator.share({ title: video.meta.title, text });
        return;
      } catch {
        /* cancelado */
      }
    }
    await navigator.clipboard.writeText(text).catch(() => {});
    alert("Análise copiada — cole onde quiser (WhatsApp, e-mail…).");
  }, [video, panel]);

  const handleTool = useCallback(
    (kind: ToolKind) => {
      if (kind === "transcript") {
        setPanel({ kind: "transcript", text: "", streaming: false });
        // Default é "edited" (texto limpo em parágrafos) — instantâneo, sem IA.
        setTranscriptView("edited");
        setTranscriptEdited(null);
        setTranscriptEditing(false);
        return;
      }
      if (kind === "summary") {
        setSummaryPickerOpen((v) => !v);
        return;
      }
      if (kind === "ask") {
        setAskOpen(true);
        return;
      }
      setSummaryPickerOpen(false);
      void runAnalysis(kind);
    },
    [runAnalysis],
  );

  if (loading) {
    return (
      <main className="igot-shell">
        <div className="igot-loading">
          <div className="spinner" />
          <p>Abrindo a videoteca…</p>
        </div>
      </main>
    );
  }

  if (!video) {
    return (
      <main className="igot-shell">
        <div className="igot-loading">
          <p>😕 Vídeo não encontrado na videoteca.</p>
          <button className="btn-home" onClick={() => router.push("/video")}>
            ← Voltar pra videoteca
          </button>
        </div>
</main>
    );
  }

  const activeKind = panel?.kind;
  const words = Math.round(
    video.segments.reduce((acc, s) => acc + s.text.split(/\s+/).length, 0),
  );

  return (
    <main className="igot-shell">
      <TopNav active="video" right={<>
          <a
            className="gear"
            href="/video"
            title={t("video_add_new")}
            aria-label={t("video_add_new")}
          >
            ＋
          </a>
          <button
            className="gear"
            onClick={handleShare}
            disabled={!panel || panel.kind === "transcript" || panel.streaming}
            title="Enviar/compartilhar a análise"
            aria-label="Enviar análise"
          >
            📤
          </button>
          <TopNavActions back={false} />
        </>} />

      <div className="video-page">
        {/* Ficha do vídeo */}
        <header className="video-header">
          {video.meta.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="video-header-thumb" src={video.meta.thumbnail} alt="" />
          )}
          <div className="video-header-info">
            <h1>{video.meta.title}</h1>
            <p className="video-header-meta">
              {video.meta.channel} · {formatTime(video.meta.durationSec)} ·{" "}
              {video.transcriptSource === "captions" ? t("video_captions") : t("video_whisper")} ·{" "}
              ~{words.toLocaleString("pt-BR")} palavras
              {video.detectedLang && (
                <span title="Idioma detectado automaticamente">
                  {" · 🌐 "}
                  {LANG_NOMES[video.detectedLang] ?? video.detectedLang}
                  {video.detectedLang !== getTargetLang().split("-")[0] &&
                    ` · respostas em ${
                      LANG_NOMES[getTargetLang().split("-")[0]] ?? "português"
                    }`}
                </span>
              )}
            </p>
            <a
              className="video-header-link"
              href={video.meta.webpageUrl}
              target="_blank"
              rel="noreferrer"
            >
              🔗 {t("video_watch_original")}
            </a>
          </div>
        </header>

        {/* Barra de ferramentas — ícones, como no Moka Reader */}
        <nav className="tool-bar" aria-label="Análises">
          {TOOLS.map((tool) => (
            <button
              key={String(tool.kind)}
              className={`tool-btn ${
                activeKind === tool.kind ||
                (tool.kind === "summary" && String(activeKind ?? "").startsWith("summary")) ||
                (tool.kind === "summary" && summaryPickerOpen)
                  ? "active"
                  : ""
              }`}
              onClick={() => handleTool(tool.kind)}
              title={tool.title}
              aria-label={tool.title}
            >
              <span className="tool-icon">{tool.icon}</span>
              <span className="tool-label">{t(TOOL_LABEL_KEYS[tool.kind])}</span>
            </button>
          ))}
        </nav>

        {/* Seletor de tamanho do resumo: 1–10 min */}
        {summaryPickerOpen && (
          <div className="summary-picker">
            <div className="summary-picker-row">
              <span className="summary-picker-label">Tamanho do resumo:</span>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="nav-slider"
                aria-label="Minutos de leitura"
              />
              <span className="summary-picker-value">
                {minutes} min
              </span>
            </div>
            <p className="summary-picker-hint">
              {minutes <= 2
                ? "☕ expresso — só a essência"
                : minutes <= 5
                  ? "☕ médio — os pontos principais"
                  : "☕ passado — completo, por seções"}
              {" · "}≈{(minutes * 150).toLocaleString("pt-BR")} palavras
              {words > 12000 && " · vídeo longo = mais tokens da sua IA"}
            </p>
            <button
              className="summary-go"
              onClick={() => {
                setSummaryPickerOpen(false);
                void runAnalysis(`summary-${minutes}` as AnalysisKind);
              }}
            >
              📖 Resumir em {minutes} min
            </button>
          </div>
        )}

        {error && <p className="panel-error">⚠️ {error}</p>}

        {/* Painel de leitura */}
        <section className="panel" ref={panelRef}>
          {!panel && !error && (
            <div className="panel-empty">
              <CafezinhoLogo size={40} opacity={0.35} />
              <p>
                Escolha uma análise na barra acima — ou espere a ⚡ explicação
                rápida, que já vem chegando.
              </p>
            </div>
          )}

          {panel?.kind === "transcript" && (
            <div className="transcript">
              {/* 2 sub-botões: timecode vs editada (pedido do Miguel 10/08). */}
              <div className="transcript-view-toggle">
                <button
                  className={`transcript-view-btn ${transcriptView === "timecode" ? "active" : ""}`}
                  onClick={() => setTranscriptView("timecode")}
                >
                  🕐 Com timecode
                </button>
                <button
                  className={`transcript-view-btn ${transcriptView === "edited" ? "active" : ""}`}
                  onClick={() => setTranscriptView("edited")}
                >
                  📄 Texto limpo
                </button>
                <button
                  className={`transcript-view-btn ${transcriptView === "ai" ? "active" : ""}`}
                  onClick={() => {
                    setTranscriptView("ai");
                    if (!transcriptEdited && !transcriptEditing && video?.segments?.length) {
                      setTranscriptEditing(true);
                      // Modernização 27/08: barra %, LLM em uso e ⏹ cancelar —
                      // igual às análises (o caminho antigo travava mudo).
                      setError(null);
                      setAnalysisProgress(0);
                      cancelledRef.current = false;
                      void import("@/lib/config").then((mod) => {
                        const e = mod.getEntryForText();
                        if (e) setAnalysisLLM(`${(e as { providerName?: string }).providerName || e.providerId}${e.model ? ` · ${e.model}` : ""}`);
                      }).catch(() => {});
                      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
                      progressTimerRef.current = setInterval(() => {
                        setAnalysisProgress((prev) => (prev >= 35 ? prev : prev + Math.max(0.4, (35 - prev) * 0.06)));
                      }, 1200);
                      // A correção devolve ~o tamanho da transcrição original.
                      const estLen = Math.max(500, video.segments.reduce((n, s) => n + s.text.length, 0));
                      correctTranscript(
                        video.meta,
                        video.segments,
                        (text) => {
                          setTranscriptEdited(text);
                          if (progressTimerRef.current) {
                            clearInterval(progressTimerRef.current);
                            progressTimerRef.current = null;
                          }
                          setAnalysisProgress((prev) =>
                            Math.max(prev, Math.min(95, Math.round((text.length / estLen) * 100))),
                          );
                        },
                        { shouldCancel: () => cancelledRef.current },
                      ).then((final) => {
                        setTranscriptEditing(false);
                        if (final.trim()) {
                          setTranscriptEdited(final);
                          setAnalysisProgress(100);
                        }
                      }).catch((err) => {
                        setTranscriptEditing(false);
                        setAnalysisProgress(0);
                        setError(err instanceof Error ? err.message : String(err));
                      }).finally(() => {
                        if (progressTimerRef.current) {
                          clearInterval(progressTimerRef.current);
                          progressTimerRef.current = null;
                        }
                      });
                    }
                  }}
                >
                  {transcriptEditing ? "⏳ Corrigindo…" : "🤖 Corrigida com IA"}
                </button>
              </div>
              {transcriptView === "timecode" ? (
                video.segments.map((s, i) => (
                  <p key={i} className="transcript-line">
                    <span className="transcript-time">{formatTime(s.start)}</span>
                    <span>{s.text}</span>
                  </p>
                ))
              ) : transcriptView === "edited" ? (
                <div className="transcript-edited">
                  {(() => {
                    const fullText = video.segments.map((s) => s.text).join(" ");
                    const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
                    const paragraphs: string[] = [];
                    for (let i = 0; i < sentences.length; i += 2) {
                      paragraphs.push(sentences.slice(i, i + 2).join(" ").trim());
                    }
                    return paragraphs.map((p, i) => <p key={i}>{p}</p>);
                  })()}
                </div>
              ) : (
                /* Modo "ai" (corrigida com IA) — barra %, LLM e ⏹ cancelar (27/08) */
                <div className="transcript-edited">
                  {transcriptEdited ? (
                    <>
                      <Markdown text={transcriptEdited} />
                      {transcriptEditing && <span className="cursor">▌</span>}
                    </>
                  ) : transcriptEditing ? (
                    <div className="panel-thinking">
                      <div className="spinner" />
                      <p>🤖 A IA está corrigindo nomes e formatando a transcrição…</p>
                    </div>
                  ) : (
                    <p style={{ opacity: 0.75 }}>
                      ⚠️ A correção foi cancelada antes de gerar texto — clique de
                      novo em “🤖 Corrigida com IA” para tentar outra vez.
                    </p>
                  )}
                  {transcriptEditing && (
                    <div className="video-analysis-overlay-info">
                      {analysisLLM && <span className="page-ai-model">🤖 {analysisLLM}</span>}
                      <div className="page-ai-progress" role="progressbar" aria-valuenow={Math.round(analysisProgress)} aria-valuemin={0} aria-valuemax={100}>
                        <div className="page-ai-progress-fill" style={{ width: `${Math.round(analysisProgress)}%` }} />
                        <span className="page-ai-progress-label">{Math.round(analysisProgress)}%</span>
                      </div>
                      <button
                        type="button"
                        className="page-ai-cancel-btn"
                        onClick={() => {
                          if (confirm("Cancelar agora? Você NÃO gasta mais nada — a despesa para imediatamente.")) {
                            cancelledRef.current = true;
                          }
                        }}
                      >
                        ⏹ Cancelar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {panel && panel.kind !== "transcript" && (
            <article className="reader-text panel-article">
              {panel.text ? (
                <Markdown text={panel.text} />
              ) : (
                <div className="panel-thinking">
                  <div className="spinner" />
                  <p>O Moka está lendo a transcrição…</p>
                </div>
              )}
              {panel.streaming && panel.text && <span className="cursor">▌</span>}
              {panel.streaming && (
                <div className="video-analysis-overlay-info">
                  {analysisLLM && <span className="page-ai-model">🤖 {analysisLLM}</span>}
                  <div className="page-ai-progress" role="progressbar" aria-valuenow={Math.round(analysisProgress)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="page-ai-progress-fill" style={{ width: `${Math.round(analysisProgress)}%` }} />
                    <span className="page-ai-progress-label">{Math.round(analysisProgress)}%</span>
                  </div>
                  <button
                    type="button"
                    className="page-ai-cancel-btn"
                    onClick={() => {
                      if (confirm("Cancelar agora? Você NÃO gasta mais nada — a despesa para imediatamente.")) {
                        cancelledRef.current = true;
                      }
                    }}
                  >
                    ⏹ Cancelar
                  </button>
                </div>
              )}
            </article>
          )}

          {panel && !panel.streaming && panel.kind !== "transcript" && (
            <div className="panel-footer">
              <button
                className="panel-redo"
                onClick={() => {
                  const tool = TOOLS.find((t) => t.kind === panel.kind || panel.kind.startsWith("summary"));
                  const md = `# ${tool?.label ?? "Análise"} — ${video.meta.title}\n\n${panel.text}\n\n— Moka Video ☕ (${video.meta.webpageUrl})\n`;
                  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `moka-${String(panel.kind)}-${video.meta.title.replace(/[^\wÀ-ÿ]+/g, "-").slice(0, 40)}.md`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
                title="Baixar esta análise em arquivo (.md)"
              >
                📥 baixar
              </button>
              <button
                className="panel-redo"
                onClick={() => void runAnalysis(panel.kind as AnalysisKind, true)}
                title="Gerar de novo (gasta tokens de novo)"
              >
                ↻ gerar de novo
              </button>
            </div>
          )}
        </section>
      </div>

      {askOpen && (
        <VideoAskModal
          meta={video.meta}
          segments={video.segments}
          asks={video.asks ?? []}
          onSaveAsk={(ask) => {
            setVideo((prev) => {
              if (!prev) return prev;
              const next = { ...prev, asks: [...(prev.asks ?? []), ask] };
              void saveVideo(next);
              return next;
            });
          }}
          onClose={() => setAskOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setConfigReady(hasConfig());
            // Se fechou as configs depois de bloquear, tenta a explicação.
            if (!autoRan.current && video && Object.keys(video.analyses).length === 0) {
              autoRan.current = true;
              void runAnalysis("quick");
            }
          }}
        />
      )}
</main>
  );
}
