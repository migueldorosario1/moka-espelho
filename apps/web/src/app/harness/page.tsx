"use client";

/**
 * MOKA HARNESS beta (obra MOKA, etapa 2 — 30/08/2026).
 *
 * Chat com a IA da própria chave do usuário (BYOK) que conhece a MEMÓRIA
 * dele — o "secretário particular do conhecimento" (DSC-014/021).
 * Entra pelo site, zero install (PWA do Moka).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LangSwitcher } from "@/components/LangSwitcher";
import { TopNav, TopNavActions } from "@/components/TopNav";
import { LlmChip } from "@/components/LlmChip";
import { BackButton } from "@/components/BackButton";
import { SiteFooter } from "@/components/SiteFooter";
import { VisitPing } from "@/components/VisitPing";
import { useI18n } from "@/components/I18nProvider";
import { hasConfig, loadConfigCache } from "@/lib/config";
import type { MemoriaObject } from "@/lib/memoria/types";
import { getActiveMemoriaId, listMemoriaObjects, listMemorias } from "@/lib/memoria/store";
import { estimateTokens, matchPrice } from "@/lib/memoria/orcamento";
import { custo } from "@/lib/llm-prices";
import { getCurrency, convertFromUsd, fmtMoney } from "@/lib/telemetry";
import { getConfigSync } from "@/lib/config";
import { askHarnessStream, type HarnessTurn } from "@/lib/memoria/harness";

interface ChatMsg extends HarnessTurn {
  /** Objetos da memória que fundamentaram a resposta (só assistant). */
  consulted?: MemoriaObject[];
}

export default function HarnessPage() {
  const router = useRouter();
  const { t } = useI18n();

  const [configReady, setConfigReady] = useState<boolean | null>(null);
  const [objetos, setObjetos] = useState<MemoriaObject[]>([]);
  const [objetosOp, setObjetosOp] = useState<MemoriaObject[]>([]);
  // Quais memórias o Harness usa na conversa (ordem do Miguel ~18h).
  const [useBag, setUseBag] = useState(true);
  const [useOp, setUseOp] = useState(true);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Boot: config BYOK + memória ativa.
  useEffect(() => {
    let alive = true;
    void loadConfigCache().then(() => {
      if (alive) setConfigReady(hasConfig());
    });
    void listMemoriaObjects(getActiveMemoriaId())
      .then((os) => {
        if (alive) setObjetos(os);
      })
      .catch(() => undefined);
    // Memórias OPERACIONAIS (⚡): contexto de trabalho da IA (kinds do Miguel).
    void (async () => {
      try {
        const metas = await listMemorias();
        const ops: MemoriaObject[] = [];
        for (const m of metas.filter((x) => x.kind === "operacional" && x.id !== getActiveMemoriaId())) {
          const os = await listMemoriaObjects(m.id);
          ops.push(...os.slice(0, 20));
        }
        if (alive) setObjetosOp(ops);
      } catch { /* best-effort */ }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Custo estimado de contexto por pergunta (bagagem ≈ 5×1500 chars; operacional ≈ 3×800).
  const costOf = useCallback((chars: number) => {
    const price = matchPrice(getConfigSync()?.model);
    const tokens = estimateTokens("x".repeat(chars));
    const usdv = custo(price, tokens / 1000, 0);
    const cur = getCurrency();
    return fmtMoney(convertFromUsd(usdv, cur), cur);
  }, []);
  const bagCost = useMemo(
    () => costOf(Math.min(objetos.length, 5) * 1500),
    [objetos.length, costOf],
  );
  const opCost = useMemo(
    () => costOf(Math.min(objetosOp.length, 3) * 800),
    [objetosOp.length, costOf],
  );

  // Rola pro fim a cada mensagem/streaming.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    const history: HarnessTurn[] = msgs.map(({ role, text }) => ({ role, text }));
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "" }]);
    let consulted: MemoriaObject[] = [];
    try {
      const answer = await askHarnessStream(
        q,
        useBag ? objetos : [],
        history,
        (full) => {
          setMsgs((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { role: "assistant", text: full, consulted };
            return copy;
          });
        },
        useOp ? objetosOp : [],
      );
      consulted = answer.consulted;
      if (!answer.ok) {
        setError(answer.error ?? "Erro.");
        setMsgs((m) => m.slice(0, -1)); // tira a resposta vazia
      } else {
        setMsgs((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: "assistant",
            text: answer.text ?? "",
            consulted: answer.consulted,
          };
          return copy;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMsgs((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }, [busy, input, msgs, objetos, objetosOp, useBag, useOp]);

  return (
    <main className="harness-page">
      <VisitPing />
      <TopNav active="harness" right={<TopNavActions />} />

      <header className="harness-hero">
        <div className="memoria-hero-icon" aria-hidden>💬</div>
        <h1>{t("har_title")}</h1>
        <p className="memoria-tagline">{t("har_tagline")}</p>
        {/* Quem está ligada + trocar (ordem do Miguel, 31/08) */}
        <LlmChip />
      </header>

      {/* Seletor de memórias em uso + custo (ordem do Miguel ~18h) */}
      <div className="harness-mems">
        <button
          className={`harness-mem-chip ${useBag ? "on" : ""}`}
          onClick={() => setUseBag((v) => !v)}
          aria-pressed={useBag}
          title={t("mem_kind_bag")}
        >
          {t("mem_kind_bag")} · {objetos.length} · ≈{bagCost}
        </button>
        <button
          className={`harness-mem-chip ${useOp ? "on" : ""}`}
          onClick={() => setUseOp((v) => !v)}
          aria-pressed={useOp}
          title={t("mem_kind_op")}
        >
          {t("mem_kind_op")} · {objetosOp.length} · ≈{opCost}
        </button>
      </div>

      {configReady === false && (
        <div className="memoria-flash warn" role="alert">
          {t("har_need_key")}{" "}
          <Link href="/configuracoes">{t("har_go_settings")}</Link>
        </div>
      )}

      {objetos.length === 0 && (
        <div className="memoria-flash warn">
          {t("har_memory_empty")}{" "}
          <Link href="/memoria">{t("har_go_memory")}</Link>
        </div>
      )}

      {/* Diálogo */}
      <div className="harness-chat" aria-live="polite">
        {msgs.length === 0 && (
          <div className="harness-empty">
            <p>{t("har_empty")}</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`harness-msg ${m.role}`}>
            <div className="harness-bubble">
              {m.text ||
                (m.role === "assistant" && busy && i === msgs.length - 1 ? (
                  <span className="harness-typing">…</span>
                ) : (
                  ""
                ))}
            </div>
            {m.role === "assistant" && m.consulted && m.consulted.length > 0 && (
              <p className="harness-consulted">
                🧠 {t("har_consulted", { n: m.consulted.length })}{" "}
                {m.consulted.map((o) => o.title).join(" · ")}
              </p>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <div className="memoria-flash warn">⚠️ {error}</div>}

      {/* Entrada GRANDE */}
      <div className="harness-inputbar">
        <textarea
          className="harness-input"
          rows={2}
          placeholder={t("har_placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={busy || configReady === false}
        />
        <button
          className="memoria-btn primary big"
          onClick={() => void send()}
          disabled={busy || !input.trim() || configReady === false}
        >
          {busy ? "…" : `➤ ${t("har_send")}`}
        </button>
      </div>

      <SiteFooter />
    </main>
  );
}
