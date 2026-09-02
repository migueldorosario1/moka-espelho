"use client";
import { TopNav } from "@/components/TopNav";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PRESETS } from "@igot/ai-providers";
import { CafezinhoLogo } from "@/components/CafezinhoLogo";
import { LangSwitcher } from "@/components/LangSwitcher";
import { AuthGate } from "@/components/AuthGate";
import { SiteFooter } from "@/components/SiteFooter";
import { TeleCharts } from "@/components/TeleCharts";
import {
  listAllEntriesSync,
  loadConfigCache,
  invalidateConfigCache,
  getConfigById,
  updateEntryModel,
} from "@/lib/config";
import { listModels } from "@/lib/ai-client";
import {
  listRecords,
  clearRecords,
  convertFromUsd,
  fmtMoney,
  computeCostUsd,
  CURRENCIES,
  getCurrency,
  setCurrency,
  type TelemetryRecord,
  type Currency,
} from "@/lib/telemetry";
import { tt, taskLabel } from "@/lib/telemetry-strings";
import { useI18n } from "@/components/I18nProvider";

/** Chave do marcador "mostrar também na moeda do país". */
const SHOW_LOCAL_KEY = "moka.telemetry.showLocal";

const USD: Currency = { code: "USD", symbol: "$", name: "US Dollar", rate: 1 };

/** Resumo de uma entry cadastrada (o que a lista do cofre devolve). */
type EntryLite = ReturnType<typeof listAllEntriesSync>[number];

