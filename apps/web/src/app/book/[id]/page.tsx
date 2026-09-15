"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Reader } from "@/components/Reader";
import { TopNav } from "@/components/TopNav";
import { useI18n } from "@/components/I18nProvider";
import { AIPanel } from "@/components/AIPanel";
import { hasConfig, loadConfigCache } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { getBook } from "@/lib/repository";
import { saveToLibrary } from "@/lib/repository";
import type { Session } from "@/lib/db";
import type { SelectionAction } from "@/lib/types";

/**
 * Rota /book/[id] — abre um livro específico da estante.
 * Cada livro tem URL própria (compartilhável, voltável).
 */
export default function BookPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const auth = useAuth();
  const { t } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [action, setAction] = useState<SelectionAction | null>(null);
  const [aiPanelSize, setAiPanelSize] = useState<"small" | "half" | "full">("small");
  // Painel oculto/mostrado (separado de ter ação ou não).
  // Ocultar NÃO perde a ação — só esconde visualmente.
  const [panelVisible, setPanelVisible] = useState(false);
  const [configReady, setConfigReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Proteção contra travamento (pedido do Miguel, 2026-07-22):
  // "tem que ter um botão de parar, pra proteger o usuário".
  const [slowLoad, setSlowLoad] = useState(false);
  const [loadStuck, setLoadStuck] = useState(false);

  // Reconstrói o ArrayBuffer a partir do Uint8Array (cópia defensiva).
  // MEMOIZADO: deve vir ANTES de TODOS os early returns (Rules of Hooks).
  const pdfSource = useMemo(() => {
    if (!session?.pdfSource) return null;
    const copy = new ArrayBuffer(session.pdfSource.byteLength);
    new Uint8Array(copy).set(session.pdfSource);
    return copy;
  }, [session?.pdfSource]);

  // Carrega o livro pelo ID da URL.
  useEffect(() => {
    loadConfigCache().then(() => setConfigReady(hasConfig())).catch(() => {});
    let cancelled = false;
    // Marca quando o carregamento TERMINA (sucesso ou erro) — os timers de
    // proteção NÃO podem disparar depois disso. Bug da V 1.5 (reportado
    // pelo Miguel no celular): o timer de 60s disparava mesmo com o livro
    // já aberto e derrubava a tela com a mensagem de "demorou demais".
    let finished = false;

    // ESCOTILHA DE FUGA: se o carregamento passar de 6s, mostra o botão
    // "✕ Parar"; se passar de 60s SEM TERMINAR, para sozinho com mensagem.
    const slowTimer = setTimeout(() => {
      if (!cancelled && !finished) setSlowLoad(true);
    }, 6_000);
    const stuckTimer = setTimeout(() => {
      if (!cancelled && !finished) {
        cancelled = true;
        setLoadStuck(true);
        setLoading(false);
      }
    }, 60_000);

    (async () => {
      try {
        const book = await getBook(params.id);
        finished = true;
        clearTimeout(slowTimer);
        clearTimeout(stuckTimer);
        if (cancelled) return;
        if (book) {
          setSession(book);
        } else {
          setNotFound(true);
        }
      } catch (err) {
        finished = true;
        clearTimeout(slowTimer);
        clearTimeout(stuckTimer);
        console.error("[moka] Erro ao carregar livro:", err);
        setNotFound(true);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      clearTimeout(stuckTimer);
    };
  }, [params.id]);

  // Salva mudanças (página, zoom, traduções, notas) com debounce.
  useEffect(() => {
    if (!session || loading) return;
    const t = setTimeout(() => {
      const updated = { ...session, savedAt: Date.now() };
      saveToLibrary(updated, auth.userId).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [session, loading, auth.userId]);

  const handleSelection = (a: SelectionAction) => {
    setAction(a);
    setPanelVisible(true);
  };
  const handleClosePanel = () => setAction(null);
  /** Oculta o painel sem perder a ação (pode reabrir depois). */
  const handleHidePanel = () => setPanelVisible(false);

  const updateSession = (patch: Partial<Session>) =>
    setSession((prev) => (prev ? { ...prev, ...patch } : prev));

  if (loadStuck) {
    return (
      <main className="igot-shell">
        <TopNav active="reader" />
        <div className="igot-loading">
          <p>
            ⏱️ Este livro demorou demais pra abrir e eu parei pra você não
            ficar esperando. Tente de novo — ou abra outro livro e volte depois.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => window.location.reload()} className="back-btn">
              ↻ Tentar de novo
            </button>
            <button onClick={() => router.push("/estante")} className="back-btn">
              {t("err_back_shelf")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="igot-shell">
        <TopNav active="reader" />
        <div className="igot-loading">
          <div className="spinner" />
          <p>{t("err_opening_book")}</p>
          {/* BOTÃO DE PARAR (pedido do Miguel): depois de 6s de espera,
              o usuário pode cancelar e voltar — nunca fica refém do spinner. */}
          {slowLoad && (
            <button
              onClick={() => router.push("/estante")}
              className="back-btn"
              style={{ marginTop: 8 }}
            >
              ✕ Parar e voltar pra estante
            </button>
          )}
        </div>
      </main>
    );
  }

  if (notFound || !session) {
    return (
      <main className="igot-shell">
        <TopNav active="reader" />
        <div className="igot-loading">
          <p>{t("err_book_not_found")}</p>
          <button onClick={() => router.push("/estante")} className="back-btn">
            {t("err_back_shelf")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="igot-shell">
      {/* Ordem do Miguel 15/09: menu no alto em TODA parte — a prateleira do
          livro era "workspace-no-topbar"; agora recebe o TopNav padrão
          (🏠 home + bandeirinha de idiomas + ⚙️ configurações). */}
      <TopNav active="reader" />
      <div className={`igot-workspace ${action ? "has-panel" : ""}`}>
        <Reader
          book={session.book}
          pdfSource={pdfSource}
          onSelection={handleSelection}
          panelVisible={panelVisible}
          onTogglePanel={() => setPanelVisible((v) => !v)}
          initialChapterIdx={session.chapterIdx || (typeof window !== "undefined" && session.book?.title ? Number(window.localStorage.getItem("moka.chap." + session.book.title.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40))) || 0 : 0)}
          initialZoom={session.zoom || (typeof window !== "undefined" ? Number(window.localStorage.getItem("moka.lastZoom")) || 1 : 1)}
          onChapterChange={(n) => updateSession({ chapterIdx: n })}
          onZoomChange={(z) => updateSession({ zoom: z })}
          onCloseBook={() => router.push("/estante")}
          auth={auth}
          onOpenSettings={() => router.push("/configuracoes")}
          settingsOpen={settingsOpen}
          onCloseSettings={() => setSettingsOpen(false)}
          onSettingsSaved={() => setConfigReady(hasConfig())}
          configReady={configReady}
          translations={session.translations ?? {}}
          onPageTranslation={(pageKey, text) => {
            updateSession({
              translations: { ...(session.translations ?? {}), [pageKey]: text },
            });
          }}
          notes={session.notes ?? []}
          onRemoveNote={(id) =>
            updateSession({
              notes: (session.notes ?? []).filter((n) => n.id !== id),
            })
          }
          onSaveNote={(entry) =>
            updateSession({
              notes: [
                {
                  ...entry,
                  id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  savedAt: Date.now(),
                },
                ...(session.notes ?? []),
              ],
            })
          }
          bookmarks={session.bookmarks ?? []}
          onToggleBookmark={(chapIdx, meta) => {
            const existing = session.bookmarks ?? [];
            const has = existing.some((b) => b.chapterIdx === chapIdx && (b.pageIdx ?? 0) === (meta?.pageIdx ?? 0));
            updateSession({
              bookmarks: has
                ? existing.filter((b) => !(b.chapterIdx === chapIdx && (b.pageIdx ?? 0) === (meta?.pageIdx ?? 0)))
                : [...existing, { chapterIdx: chapIdx, pageIdx: meta?.pageIdx ?? 0, savedAt: Date.now(), pageLabel: meta?.pageLabel, preview: meta?.preview }],
            });
          }}
          onGoToShelf={() => {
            // Avisa a home que viemos clicando em "estante" (não auto-abre livro).
            sessionStorage.setItem("igot.backToEstante", "1");
            router.push("/estante");
          }}
        />
      </div>
      {/* AIPanel FORA do grid do workspace — não interfere no layout.
          Flutua como overlay independente. */}
      {action && panelVisible && (
        <div className={`ai-panel-overlay ai-overlay-${aiPanelSize}`}>
          <AIPanel
            action={action}
            book={session.book}
            onClose={() => { setAction(null); setPanelVisible(false); }}
            onHide={handleHidePanel}
            onSizeChange={(size: "small" | "half" | "full") => setAiPanelSize(size)}
            onSaveNote={(entry) =>
              updateSession({
                notes: [
                  {
                    ...entry,
                    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    savedAt: Date.now(),
                  },
                  ...(session.notes ?? []),
                ],
              })
            }
          />
        </div>
      )}
      {/* CSS migrado para globals.css — cura FOUC (era <style jsx>) */}
    </main>
  );
}

