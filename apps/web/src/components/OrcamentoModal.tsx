"use client";

/**
 * OrcamentoModal — o ORÇAMENTO internacional antes de uma tarefa grande
 * (obra MOKA; ordem do Miguel 30/08 ~16h: "explica, faz estimativa de
 * quantos tokens, qual LLM vai usar, quanto tempo vai demorar e quanto
 * vai custar em reais OU NA MOEDA DO USUÁRIO — nada hardcode").
 *
 * Mostra: modelo ativo do BYOK · tokens in/out · tempo estimado · custo em
 * US$ E na moeda local escolhida pelo usuário (telemetria/CURRENCIES).
 * Confirmação FORTE em 2 cliques ("Sim, fazer agora").
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./I18nProvider";
import { getCurrency, convertFromUsd, fmtMoney } from "@/lib/telemetry";

export interface OrcamentoInfo {
  /** Nome do modelo (do ranking oficial) — "qual LLM vai usar". */
  modelo: string;
  tokensIn: number;
  tokensOut: number;
  custoUsd: number;
  /** Segundos estimados (0 = desconhecido). */
  secs: number;
}

function fmtTime(secs: number, t: (k: never) => string): string {
  if (!secs) return "—";
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}min`;
  if (secs >= 60) return `${Math.max(1, Math.round(secs / 60))} min`;
  return `${secs}s`;
}

export function OrcamentoModal({
  info,
  onConfirm,
  onCancel,
}: {
  info: OrcamentoInfo;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const cur = getCurrency();
  const local =
    cur.code === "USD"
      ? ""
      : ` · ≈ ${fmtMoney(convertFromUsd(info.custoUsd, cur), cur)}`;

  return createPortal(
    <div
      className="memoria-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t("or_title")}
      ref={ref}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="memoria-modal-box small">
        <h2 className="or-title">🧮 {t("or_title")}</h2>
        <ul className="or-list">
          <li>
            🤖 <b>{t("or_model")}</b> {info.modelo}
          </li>
          <li>
            🔢 <b>{t("or_tokens")}</b> ≈ {info.tokensIn.toLocaleString()} +{" "}
            {info.tokensOut.toLocaleString()}
          </li>
          <li>
            ⏱️ <b>{t("or_time")}</b> {fmtTime(info.secs, t)}
          </li>
          <li>
            💰 <b>{t("or_cost")}</b> ≈ US$
            {info.custoUsd >= 0.01 ? info.custoUsd.toFixed(2) : info.custoUsd.toFixed(4)}
            {local}
          </li>
        </ul>
        <p className="or-sure">🤔 {t("tb_sure", { cost: `US$${info.custoUsd.toFixed(2)}${local}` })}</p>
        <div className="memoria-card-actions center">
          <button className="memoria-btn primary big" onClick={onConfirm}>
            ✅ {t("tb_sure_yes")}
          </button>
          <button className="memoria-btn big" onClick={onCancel}>
            {t("tb_sure_no")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
