"use client";

/**
 * TopNav — o MENU PADRONIZADO da família Moka (obra, ordem do Miguel
 * 30/08 ~17h: "menus grandes no alto, padronizados, TODAS as páginas do
 * mesmo tamanho, e sempre com o OLHINHO pra deixar o menu invisível —
 * no celular o menu tem que ser bem grande").
 *
 * - Mesma barra em todas as páginas: marca + 5 ícones GRANDES + olhinho
 *   + bandeira + engrenagem (slot `right` pra extras da página).
 * - 👁 esconde o menu inteiro (modo leitura limpa — só o olhinho fica,
 *   pra trazer de volta). Preferência salva no aparelho.
 * - Mobile: ícones ainda maiores.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CafezinhoLogo } from "./CafezinhoLogo";
import { LangSwitcher } from "./LangSwitcher";
import { SectionSwitcher, type SectionKey } from "./SectionSwitcher";
import { useI18n } from "./I18nProvider";
import { BackButton } from "./BackButton";
import { AuthGate } from "./AuthGate";
import { TelemetryIconButton } from "./TelemetryIconButton";

const HIDDEN_KEY = "moka.navHidden";

/**
 * TopNavActions — o CONJUNTO PADRÃO de ações da barra (ordem do Miguel,
 * 31/08: "os menus lá de cima têm todos iguais, padronizados, em todas
 * as páginas"). Toda página interna usa o mesmo bloco: voltar, conta,
 * idioma, engrenagem e telemetria. A capa mantém o dela (sobre/ajuda).
 */
export function TopNavActions({
  back = true,
  gearUnset = false,
}: {
  /** Mostra o botão de voltar (padrão: sim). */
  back?: boolean;
  /** Engrenagem com o pontinho "IA não configurada". */
  gearUnset?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <>
      {back && <BackButton />}
      <AuthGate />
      <LangSwitcher />
      <button
        className={`gear ${gearUnset ? "unset" : ""}`}
        onClick={() => router.push("/configuracoes")}
        aria-label={t("settings")}
        title={t("settings")}
      >
        ⚙️
      </button>
      <TelemetryIconButton />
    </>
  );
}

export function TopNav({
  active,
  right,
}: {
  /** Seção ativa (a capa não marca nenhuma). */
  active?: SectionKey;
  /** Extras da página (engrenagem c/ estado, telemetria etc.). */
  right?: ReactNode;
}) {
  const router = useRouter();
  const { t } = useI18n();
  // Reforma 31/08 (ordem do Miguel): menu CLEAN por padrão — nasce ESCONDIDO;
  // o olhinho 👁 agora ABRE o menu (era o contrário). Quem já escolheu
  // mostrar/esconder antes, mantém a própria preferência salva no aparelho.
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HIDDEN_KEY);
      setHidden(saved === null ? true : saved === "1");
    } catch { /* sem storage */ }
  }, []);

  const toggle = useCallback(() => {
    setHidden((h) => {
      const next = !h;
      try {
        localStorage.setItem(HIDDEN_KEY, next ? "1" : "0");
      } catch { /* sem storage */ }
      return next;
    });
  }, []);

  if (hidden) {
    return (
      <div className="topnav topnav-hidden" role="navigation" aria-label={t("sec_nav")}>
        <button
          className="topnav-eye"
          onClick={toggle}
          title={t("nav_show")}
          aria-label={t("nav_show")}
          aria-expanded={false}
        >
          👁️
        </button>
      </div>
    );
  }

  return (
    <div className="topnav" role="navigation" aria-label={t("sec_nav")}>
      <div className="igot-topbar-left">
        <Link href="/" className="brand" title="Moka">
          <CafezinhoLogo size={26} opacity={0.85} /> <span>Moka</span>
        </Link>
        <SectionSwitcher active={active} />
      </div>
      <div className="igot-topbar-actions">
        <button
          className="topnav-eye"
          onClick={toggle}
          title={t("nav_hide")}
          aria-label={t("nav_hide")}
          aria-expanded
        >
          👁️
        </button>
        {right ?? (
          <>
            <LangSwitcher />
            <button
              className="gear"
              onClick={() => router.push("/configuracoes")}
              aria-label={t("settings")}
              title={t("settings")}
            >
              ⚙️
            </button>
          </>
        )}
      </div>
    </div>
  );
}
