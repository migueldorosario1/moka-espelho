"use client";

import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { useI18n } from "@/components/I18nProvider";
import { LangSwitcher } from "@/components/LangSwitcher";

/**
 * CAPA — fase GRATUITA (pivô do Miguel, 2026-08-04):
 * nada de preços/pontos — o Moka é grátis e roda com a chave de IA do
 * próprio usuário (BYOK). Rodapé com doação + Quem Somos + contato.
 * Login Google em DESTAQUE: é o que faz a biblioteca syncar entre
 * aparelhos (e cria o vínculo com o leitor — pedido do Miguel).
 * (A versão de vendas com pontos está no backup pré-pivô / tag
 * `pre-pivot-pago-v4.3` — volta na Fase 2.)
 *
 * 16/08/2026: extraído de app/page.tsx (que virou wrapper server só pra
 * poder exportar metadados SEO — canonical etc.) — o JSX segue idêntico.
 */
export function Capa() {
  const { t } = useI18n();

  return (
    <main className="igot-shell ft">

      {/* 🌐 Bandeirinha de idioma (ordem do Miguel, 31/08: o menu saiu
          da capa, mas a bandeirinha FICA — ela é importante) */}
      <div className="capa-lang">
        <LangSwitcher />
      </div>

      <div className="capa-body">
        <p className="capa-kicker">{t("capa_kicker")}</p>
        <div className="capa-logo">MOKA</div>
        <h1 className="capa-tagline">{t("app_tagline")}</h1>

        {/* ── FASE GRATUITA: BYOK é o único caminho (e é grátis) ── */}
        <div className="capa-paths">
          <Link className="capa-path" href="/estante">
            <b>🆓 {t("free_title")}</b>
            <span>{t("free_desc")}</span>
          </Link>
          <Link className="capa-path" href="/tutorial">
            <b>🔑 {t("byok_get_key")}</b>
            <span>{t("byok_cost")}</span>
          </Link>
        </div>

        {/* Login Google = biblioteca em qualquer aparelho (pedido do Miguel) */}
        <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t("capa_login_benefit")}
        </p>

        {/* ── A FAMÍLIA MOKA (ordem do Miguel ~18h, corrigida ~19h: o
            protagonista é o CONJUNTO — os cinco Mokas com a MESMA
            importância, botões GRANDES e IGUAIS, capa funcional sem
            ilustração decorativa) ── */}
        <div className="capa-launch">
          <a className="capa-launch-btn" href="/estante">
            <span className="capa-launch-ico" aria-hidden>📖</span>
            <b>Moka Reader</b>
            <span>{t("capa_books_desc")}</span>
          </a>
          <a className="capa-launch-btn" href="/video">
            <span className="capa-launch-ico" aria-hidden>🎬</span>
            <b>Moka Vídeo</b>
            <span>{t("capa_videos_desc")}</span>
          </a>
          <a className="capa-launch-btn" href="/memoria">
            <span className="capa-launch-ico" aria-hidden>🧠</span>
            <b>Moka Memória</b>
            <span>{t("mem_tagline")}</span>
          </a>
          <a className="capa-launch-btn" href="/harness">
            <span className="capa-launch-ico" aria-hidden>💬</span>
            <b>Moka Harness</b>
            <span>{t("capa_harness_desc")}</span>
          </a>
          <a className="capa-launch-btn" href="/writer">
            <span className="capa-launch-ico" aria-hidden>✍️</span>
            <b>Moka Writer</b>
            <span>{t("wr_tagline")}</span>
          </a>
          <a className="capa-launch-btn" href="/configuracoes">
            <span className="capa-launch-ico" aria-hidden>⚙️</span>
            <b>{t("settings")}</b>
            <span>{t("capa_btn_settings_desc")}</span>
          </a>
        </div>

        <p className="capa-footer">{t("byok_video_note")}</p>
      </div>

      <SiteFooter />
    </main>
  );
}