/** Formata epoch ms como data curta no idioma da interface. */
function fmtDate(ts: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/** Linha agregada (por provedor / tarefa / modelo). */
interface AggRow {
  key: string;
  label: string;
  calls: number;
  tokens: number;
  costUsd: number;
}

function aggregate(
  records: TelemetryRecord[],
  pick: (r: TelemetryRecord) => { key: string; label: string },
): AggRow[] {
  const map = new Map<string, AggRow>();
  for (const r of records) {
    const { key, label } = pick(r);
    const row = map.get(key) ?? { key, label, calls: 0, tokens: 0, costUsd: 0 };
    row.calls += 1;
    row.tokens += r.totalTokens;
    row.costUsd += r.costUsd;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd);
}

/** Escapa um campo pro CSV. */
function csvField(v: string | number | boolean): string {
  const s = String(v);
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Seletor de modelo 🧩 de uma IA cadastrada (reforma do Miguel, 22/08:
 * "uma página das suas IAs pra trocar o modelo"). Ao abrir, busca a lista
 * de modelos do provedor automaticamente; clicar num modelo troca NA HORA.
 */
function AiModelPicker({
  entry,
  lang,
  onChanged,
}: {
  entry: EntryLite;
  lang: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");

  const preset = PRESETS.find((p) => p.id === entry.providerId);
  const current = entry.model || preset?.defaultModel || "";

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setDraft(entry.model ?? "");
    setList(null);
    const config = getConfigById(entry.id);
    if (!config) return;
    setLoading(true);
    listModels(config).then((r) => {
      setLoading(false);
      setList(r.ok && r.models ? r.models : []);
    });
  };

  const persist = async (model: string) => {
    await updateEntryModel(entry.id, model);
    await loadConfigCache();
    onChanged();
    setOpen(false);
  };

  return (
    <div className="tele-ai-model-row">
      <button type="button" className="model-edit-btn" onClick={toggle} title={tt(lang, "set_model_btn")}>
        🧩 {current}
        <span className="model-edit-arrow">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="model-inline-editor">
          {loading && <p className="hint">⏳ {t2(lang, "search")}</p>}
          {list && list.length > 0 && (
            <div className="models-scroll model-inline-list">
              {list.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`model-item ${current === m ? "selected" : ""}`}
                  onClick={() => persist(m)}
                >
                  {current === m && "✓ "}{m}
                </button>
              ))}
            </div>
          )}
          {list && list.length === 0 && !loading && (
            <p className="hint">{t2(lang, "no_models")}</p>
          )}
          <div className="model-row">
            <input
              type="text"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); void persist(draft); } }}
              placeholder={preset?.defaultModel}
              spellCheck={false}
            />
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const config = getConfigById(entry.id);
                if (!config) return;
                setLoading(true);
                listModels(config).then((r) => {
                  setLoading(false);
                  setList(r.ok && r.models ? r.models : []);
                });
              }}
              disabled={loading}
              title={t2(lang, "search")}
            >
              {loading ? "⏳" : "🔍"}
            </button>
          </div>
          <div className="model-inline-actions">
            <button type="button" className="mini-btn use-btn" onClick={() => persist(draft)}>
              💾 {t2(lang, "save")}
            </button>
            <button type="button" className="mini-btn" onClick={() => setOpen(false)}>
              {t2(lang, "cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Chaves do ui-strings usadas pelo seletor (evita importar o dicionário inteiro). */
function t2(lang: string, key: "search" | "no_models" | "save" | "cancel"): string {
  const TABLE: Record<string, Record<string, string>> = {
    "pt-BR": { search: "Buscar modelos", no_models: "Nenhum modelo encontrado — digite o nome.", save: "Salvar", cancel: "Cancelar" },
    en: { search: "Search models", no_models: "No models found — type the name.", save: "Save", cancel: "Cancel" },
    es: { search: "Buscar modelos", no_models: "No se encontraron modelos — escribe el nombre.", save: "Guardar", cancel: "Cancelar" },
    fr: { search: "Chercher les modèles", no_models: "Aucun modèle trouvé — saisissez le nom.", save: "Enregistrer", cancel: "Annuler" },
    de: { search: "Modelle suchen", no_models: "Keine Modelle gefunden — Namen eingeben.", save: "Speichern", cancel: "Abbrechen" },
    it: { search: "Cerca modelli", no_models: "Nessun modello trovato — digita il nome.", save: "Salva", cancel: "Annulla" },
    ru: { search: "Поиск моделей", no_models: "Модели не найдены — введите имя.", save: "Сохранить", cancel: "Отмена" },
    zh: { search: "搜索模型", no_models: "未找到模型——请输入名称。", save: "保存", cancel: "取消" },
    ja: { search: "モデルを検索", no_models: "モデルが見つかりません——名前を入力。", save: "保存", cancel: "キャンセル" },
    ko: { search: "모델 검색", no_models: "모델을 찾지 못했습니다 — 이름을 입력하세요.", save: "저장", cancel: "취소" },
    ar: { search: "البحث عن النماذج", no_models: "لا نماذج — اكتب الاسم.", save: "حفظ", cancel: "إلغاء" },
    hi: { search: "मॉडल खोजें", no_models: "कोई मॉडल नहीं — नाम लिखें।", save: "सहेजें", cancel: "रद्द करें" },
  };
  return (TABLE[lang] ?? TABLE.en)[key];
}

/**
 * /telemetria — a página "SUAS IAs" (reforma do Miguel, 22/08): controle
 * das IAs registradas (trocar modelo de cada uma) + telemetria de gastos
 * (banco LOCAL IndexedDB: custo por IA/tarefa/modelo em dólar e na moeda
 * do país) + tabela de preços das IAs. Tudo no dispositivo do usuário.
 */
export default function TelemetriaPage() {
  const { lang } = useI18n();
  const router = useRouter();

  const [entries, setEntries] = useState<EntryLite[]>([]);
  const [records, setRecords] = useState<TelemetryRecord[] | null>(null);
  const [currency, setCurrencyState] = useState<Currency>(USD);
  const [showLocal, setShowLocal] = useState(true);


  const load = useCallback(() => {
    void listRecords().then(setRecords);
  }, []);

  const reloadEntries = useCallback(() => {
    setEntries(listAllEntriesSync());
  }, []);

  useEffect(() => {
    invalidateConfigCache();
    loadConfigCache().then(() => setEntries(listAllEntriesSync()));
    load();
    setCurrencyState(getCurrency());
    try {
      const saved = window.localStorage.getItem(SHOW_LOCAL_KEY);
      if (saved === "0") setShowLocal(false);
    } catch { /* sem localStorage, segue padrão */ }
  }, [load]);

  const totals = useMemo(() => {
    if (!records) return null;
    let tokens = 0;
    let costUsd = 0;
    for (const r of records) {
      tokens += r.totalTokens;
      costUsd += r.costUsd;
    }
    return { calls: records.length, tokens, costUsd };
  }, [records]);

  /** Gasto atribuído a uma entry: mesmo provedor E modelo compatível. */
  const spendFor = useCallback(
    (e: EntryLite) => {
      let costUsd = 0;
      let calls = 0;
      for (const r of records ?? []) {
        if (r.providerId !== e.providerId) continue;
        if (e.model && r.model && r.model !== e.model) continue;
        costUsd += r.costUsd;
        calls += 1;
      }
      return { costUsd, calls };
    },
    [records],
  );

  const byProvider = useMemo(
    () => aggregate(records ?? [], (r) => ({ key: r.providerId, label: r.providerName || r.providerId })),
    [records],
  );
  const byTask = useMemo(
    () => aggregate(records ?? [], (r) => ({ key: r.task, label: taskLabel(lang, r.task) })),
    [records, lang],
  );
  const byModel = useMemo(
    () => aggregate(records ?? [], (r) => {
      const label = `${r.providerName || r.providerId} · ${r.model || "default"}`;
      return { key: `${r.providerId}/${r.model || "default"}`, label };
    }),
    [records],
  );

  const changeCurrency = (code: string) => {
    setCurrency(code);
    const found = CURRENCIES.find((c) => c.code === code);
    if (found) setCurrencyState(found);
  };

  const toggleShowLocal = () => {
    setShowLocal((v) => {
      try { window.localStorage.setItem(SHOW_LOCAL_KEY, v ? "0" : "1"); } catch { /* ok */ }
      return !v;
    });
  };

  /** Mostra o custo em dólar (+ moeda local, se o marcador estiver ligado). */
  const money = (usd: number) => {
    const base = fmtMoney(usd, USD);
    if (!showLocal || currency.code === "USD") return base;
    return `${base} ≈ ${fmtMoney(convertFromUsd(usd, currency), currency)}`;
  };

  const handleExportCsv = () => {
    if (!records || records.length === 0) return;
    const header = [
      "date", "task", "provider_id", "provider", "model",
      "prompt_tokens", "completion_tokens", "total_tokens",
      "estimated", "cost_usd", "status", "note",
    ];
    const lines = [header.join(",")];
    for (const r of records) {
      lines.push([
        csvField(new Date(r.ts).toISOString()),
        csvField(r.task),
        csvField(r.providerId),
        csvField(r.providerName),
        csvField(r.model),
        r.promptTokens,
        r.completionTokens,
        r.totalTokens,
        r.usageEstimated,
        r.costUsd.toFixed(6),
        csvField(r.status),
        csvField(r.note ?? ""),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moka-telemetria-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = async () => {
    if (!confirm(tt(lang, "tele_clear_confirm"))) return;
    await clearRecords();
    setRecords([]);
  };

  return (
    <main className="cfg-page">
      {/* TopBar padrão (como /configuracoes) — logo + idioma + fechar,
          pra pessoa poder mudar a língua daqui também (Miguel, 22/08). */}
      <TopNav right={<>
<AuthGate />
          <LangSwitcher />
          <button
            className="cfg-close-btn"
            onClick={() => router.back()}
            aria-label="✕"
            title="✕"
          >
            ✕
          </button>

          <Link href="/estante" className="brand" title="Voltar à estante">
            <CafezinhoLogo size={26} opacity={0.85} /> <span>Moka</span>
          </Link>
          <span className="cfg-topbar-label">📊 {tt(lang, "tele_nav")}</span>
      </>} />

      <div className="cfg-container">
        <header className="cfg-header">
          <h1 className="cfg-title">🤖 {tt(lang, "tele_page_title")}</h1>
          <p className="cfg-intro">{tt(lang, "tele_intro")}</p>
        </header>

        {/* ═══ 1. SUAS IAs REGISTRADAS — trocar modelo + gasto de cada uma ═══ */}
        <section className="cfg-section">
          <h2 className="cfg-section-title">🤖 {tt(lang, "tele_your_ais")}</h2>
          {entries.length === 0 ? (
            <div className="tele-empty-ais">
              <p>{tt(lang, "tele_no_ais")}</p>
              <Link href="/configuracoes" className="tele-btn">
                {tt(lang, "tele_add_key")}
              </Link>
            </div>
          ) : (
            <div className="tele-ai-list">
              {entries.map((e) => {
                const preset = PRESETS.find((p) => p.id === e.providerId);
                const name = e.label || preset?.name || e.providerId;
                const spend = spendFor(e);
                return (
                  <div key={e.id} className={`tele-ai-card ${e.active ? "active" : ""}`}>
                    <div className="tele-ai-head">
                      <span className="tele-ai-name">
                        {e.active && <span className="active-dot">●</span>} {name}
                      </span>
                      <span className="tele-ai-key">{e.maskedKey}</span>
                    </div>
                    <AiModelPicker entry={e} lang={lang} onChanged={reloadEntries} />
                    <div className="tele-ai-spend" title={tt(lang, "tele_approx")}>
                      💸 {tt(lang, "tele_ai_spent")}: <strong>{money(spend.costUsd)}</strong>
                      {" · "}
                      {spend.calls} {tt(lang, "tele_calls")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ═══ 2. GASTOS POR USO (telemetria completa) ═══ */}
        <section className="cfg-section">
          <h2 className="cfg-section-title">{tt(lang, "tele_spend_title")}</h2>

          {/* Moeda + marcador "mostrar também na moeda do país" */}
          <div className="tele-currency-row">
            <label htmlFor="tele-currency">💱 {tt(lang, "tele_currency")}:</label>
            <select
              id="tele-currency"
              value={currency.code}
              onChange={(e) => changeCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <label className="tts-checkbox-row" title={tt(lang, "tele_approx")}>
              <input type="checkbox" checked={showLocal} onChange={toggleShowLocal} />
              💲 + {currency.code}
            </label>
          </div>

          {records === null ? (
            <p className="tele-empty">⏳ …</p>
          ) : !totals || totals.calls === 0 ? (
            <p className="tele-empty">{tt(lang, "tele_empty")}</p>
          ) : (
            <>
              {/* 3 linhas de GASTO (Miguel, 25/08): desde o início do
                  app NESTE dispositivo, últimos 7 e últimos 30 dias. */}
              <div className="tele-period-totals">
                <div className="tele-period-row">
                  <span className="lbl">{tt(lang, "tele_total_all")}</span>
                  <span className="num">{money(totals.costUsd)}</span>
                </div>
                <div className="tele-period-row">
                  <span className="lbl">{tt(lang, "tele_total_7")}</span>
                  <span className="num">{money(records.filter((r) => r.ts >= Date.now() - 7 * 864e5).reduce((s, r) => s + r.costUsd, 0))}</span>
                </div>
                <div className="tele-period-row">
                  <span className="lbl">{tt(lang, "tele_total_30")}</span>
                  <span className="num">{money(records.filter((r) => r.ts >= Date.now() - 30 * 864e5).reduce((s, r) => s + r.costUsd, 0))}</span>
                </div>
              </div>

              {/* Totais */}
              <div className="tele-totals">
                <div className="tele-total-card">
                  <span className="num">{money(totals.costUsd)}</span>
                  <span className="lbl">{tt(lang, "tele_total")}</span>
                </div>
                <div className="tele-total-card">
                  <span className="num">{totals.tokens.toLocaleString()}</span>
                  <span className="lbl">{tt(lang, "tele_tokens")}</span>
                </div>
                <div className="tele-total-card">
                  <span className="num">{totals.calls.toLocaleString()}</span>
                  <span className="lbl">{tt(lang, "tele_calls")}</span>
                </div>
              </div>

              {/* Por provedor */}
              <h3 className="tele-group-title">{tt(lang, "tele_by_provider")}</h3>
              <table className="tele-table">
                <thead>
                  <tr>
                    <th>{tt(lang, "tele_provider")}</th>
                    <th className="num">{tt(lang, "tele_calls")}</th>
                    <th className="num">{tt(lang, "tele_tokens")}</th>
                    <th className="num">{tt(lang, "tele_cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {byProvider.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td className="num">{row.calls}</td>
                      <td className="num">{row.tokens.toLocaleString()}</td>
                      <td className="num">{money(row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Por tarefa */}
              <h3 className="tele-group-title">{tt(lang, "tele_by_task")}</h3>
              <table className="tele-table">
                <thead>
                  <tr>
                    <th>{tt(lang, "tele_task")}</th>
                    <th className="num">{tt(lang, "tele_calls")}</th>
                    <th className="num">{tt(lang, "tele_tokens")}</th>
                    <th className="num">{tt(lang, "tele_cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {byTask.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td className="num">{row.calls}</td>
                      <td className="num">{row.tokens.toLocaleString()}</td>
                      <td className="num">{money(row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Por modelo */}
              <h3 className="tele-group-title">{tt(lang, "tele_by_model")}</h3>
              <table className="tele-table">
                <thead>
                  <tr>
                    <th>{tt(lang, "tele_model")}</th>
                    <th className="num">{tt(lang, "tele_calls")}</th>
                    <th className="num">{tt(lang, "tele_tokens")}</th>
                    <th className="num">{tt(lang, "tele_cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td className="num">{row.calls}</td>
                      <td className="num">{row.tokens.toLocaleString()}</td>
                      <td className="num">{money(row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Histórico (últimos 100) */}
              <h3 className="tele-group-title">{tt(lang, "tele_history")}</h3>
              <div className="tele-records">
                {records.slice(0, 100).map((r) => (
                  <div key={r.id} className="tele-record">
                    <div>
                      <div>
                        {taskLabel(lang, r.task)}
                        {r.status === "error" ? ` · ⚠️ ${tt(lang, "tele_err")}` : ""}
                      </div>
                      <div className="tele-record-meta">
                        {fmtDate(r.ts, lang)} · {r.providerName || r.providerId}
                        {r.model ? ` (${r.model})` : ""} ·{" "}
                        {r.promptTokens.toLocaleString()} ↓ / {r.completionTokens.toLocaleString()} ↑
                        {r.usageEstimated ? ` · ${tt(lang, "usage_estimated")}` : ""}
                      </div>
                    </div>
                    <span className={`tele-record-cost ${r.status === "error" ? "err" : ""}`}>
                      {money(r.costUsd)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Ações */}
              <div className="tele-actions">
                <button type="button" className="tele-btn" onClick={handleExportCsv}>
                  ⬇️ {tt(lang, "tele_export_csv")}
                </button>
                <button type="button" className="tele-btn danger" onClick={handleClear}>
                  🗑 {tt(lang, "tele_clear")}
                </button>
              </div>
            </>
          )}
        </section>

        {/* 📈 Gráficos de gastos (Miguel, 24/08): DOIS gráficos por dia —
            custo e tokens — com legenda clicável por LLM (todas ou só
            algumas). Cobre todas as tarefas e idiomas cadastrados. */}
        <section className="cfg-section">
          <h2 className="cfg-section-title">{tt(lang, "tele_charts_title")}</h2>
          <TeleCharts records={records ?? []} />
        </section>

        {/* ═══ MURAL DAS IAs — página própria (Miguel, 24/08): telemetria é
            o SEU bolso; mural é pra ESCOLHER IA. Sem misturar. ═══ */}
        <section className="cfg-section">
          <Link href="/mural-das-ias" className="tele-btn">
            {tt(lang, "tele_mural_btn")} →
          </Link>
        </section>

        {/* Atalho pras configurações completas (idiomas, vídeo, avisos). */}
        <div className="tele-actions">
          <Link href="/configuracoes" className="tele-btn">
            {tt(lang, "tele_open_settings")} →
          </Link>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
