"use client";

/**
 * MOKA WRITER v1 (obra MOKA, etapa 3 — ordem do Miguel 30/08 ~15h).
 *
 * "O Moka Writer vai ser um ESTÚDIO: uma aba pra LER/visualizar e uma aba
 * de ESTÚDIO — na lógica do Filhos da Impunidade, porém mais simples, com
 * uma BOA MEMÓRIA DE ESTILO. Botões grandes: escrever um texto, corrigir
 * texto."
 *
 * - ✍️ ESCREVER: a IA (chave do próprio usuário, BYOK) escreve sobre o
 *   tema dado, NO ESTILO salvo na memória de estilo.
 * - 🩹 CORRIGIR: revisa o texto inteiro no estilo (tarefa grande = aviso
 *   de custo antes — regra do Miguel, DSC-018).
 * - 🧠 jogar na memória: o texto vira objeto pesquisável (etapa 1).
 * - Autosave local; aba LER com visualização confortável.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LangSwitcher } from "@/components/LangSwitcher";
import { TopNav, TopNavActions } from "@/components/TopNav";
import { LlmChip } from "@/components/LlmChip";
import { BackButton } from "@/components/BackButton";
import { SiteFooter } from "@/components/SiteFooter";
import { VisitPing } from "@/components/VisitPing";
import { useI18n } from "@/components/I18nProvider";
import { askFreeStream } from "@/lib/ai-client";
import { getConfigSync, getTargetLang, hasConfig, loadConfigCache } from "@/lib/config";
import { estimarTarefa } from "@/lib/memoria/orcamento";
import { getActiveMemoriaId, putMemoriaObject } from "@/lib/memoria/store";
import { OrcamentoModal, type OrcamentoInfo } from "@/components/OrcamentoModal";

const TEXT_KEY = "moka.writer.texto";
const STYLE_KEY = "moka.writer.estilo";
const TITLE_KEY = "moka.writer.titulo";

export default function WriterPage() {
  const router = useRouter();
  const { t } = useI18n();

  const [configReady, setConfigReady] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"estudio" | "ler">("estudio");
  const [titulo, setTitulo] = useState("");
  const [text, setText] = useState("");
  const [idea, setIdea] = useState("");
  const [estilo, setEstilo] = useState("");
  const [styleOpen, setStyleOpen] = useState(false);
  const [busy, setBusy] = useState<null | "write" | "fix">(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmFix, setConfirmFix] = useState<string | null>(null); // custo estimado
  const [orc, setOrc] = useState<OrcamentoInfo | null>(null); // orçamento internacional
  // snapshot p/ ↩️ desfazer a última ação da IA (write/fix)
  const [undoSnap, setUndoSnap] = useState<{ text: string } | null>(null);
  const baseRef = useRef("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Boot: config + rascunho salvo.
  useEffect(() => {
    void loadConfigCache().then(() => setConfigReady(hasConfig()));
    try {
      setText(localStorage.getItem(TEXT_KEY) ?? "");
      setEstilo(localStorage.getItem(STYLE_KEY) ?? "");
      setTitulo(localStorage.getItem(TITLE_KEY) ?? "");
    } catch { /* sem storage */ }
  }, []);

  // Autosave.
  useEffect(() => {
    try { localStorage.setItem(TEXT_KEY, text); } catch { /* cheio */ }
  }, [text]);
  useEffect(() => {
    try { localStorage.setItem(STYLE_KEY, estilo); } catch { /* cheio */ }
  }, [estilo]);
  useEffect(() => {
    try { localStorage.setItem(TITLE_KEY, titulo); } catch { /* cheio */ }
  }, [titulo]);

  const lang = getTargetLang();
  const styleBlock = estilo.trim()
    ? `=== MEMÓRIA DE ESTILO DO AUTOR (siga com rigor) ===\n${estilo.trim()}`
    : "";

  const flashFor = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 6000);
  };

  // ── ✍️ ESCREVER (IA escreve sobre o tema, no estilo) ──
  const write = useCallback(async () => {
    const tema = idea.trim();
    if (!tema || busy) return;
    setError(null);
    setBusy("write");
    setUndoSnap({ text });
    baseRef.current = text.trim();
    const prefix = baseRef.current ? `${baseRef.current}\n\n` : "";
    try {
      const r = await askFreeStream(
        `Escreva um texto sobre: ${tema}`,
        `Você é o escritor do Moka Writer — um estúdio de escrita. Escreva em ${lang} ` +
          `um texto do tipo que o autor pede, seguindo a memória de estilo dele se houver. ` +
          `Texto direto, sem títulos de seção artificiais, sem markdown pesado. ` +
          `Devolva SOMENTE o texto.`,
        styleBlock,
        (full) => setText(prefix + full),
      );
      if (!r.ok) {
        setError(r.error ?? "Erro.");
        setText(text); // restaura
      }
      setIdea("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, idea, lang, styleBlock, text]);

  // ── 🩹 CORRIGIR (revisão integral no estilo) ──
  const fixArmed = useCallback(() => {
    const est = estimarTarefa(text, getConfigSync()?.model, 1.05);
    if (est.grande) {
      // Tarefa grande: orçamento internacional (modelo+tokens+tempo+moeda).
      setOrc({
        modelo: est.modelo,
        tokensIn: est.tokensIn,
        tokensOut: est.tokensOut,
        custoUsd: est.custoUsd,
        secs: est.secs,
      });
      return;
    }
    void doFix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const doFix = useCallback(async () => {
    setConfirmFix(null);
    setOrc(null);
    setError(null);
    setBusy("fix");
    setUndoSnap({ text });
    try {
      const r = await askFreeStream(
        "Corrija o texto a seguir conforme a memória de estilo. Mantenha o sentido e a voz do autor; melhore clareza, ritmo e gramática. Devolva SOMENTE o texto corrigido, completo.",
        `Você é o revisor do Moka Writer. Trabalha em ${lang}, com rigor e respeito à voz do autor.`,
        `${styleBlock}\n\n=== TEXTO PARA CORRIGIR ===\n${text}`,
        (full) => setText(full),
      );
      if (!r.ok) setError(r.error ?? "Erro.");
      else flashFor(t("wr_fixed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, styleBlock, text]);

  // ── 🧠 jogar na memória ──
  const toMemoria = useCallback(async () => {
    const body = text.trim();
    if (body.length < 200) {
      setError(t("mem_rejected_count", { n: 1 }));
      return;
    }
    await putMemoriaObject({
      memoriaId: getActiveMemoriaId(),
      type: "nota",
      title: titulo.trim() || body.slice(0, 60),
      lang,
      source: "Moka Writer",
      tags: ["writer", "texto"],
      body,
      chars: body.length,
    });
    flashFor(t("mem_imported_ok", { n: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, text, titulo]);

  return (
    <main className="writer-page">
      <VisitPing />
      <TopNav active="writer" right={<TopNavActions />} />

      <header className="memoria-hero">
        <LlmChip />
        <div className="memoria-hero-icon" aria-hidden>✍️</div>
        <h1>{t("wr_title")}</h1>
        <p className="memoria-tagline">{t("wr_tagline")}</p>
      </header>

      {configReady === false && (
        <div className="memoria-flash warn" role="alert">
          {t("har_need_key")} <Link href="/configuracoes">{t("har_go_settings")}</Link>
        </div>
      )}
      {flash && <div className="memoria-flash ok" role="status">{flash}</div>}
      {error && <div className="memoria-flash warn">⚠️ {error}</div>}

      <div className="memoria-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "estudio"}
          className={`memoria-tab ${tab === "estudio" ? "active" : ""}`}
          onClick={() => setTab("estudio")}
        >
          🎛️ {t("wr_tab_studio")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "ler"}
          className={`memoria-tab ${tab === "ler" ? "active" : ""}`}
          onClick={() => setTab("ler")}
        >
          📖 {t("wr_tab_read")}
        </button>
      </div>

      {tab === "estudio" ? (
        <section className="writer-main">
          {/* Memória de estilo */}
          <button className="writer-style-toggle" onClick={() => setStyleOpen(!styleOpen)}>
            🎨 {t("wr_style")} {estilo.trim() ? "· ✓" : ""} {styleOpen ? "▲" : "▼"}
          </button>
          {styleOpen && (
            <div className="writer-style-box">
              <textarea
                className="writer-style-area"
                rows={5}
                placeholder={t("wr_style_ph")}
                value={estilo}
                onChange={(e) => setEstilo(e.target.value)}
              />
              <p className="memoria-hint">{t("wr_style_hint")}</p>
            </div>
          )}

          {/* Título */}
          <input
            className="memoria-search"
            type="text"
            placeholder={t("wr_title_ph")}
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={120}
          />

          {/* O texto */}
          <textarea
            ref={areaRef}
            className="writer-area"
            rows={14}
            placeholder={t("wr_placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy !== null}
          />
          <p className="memoria-hint">
            {text.length.toLocaleString("pt-BR")} chars · {t("wr_autosave")}
          </p>

          {/* Escrever com IA */}
          <div className="writer-idea">
            <input
              className="memoria-input"
              type="text"
              placeholder={t("wr_idea_ph")}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void write()}
              disabled={busy !== null || configReady === false}
            />
            <button
              className="memoria-btn primary big"
              onClick={() => void write()}
              disabled={busy !== null || !idea.trim() || configReady === false}
            >
              {busy === "write" ? "…" : `✍️ ${t("wr_write")}`}
            </button>
          </div>

          {/* Corrigir com IA */}
          <div className="memoria-actions">
            <button
              className="memoria-btn big"
              onClick={fixArmed}
              disabled={busy !== null || text.trim().length < 200 || configReady === false}
            >
              {busy === "fix" ? "…" : `🩹 ${t("wr_fix")}`}
            </button>
            <button className="memoria-btn big" onClick={() => void toMemoria()} disabled={text.trim().length < 200}>
              🧠 {t("wr_to_memory")}
            </button>
          </div>
        </section>
      ) : (
        <section className="writer-main">
          {text.trim() ? (
            <article className="writer-read">
              {titulo.trim() && <h2>{titulo.trim()}</h2>}
              <pre className="writer-read-body">{text}</pre>
            </article>
          ) : (
            <div className="memoria-empty">
              <div className="memoria-empty-icon" aria-hidden>✍️</div>
              <strong>{t("wr_empty")}</strong>
            </div>
          )}
        </section>
      )}

      <SiteFooter />

      {/* Orçamento internacional antes de tarefa grande (DSC-018) */}
      {orc && (
        <OrcamentoModal
          info={orc}
          onConfirm={() => void doFix()}
          onCancel={() => setOrc(null)}
        />
      )}
    </main>
  );
}
