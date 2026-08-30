"use client";

/**
 * MOKA MEMÓRIA — página do módulo (obra MOKA, etapa 1 — DSC-019).
 *
 * O gerenciador da memória do conhecimento do usuário:
 *   - Objetos: busca instantânea, ver, exportar .md, tirar
 *   - Importar .md (conversor + anti-poluição)
 *   - Exportar a memória inteira (INDEX portátil)
 *   - Memórias (perfis nomeados): criar, ativar, excluir
 *
 * Local-first: tudo no aparelho (IndexedDB). Zero nuvem, zero setup.
 * Botões GRANDES por natureza (redesign DSC-019 já nasce grande).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CafezinhoLogo } from "@/components/CafezinhoLogo";
import { LangSwitcher } from "@/components/LangSwitcher";
import { SectionSwitcher } from "@/components/SectionSwitcher";
import { BackButton } from "@/components/BackButton";
import { AuthGate } from "@/components/AuthGate";
import { SiteFooter } from "@/components/SiteFooter";
import { VisitPing } from "@/components/VisitPing";
import { useI18n } from "@/components/I18nProvider";
import type { UIStringKey } from "@/lib/ui-strings";
import type { MemoriaMeta, MemoriaObject } from "@/lib/memoria/types";
import {
  createMemoria,
  deleteMemoria,
  deleteMemoriaObject,
  ensureDefaultMemoria,
  getActiveMemoriaId,
  listMemoriaObjects,
  listMemorias,
  putMemoriaObject,
  setActiveMemoriaId,
} from "@/lib/memoria/store";
import {
  exportMemoriaMarkdown,
  parseOneMarkdown,
  serializeObject,
  slugify,
  splitImportFile,
} from "@/lib/memoria/markdown";
import { searchMemoria } from "@/lib/memoria/store";

const TYPE_ICON: Record<string, string> = {
  md: "📄",
  resumo: "📝",
  traducao: "🌍",
  video: "🎬",
  nota: "📌",
};

function typeKey(type: string): UIStringKey {
  switch (type) {
    case "resumo":
      return "mem_type_resumo";
    case "traducao":
      return "mem_type_traducao";
    case "video":
      return "mem_type_video";
    case "nota":
      return "mem_type_nota";
    default:
      return "mem_type_md";
  }
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function MemoriaPage() {
  const router = useRouter();
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [metas, setMetas] = useState<MemoriaMeta[]>([]);
  const [ativaId, setAtivaId] = useState("principal");
  const [objetos, setObjetos] = useState<MemoriaObject[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"objetos" | "memorias">("objetos");
  const [viewing, setViewing] = useState<MemoriaObject | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [novaMemNome, setNovaMemNome] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [confirmDel, setConfirmDel] = useState<MemoriaObject | null>(null);
  const [confirmDelMem, setConfirmDelMem] = useState<MemoriaMeta | null>(null);

  const flashFor = useCallback((kind: "ok" | "warn", text: string) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash(null), 6000);
  }, []);

  const loadAll = useCallback(async () => {
    await ensureDefaultMemoria();
    const [ms, objs] = await Promise.all([
      listMemorias(),
      listMemoriaObjects(getActiveMemoriaId()),
    ]);
    setMetas(ms);
    setAtivaId(getActiveMemoriaId());
    setObjetos(objs);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const hits = useMemo(() => searchMemoria(objetos, query), [objetos, query]);
  const ativa = metas.find((m) => m.id === ativaId);

  // ── Import (conversor .md + anti-poluição) ──
  const importText = useCallback(
    async (filename: string, text: string) => {
      const blocks = splitImportFile(text);
      let ok = 0;
      let rejeitados = 0;
      const memoriaId = getActiveMemoriaId();
      for (const block of blocks) {
        const parsed = parseOneMarkdown(block);
        if (!parsed.ok || !parsed.title || !parsed.body) {
          rejeitados += 1;
          continue;
        }
        await putMemoriaObject({
          memoriaId,
          type: (parsed.fm?.type as MemoriaObject["type"]) || "md",
          title: parsed.title,
          author: parsed.fm?.author,
          date: parsed.fm?.date,
          source: parsed.fm?.source || filename,
          lang: parsed.fm?.lang,
          tags: parsed.fm?.tags ?? [],
          summary: parsed.fm?.summary,
          body: parsed.body,
          chars: parsed.body.length,
        });
        ok += 1;
      }
      await loadAll();
      if (ok > 0 && rejeitados === 0) {
        flashFor("ok", t("mem_imported_ok", { n: ok }));
      } else if (ok > 0) {
        flashFor("warn", `${t("mem_imported_ok", { n: ok })} · ${t("mem_rejected_count", { n: rejeitados })}`);
      } else {
        flashFor("warn", t("mem_rejected_count", { n: rejeitados }));
      }
    },
    [flashFor, loadAll, t],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      void (async () => {
        for (const f of Array.from(files)) {
          const text = await f.text().catch(() => "");
          if (!text) {
            flashFor("warn", `${f.name}: ${t("mem_rejected_count", { n: 1 })}`);
            continue;
          }
          await importText(f.name, text);
        }
      })();
    },
    [flashFor, importText, t],
  );

  // ── Export ──
  const exportAll = useCallback(() => {
    const nome = ativa?.nome ?? "Moka";
    const md = exportMemoriaMarkdown(nome, objetos);
    download(`moka-memoria-${slugify(nome)}-${new Date().toISOString().slice(0, 10)}.md`, md);
  }, [ativa, objetos]);

  const exportOne = useCallback((o: MemoriaObject) => {
    download(`${slugify(o.title)}.md`, serializeObject(o));
  }, []);

  // ── Ações de memória (perfis) ──
  const ativar = useCallback(
    async (id: string) => {
      setActiveMemoriaId(id);
      setAtivaId(id);
      setObjetos(await listMemoriaObjects(id));
      setQuery("");
    },
    [],
  );

  const criarMemoria = useCallback(async () => {
    const nome = novaMemNome.trim();
    if (!nome) return;
    const meta = await createMemoria(nome);
    setNovaMemNome("");
    await loadAll();
    await ativar(meta.id);
  }, [ativaId, loadAll, novaMemNome, ativar]);

  const excluirMemoria = useCallback(
    async (m: MemoriaMeta) => {
      try {
        await deleteMemoria(m.id);
        setConfirmDelMem(null);
        await loadAll();
        await ativar(getActiveMemoriaId());
      } catch {
        flashFor("warn", "✋");
      }
    },
    [ativaId, flashFor, loadAll, ativar],
  );

  const tipoStr = (o: MemoriaObject) => t(typeKey(o.type));

  return (
    <main className="memoria-page">
      <VisitPing />
      {/* TopBar padrão da casa */}
      <div className="igot-topbar">
        <div className="igot-topbar-left">
          <Link href="/" className="brand" title="Moka">
            <CafezinhoLogo size={26} opacity={0.85} /> <span>Moka</span>
          </Link>
          <SectionSwitcher active="memoria" />
        </div>
        <div className="igot-topbar-actions">
          <BackButton />
          <AuthGate />
          <LangSwitcher />
          <button
            className="gear"
            onClick={() => router.push("/configuracoes")}
            aria-label="Configurações de IA"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Cabeçalho do módulo */}
      <header className="memoria-hero">
        <div className="memoria-hero-icon" aria-hidden>🧠</div>
        <h1>{t("mem_title")}</h1>
        <p className="memoria-tagline">{t("mem_tagline")}</p>
        <p className="memoria-count">
          {t("mem_objects_count", { n: objetos.length })}
          {metas.length > 1 ? ` · ${ativa?.nome ?? ""}` : ""}
        </p>
      </header>

      {/* Abas */}
      <div className="memoria-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "objetos"}
          className={`memoria-tab ${tab === "objetos" ? "active" : ""}`}
          onClick={() => setTab("objetos")}
        >
          📚 {t("mem_tab_objects")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "memorias"}
          className={`memoria-tab ${tab === "memorias" ? "active" : ""}`}
          onClick={() => setTab("memorias")}
        >
          🗂️ {t("mem_tab_memories")}
        </button>
      </div>

      {flash && (
        <div className={`memoria-flash ${flash.kind}`} role="status">
          {flash.text}
        </div>
      )}

      {loading ? (
        <div className="igot-loading">
          <div className="spinner" />
          <p>{t("loading")}</p>
        </div>
      ) : tab === "objetos" ? (
        <section className="memoria-main">
          {/* Barra de ação GRANDE */}
          <div className="memoria-actions">
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              multiple
              hidden
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button className="memoria-btn primary big" onClick={() => fileRef.current?.click()}>
              ⬇️ {t("mem_import")}
            </button>
            <button
              className="memoria-btn big"
              onClick={exportAll}
              disabled={objetos.length === 0}
            >
              ⬆️ {t("mem_export")}
            </button>
          </div>
          <p className="memoria-hint">{t("mem_import_hint")}</p>

          {/* Busca instantânea */}
          {objetos.length > 0 && (
            <input
              className="memoria-search"
              type="search"
              placeholder={t("mem_search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("mem_search")}
            />
          )}

          {/* Dropzone */}
          <div
            className={`memoria-dropzone ${dragOver ? "over" : ""} ${objetos.length ? "" : "empty"}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onFiles(e.dataTransfer.files);
            }}
            onClick={() => objetos.length === 0 && fileRef.current?.click()}
          >
            {objetos.length === 0 ? (
              <div className="memoria-empty">
                <div className="memoria-empty-icon" aria-hidden>🧠</div>
                <strong>{t("mem_empty_title")}</strong>
                <p>{t("mem_empty_desc")}</p>
              </div>
            ) : (
              <span className="memoria-drop-hint">{t("mem_dropzone")}</span>
            )}
          </div>

          {/* Resultados */}
          {query.trim() && hits.length === 0 ? (
            <p className="memoria-noresults">{t("mem_no_results", { q: query.trim() })}</p>
          ) : (
            <ul className="memoria-grid">
              {hits.map(({ obj, snippet }) => (
                <li key={obj.id} className="memoria-card">
                  <div className="memoria-card-head">
                    <span className="memoria-card-icon" aria-hidden>
                      {TYPE_ICON[obj.type] ?? "📄"}
                    </span>
                    <button
                      className="memoria-card-title"
                      onClick={() => setViewing(obj)}
                      title={t("mem_view")}
                    >
                      {obj.title}
                    </button>
                  </div>
                  {obj.author && <p className="memoria-card-author">{obj.author}</p>}
                  {obj.tags.length > 0 && (
                    <p className="memoria-card-tags">
                      {obj.tags.slice(0, 6).map((tag) => (
                        <span key={tag} className="memoria-tag">#{tag}</span>
                      ))}
                    </p>
                  )}
                  <p className="memoria-card-snippet">{snippet}</p>
                  <p className="memoria-card-meta">
                    {tipoStr(obj)} · {obj.chars.toLocaleString("pt-BR")} chars
                    {obj.costUsd !== undefined ? ` · $${obj.costUsd.toFixed(4)}` : ""}
                  </p>
                  <div className="memoria-card-actions">
                    <button className="memoria-btn" onClick={() => setViewing(obj)}>
                      👁️ {t("mem_view")}
                    </button>
                    <button className="memoria-btn" onClick={() => exportOne(obj)}>
                      ⬆️ {t("mem_export_one")}
                    </button>
                    <button className="memoria-btn danger" onClick={() => setConfirmDel(obj)}>
                      🗑️ {t("mem_remove")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="memoria-main">
          <p className="memoria-hint">{t("mem_memories_hint")}</p>
          <ul className="memoria-mem-list">
            {metas.map((m) => (
              <li key={m.id} className={`memoria-mem ${m.id === ativaId ? "active" : ""}`}>
                <div className="memoria-mem-info">
                  <strong>{m.nome}</strong>
                  {m.id === ativaId && <span className="memoria-badge">{t("mem_active")}</span>}
                  <span className="memoria-mem-date">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="memoria-mem-actions">
                  {m.id !== ativaId && (
                    <button className="memoria-btn" onClick={() => void ativar(m.id)}>
                      ⚡ {t("mem_activate")}
                    </button>
                  )}
                  {m.id !== "principal" && (
                    <button
                      className="memoria-btn danger"
                      onClick={() => setConfirmDelMem(m)}
                    >
                      🗑️ {t("mem_delete_memory")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="memoria-new">
            <input
              type="text"
              className="memoria-input"
              placeholder={t("mem_new_memory_ph")}
              value={novaMemNome}
              onChange={(e) => setNovaMemNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void criarMemoria()}
              maxLength={60}
            />
            <button className="memoria-btn primary" onClick={() => void criarMemoria()}>
              ➕ {t("mem_create")}
            </button>
          </div>
        </section>
      )}

      <SiteFooter />

      {/* Modal: ver objeto */}
      {viewing && (
        <div
          className="memoria-modal"
          role="dialog"
          aria-modal="true"
          aria-label={viewing.title}
          onClick={(e) => e.target === e.currentTarget && setViewing(null)}
        >
          <div className="memoria-modal-box">
            <div className="memoria-modal-head">
              <h2>
                {TYPE_ICON[viewing.type] ?? "📄"} {viewing.title}
              </h2>
              <button className="memoria-btn" onClick={() => setViewing(null)}>
                ✕ {t("close")}
              </button>
            </div>
            <dl className="memoria-meta-grid">
              {viewing.author && (
                <div>
                  <dt>{t("mem_author_l")}</dt>
                  <dd>{viewing.author}</dd>
                </div>
              )}
              {viewing.date && (
                <div>
                  <dt>{t("mem_date_l")}</dt>
                  <dd>{viewing.date}</dd>
                </div>
              )}
              {viewing.source && (
                <div>
                  <dt>{t("mem_source_l")}</dt>
                  <dd>{viewing.source}</dd>
                </div>
              )}
              <div>
                <dt>{t("mem_lang_l")}</dt>
                <dd>{viewing.lang ?? "—"}</dd>
              </div>
              {viewing.tags.length > 0 && (
                <div>
                  <dt>{t("mem_tags_l")}</dt>
                  <dd>{viewing.tags.map((x) => `#${x}`).join(" ")}</dd>
                </div>
              )}
              <div>
                <dt>{t("mem_saved_l")}</dt>
                <dd>{new Date(viewing.createdAt).toLocaleString()}</dd>
              </div>
              {viewing.costUsd !== undefined && (
                <div>
                  <dt>{t("mem_cost_l")}</dt>
                  <dd>${viewing.costUsd.toFixed(4)}</dd>
                </div>
              )}
            </dl>
            {viewing.summary && (
              <p className="memoria-modal-summary">💡 {viewing.summary}</p>
            )}
            <pre className="memoria-modal-body">{viewing.body}</pre>
          </div>
        </div>
      )}

      {/* Confirmações */}
      {confirmDel && (
        <div className="memoria-modal" role="dialog" aria-modal="true">
          <div className="memoria-modal-box small">
            <p>
              <strong>{t("mem_remove_confirm")}</strong>
            </p>
            <p className="memoria-card-snippet">“{confirmDel.title}”</p>
            <div className="memoria-card-actions center">
              <button
                className="memoria-btn danger"
                onClick={async () => {
                  await deleteMemoriaObject(confirmDel.id);
                  setConfirmDel(null);
                  await loadAll();
                  flashFor("ok", t("mem_removed_ok"));
                }}
              >
                🗑️ {t("mem_remove")}
              </button>
              <button className="memoria-btn" onClick={() => setConfirmDel(null)}>
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDelMem && (
        <div className="memoria-modal" role="dialog" aria-modal="true">
          <div className="memoria-modal-box small">
            <p>
              <strong>{t("mem_delete_memory_confirm")}</strong>
            </p>
            <p className="memoria-card-snippet">“{confirmDelMem.nome}”</p>
            <div className="memoria-card-actions center">
              <button className="memoria-btn danger" onClick={() => void excluirMemoria(confirmDelMem)}>
                🗑️ {t("mem_delete_memory")}
              </button>
              <button className="memoria-btn" onClick={() => setConfirmDelMem(null)}>
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
