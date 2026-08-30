"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ParsedBook } from "@igot/parser";
import { useI18n } from "./I18nProvider";
import {
  planTranslation,
  loadTransJob,
  clearTransJob,
  runTranslationJob,
  mergeTranslatedVolumes,
  type JobProgress,
  type TranslationPlan,
} from "@/lib/book-translate";
import { getEntryForText } from "@/lib/config";
import { computeCostUsd, getCurrency, convertFromUsd, fmtMoney } from "@/lib/telemetry";

interface TranslateBookModalProps {
  book: ParsedBook;
  /** ID do usuário logado (pra sync na nuvem); null = só local. */
  userId?: string | null;
  onClose: () => void;
}

type Phase =
  | "confirm" // tela inicial: plano + aviso de tokens + começar/continuar
  | "running" // traduzindo (progresso por volume/página + cancelar)
  | "cancelled" // pausado pelo usuário (pode continuar depois)
  | "done" // todos os volumes prontos (oferece integrar)
  | "merging" // integrando volumes num livro único
  | "merged" // livro único pronto
  | "error"; // falhou (job salvo — dá pra continuar)

/**
 * Janela "Traduzir livro inteiro" (ícone 🌍).
 *
 * Fluxo:
 *   1. CONFIRMAR — mostra o plano (N páginas → V volumes de ~50) e o
 *      aviso de tokens. Se houver job salvo, oferece CONTINUAR de onde
 *      parou (volumes prontos não são refeitos) ou RECOMEÇAR.
 *   2. RODANDO — barra de progresso (volume x/y · página z), cronômetro
 *      e botão cancelar. Cada volume pronto vira EPUB (baixado) + livro
 *      na estante, automaticamente.
 *   3. PRONTO — lista os volumes e oferece o INTEGRADOR: junta tudo
 *      num livro único (EPUB baixado + estante).
 */
