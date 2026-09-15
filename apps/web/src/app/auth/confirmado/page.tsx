"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CafezinhoLogo } from "@/components/CafezinhoLogo";
import { LangSwitcher } from "@/components/LangSwitcher";
import { SiteFooter } from "@/components/SiteFooter";
import { useI18n } from "@/components/I18nProvider";
import { TopNav } from "@/components/TopNav";

/**
 * /auth/confirmado — destino do link de CONFIRMAÇÃO DE CADASTRO.
 *
 * Pedido do Miguel (05/08): clicar em "Confirmar acesso" no e-mail tem que
 * abrir uma página clara — "seu e-mail está confirmado, você pode entrar" —
 * em vez de cair na home sem aviso (que ele achou "página estranha").
 *
 * O callback (/api/auth/callback?next=/auth/confirmado) já trocou o code
 * por sessão antes de mandar pra cá — a pessoa chega LOGADA. Se o link
 * expirou/foi reutilizado, o callback manda ?erro=1 e mostramos o aviso.
 */
export default function Confirmado() {
  const { t } = useI18n();
  const [erro, setErro] = useState(false);

  useEffect(() => {
    setErro(new URLSearchParams(window.location.search).get("erro") === "1");
  }, []);

  return (
    <main className="igot-shell ft">
      {/* TopNav padrão (ordem do Miguel 15/09: menu no alto em TODAS as páginas). */}
      <TopNav />

      <div className="capa-body" style={{ maxWidth: 440, margin: "0 auto", textAlign: "center" }}>
        {erro ? (
          <>
            <h1 className="capa-tagline" style={{ fontSize: 24 }}>⚠️</h1>
            <p style={{ lineHeight: 1.65, marginTop: 10 }}>{t("auth_confirmed_error")}</p>
          </>
        ) : (
          <>
            <h1 className="capa-tagline" style={{ fontSize: 24 }}>{t("auth_confirmed_title")}</h1>
            <p style={{ lineHeight: 1.65, marginTop: 10, color: "var(--text-muted)" }}>
              {t("auth_confirmed_sub")}
            </p>
          </>
        )}
        <p style={{ marginTop: 22 }}>
          <Link
            href="/"
            style={{
              display: "inline-block",
              padding: "13px 26px",
              borderRadius: 999,
              background: "var(--accent)",
              color: "var(--accent-contrast, #fff)",
              fontWeight: 700,
              fontSize: 15,
              textDecoration: "none",
            }}
          >
            {t("auth_confirmed_cta")}
          </Link>
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
