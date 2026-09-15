"use client";

import Link from "next/link";
import { CafezinhoLogo } from "@/components/CafezinhoLogo";
import { LangSwitcher } from "@/components/LangSwitcher";
import { AuthGate } from "@/components/AuthGate";
import { SiteFooter } from "@/components/SiteFooter";
import { useI18n } from "@/components/I18nProvider";
import { TopNav, TopNavActions } from "@/components/TopNav";

/**
 * /experimente — FASE GRATUITA (pivô do Miguel, 2026-08-04).
 * Antes: checkout de pontos (Pix/Mercado Pago). Agora: explica que o Moka
 * é grátis com a chave do próprio usuário (BYOK) + doação. O checkout da
 * versão paga está preservado no backup pré-pivô (tag `pre-pivot-pago-v4.3`)
 * e volta na Fase 2.
 */
export default function Experimente() {
  const { t } = useI18n();

  return (
    <main className="igot-shell ft">
      {/* TopNav padrão (ordem do Miguel 15/09: menu no alto em TODAS as páginas). */}
      <TopNav right={<TopNavActions />} />

      <div className="capa-body">
        <h1 className="capa-tagline" style={{ fontSize: 28 }}>🆓 {t("free_title")}</h1>
        <p style={{ maxWidth: 560, margin: "12px auto 0", lineHeight: 1.7, color: "var(--text-muted)" }}>
          {t("free_desc")}
        </p>
        <p style={{ maxWidth: 560, margin: "14px auto 0", lineHeight: 1.7, color: "var(--text-muted)" }}>
          {t("byok_cost")}
        </p>
        <p style={{ maxWidth: 560, margin: "14px auto 0", lineHeight: 1.7, color: "var(--accent)" }}>
          {t("byok_video_note")}
        </p>

        <div className="capa-cards" style={{ marginTop: 26 }}>
          <Link className="capa-card" href="/ajuda">
            <b>🔑 {t("byok_get_key")}</b>
            <span>{t("free_desc")}</span>
          </Link>
          <Link className="capa-card" href="/estante">
            <b>📖 {t("capa_shelf_books")}</b>
            <span>{t("capa_books_desc")}</span>
          </Link>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