export function TranslateBookModal({ book, userId, onClose }: TranslateBookModalProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("confirm");

  const [plan] = useState<TranslationPlan>(() => planTranslation(book));
  const [savedJob] = useState(() => loadTransJob(book));
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const cancelledRef = useRef(false);
  const [pausedByHide, setPausedByHide] = useState(false);

  // 🧮 ESTIMATIVA prévia (Miguel, 25/08: "trava de segurança maior pra
  // traduzir o livro inteiro — antes, exigência de estimativa de custo em
  // tokens, reais e tempo"). ANTES de qualquer chamada: tokens pelo tamanho
  // do texto (≈ chars/4 ida + volta), custo pela tabela de preços da chave
  // ativa, tempo por volume (~75s médio, modelos com thinking demoram).
  const [est, setEst] = useState<{ tokens: number; usd: number; secs: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const chars = (book.chapters ?? []).reduce(
          (s, c) =>
            s +
            ((c as { blocks?: Array<{ text?: string }> }).blocks ?? []).reduce(
              (a, b) => a + (b?.text?.length ?? 0),
              0,
            ),
          0,
        );
        const tokensIn = Math.ceil(chars / 4);
        const tokens = tokensIn * 2; // entrada + tradução de saída
        const entry = getEntryForText();
        const usd = entry
          ? await computeCostUsd(entry.providerId, entry.model ?? "", tokensIn, tokensIn)
          : 0;
        if (alive) setEst({ tokens, usd, secs: plan.volumesTotal * 75 });
      } catch {
        /* estimativa é best-effort — nunca bloqueia */
      }
    })();
    return () => {
      alive = false;
    };
  }, [book, plan.volumesTotal]);

  // Portal: escapa de ancestral com containing block do Reader (mesma cura
  // do AuthModal/SettingsModal/AskModal — BUG "menu cortado/quebra livro").
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // PAUSA AUTOMÁTICA EM SEGUNDO PLANO (ordem do Miguel 24/08 — "o Moka não
  // pode gastar só porque está aberto"): aba oculta = tradução pausada no
  // fim da página em andamento (job salvo, Continuar retoma depois). Nada
  // de rodar às cenas gastando token com o usuário fora da aba.
  useEffect(() => {
    if (phase !== "running") return;
    const onVis = () => {
      if (document.hidden) {
        cancelledRef.current = true;
        setPausedByHide(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [phase]);

  // Fechar a janela durante a execução = PAUSAR (antes a tradução seguia
  // escondida mesmo com o modal fechado — raiz do gasto invisível de 24/08).
  // O job fica salvo; reabrir e Continuar retoma da página exata.
  useEffect(() => () => { cancelledRef.current = true; }, []);

  // Cronômetro (roda enquanto traduz/integra).
  useEffect(() => {
    if (phase !== "running" && phase !== "merging") {
      setSecs(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, [phase]);

  // Fecha com ESC (não fecha enquanto roda — pra não dar a impressão de
  // que cancelou; a tradução continua mesmo com a janela fechada? NÃO:
  // fechar a janela não cancela, mas o usuário pode pensar que sim.
  // Então durante "running" o ESC é ignorado — use o botão Cancelar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "running" && phase !== "merging") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const start = async (resume: boolean) => {
    cancelledRef.current = false;
    setPausedByHide(false);
    setError(null);
    setPhase("running");
    try {
      const result = await runTranslationJob({
        book,
        userId,
        resume,
        onProgress: setProgress,
        isCancelled: () => cancelledRef.current,
      });
      if (result.cancelled) {
        setPhase("cancelled");
      } else if (result.ok) {
        setPhase("done");
      }
    } catch (err) {
      // Erro no meio (rede, rate limit...): o job ficou salvo — dá pra
      // continuar exatamente da página onde parou.
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
  };

  const merge = async () => {
    setPhase("merging");
    try {
      const r = await mergeTranslatedVolumes({ book, userId, volumesTotal: plan.volumesTotal });
      if (r.ok) setPhase("merged");
      else {
        setError(r.error ?? "Erro.");
        setPhase("error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const restart = () => {
    clearTransJob(book);
    start(false);
  };

  const resumeVolume = savedJob
    ? savedJob.completedVolumes + (savedJob.partialPages.length > 0 ? 0 : 1)
    : 0;

  if (!mounted) return null;

  return createPortal(
    <div className="tb-overlay" onClick={phase === "running" || phase === "merging" ? undefined : onClose}>
      <div className="tb-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("tb_title")}>
        <header className="tb-header">
          <h2>🌍 {t("tb_title")}</h2>
          {phase !== "running" && phase !== "merging" && (
            <button onClick={onClose} aria-label={t("close")} title={t("close")}>
              ✕
            </button>
          )}
        </header>

        <div className="tb-body">
          {/* ── CONFIRMAR ── */}
          {phase === "confirm" && (
            <>
              <p className="tb-book">📖 {book.title}</p>
              <div className="tb-stats">
                <span>📄 {t("tb_pages", { n: plan.totalPages })}</span>
                <span>
                  📚 {t("tb_volumes", { n: plan.volumesTotal, size: plan.volumeSize })}
                </span>
                <span>🌐 {t("tb_lang", { lang: plan.targetLang })}</span>
              </div>
              <p className="tb-info">{t("tb_auto_download")}</p>
              <p className="tb-warning">⚠️ {t("tb_token_warning")}</p>
              {est && (
                <div className="tb-est-box">
                  <strong>🧮</strong> ≈ {est.tokens.toLocaleString()} tokens · ≈ US${" "}
                  {est.usd >= 0.01 ? est.usd.toFixed(2) : est.usd.toFixed(4)}
                  {(() => {
                    const cur = getCurrency();
                    return cur.code === "USD"
                      ? ""
                      : ` (≈ ${fmtMoney(convertFromUsd(est.usd, cur), cur)})`;
                  })()}{" "}
                  · ≈{" "}
                  {est.secs >= 3600
                    ? `${Math.floor(est.secs / 3600)}h ${Math.round((est.secs % 3600) / 60)}min`
                    : `${Math.max(1, Math.round(est.secs / 60))} min`}
                </div>
              )}

              {savedJob && savedJob.completedVolumes < plan.volumesTotal && (
                <div className="tb-resume-box">
                  <p>
                    ⏸ {t("tb_resume_hint", { n: savedJob.completedVolumes, total: plan.volumesTotal })}
                  </p>
                  <button className="tb-btn tb-btn-primary" onClick={() => start(true)}>
                    ▶ {t("tb_resume", { n: resumeVolume || savedJob.completedVolumes + 1 })}
                  </button>
                  <button className="tb-btn tb-btn-ghost" onClick={restart}>
                    ↺ {t("tb_restart")}
                  </button>
                </div>
              )}

              {(!savedJob || savedJob.completedVolumes >= plan.volumesTotal) && (
                <button className="tb-btn tb-btn-primary" onClick={() => start(false)}>
                  🌍 {t("tb_start")}
                </button>
              )}
            </>
          )}

          {/* ── RODANDO ── */}
          {phase === "running" && (
            <div className="tb-running">
              <div className="tb-anim">
                <span className="tb-dot" />
                <span className="tb-dot" />
                <span className="tb-dot" />
              </div>
              <p className="tb-progress-label">
                {progress
                  ? t("tb_running", {
                      v: progress.volume,
                      vt: progress.volumesTotal,
                      p: progress.pageInVolume,
                      pt: progress.pagesInVolume,
                    })
                  : t("tb_starting")}
              </p>
              {progress && (
                <div className="tb-bar" aria-hidden>
                  <div
                    className="tb-bar-fill"
                    style={{
                      width: `${Math.round((progress.donePages / progress.totalPages) * 100)}%`,
                    }}
                  />
                </div>
              )}
              <span className="tb-secs">{secs}s</span>
              <button className="tb-btn tb-btn-danger" onClick={cancel}>
                ✕ {t("cancel")}
              </button>
            </div>
          )}

          {/* ── CANCELADO ── */}
          {phase === "cancelled" && (
            <>
              <p className="tb-info">
                {pausedByHide ? `🌙 ${t("tb_paused_hidden")}` : `⏸ ${t("tb_cancelled")}`}
              </p>
              <button className="tb-btn tb-btn-primary" onClick={() => start(true)}>
                ▶ {t("tb_continue")}
              </button>
              <button className="tb-btn tb-btn-ghost" onClick={onClose}>
                {t("close")}
              </button>
            </>
          )}

          {/* ── PRONTO ── */}
          {phase === "done" && (
            <>
              <p className="tb-done">✅ {t("tb_done", { n: plan.volumesTotal })}</p>
              {plan.volumesTotal > 1 && (
                <button className="tb-btn tb-btn-primary" onClick={merge}>
                  📕 {t("tb_merge")}
                </button>
              )}
              <button className="tb-btn tb-btn-ghost" onClick={onClose}>
                {t("close")}
              </button>
            </>
          )}

          {/* ── INTEGRANDO ── */}
          {phase === "merging" && (
            <div className="tb-running">
              <div className="tb-anim">
                <span className="tb-dot" />
                <span className="tb-dot" />
                <span className="tb-dot" />
              </div>
              <p className="tb-progress-label">{t("tb_merging")}</p>
            </div>
          )}

          {/* ── INTEGRADO ── */}
          {phase === "merged" && (
            <>
              <p className="tb-done">📕 {t("tb_merged")}</p>
              <button className="tb-btn tb-btn-ghost" onClick={onClose}>
                {t("close")}
              </button>
            </>
          )}

          {/* ── ERRO ── */}
          {phase === "error" && (
            <>
              <p className="tb-error">⚠️ {t("tb_error", { msg: error ?? "" })}</p>
              <p className="tb-info">{t("tb_error_hint")}</p>
              <button className="tb-btn tb-btn-primary" onClick={() => start(true)}>
                ▶ {t("tb_continue")}
              </button>
              <button className="tb-btn tb-btn-ghost" onClick={onClose}>
                {t("close")}
              </button>
            </>
          )}
        </div>

        {/* CSS migrado para globals.css — cura FOUC (era <style jsx>) */}
      </div>
    </div>,
    document.body,
  );
}
