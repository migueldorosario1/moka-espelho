"use client";
import { TopNav, TopNavActions } from "@/components/TopNav";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CafezinhoLogo } from "@/components/CafezinhoLogo";
import { LangSwitcher } from "@/components/LangSwitcher";
import { AuthGate } from "@/components/AuthGate";
import { SiteFooter } from "@/components/SiteFooter";
import { SettingsForm } from "@/components/SettingsForm";
import { CloudSettings } from "@/components/CloudSettings";
import { A11yControls } from "@/components/A11yControls";
import { useI18n } from "@/components/I18nProvider";
import type { AIConfig } from "@igot/ai-providers";
import {
  getConfigSync,
  loadConfigCache,
  invalidateConfigCache,
  hasConfig,
} from "@/lib/config";

/**
 * /configuracoes — a "casa" das chaves de IA do usuário (pedido do Miguel,
 * 2026-08-09). Antes era um pop-up (SettingsModal) que vivia dentro de cada
 * página — confuso e com bug de "menu some ao fechar". Agora é uma PÁGINA
 * própria, larga e respirável, onde o usuário:
 *   - vê TODAS as suas chaves cadastradas (lista, com ativar/testar/editar/remover);
 *   - adiciona quantas quiser (de provedores diferentes) e escolhe qual está em uso;
 *   - confere o ranking de preço e qualidade das IAs (componente LlmPriceRanking);
 *   - configura idioma da interface, tradução e fala.
 *
 * Reusa o <SettingsForm> (que já tem tudo: campo de chave, olhinho 👁, botão
 * Atualizar, lista de entries, seção de vídeo/Whisper). O ganho é o PALCO:
 * página larga (não 560px de modal) + ranking integrado + sem pop-up.
 */
export default function ConfiguracoesPage() {
  const { t } = useI18n();
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);

  // Lê a config FRESCA no boot da página (descriptografa o cofre).
  const router = useRouter();

  useEffect(() => {
    invalidateConfigCache();
    loadConfigCache().then(() => {
      setConfig(getConfigSync());
      setConfigReady(hasConfig());
    });
  }, []);

  // Quando salva uma chave, recarrega o cache e o estado "pronto".
  const handleSaved = () => {
    invalidateConfigCache();
    loadConfigCache().then(() => {
      setConfig(getConfigSync());
      setConfigReady(hasConfig());
    });
  };

  return (
    <main className="cfg-page">
      {/* TopBar PADRÃO da casa (reforma 31/08: era logo dos dois lados e
          menu diferente — agora igual a TODAS as outras páginas). */}
      <TopNav right={<TopNavActions />} />

      {/* Corpo largo e respirável — rola naturalmente com a página. */}
      <div className="cfg-container">
        <header className="cfg-header">
          <h1 className="cfg-title">⚙️ {t("cfg_page_title")}</h1>
          <p className="cfg-intro">{t("cfg_intro")}</p>
          {/* 🏆 Mural das IAs — página própria (pedido do Miguel, 24/08). */}
          <Link href="/mural-das-ias" className="tele-btn" style={{ display: "inline-block", marginTop: 10 }}>
            🏆 {t("mural_link")} →
          </Link>
        </header>

        {/* ♿ Acessibilidade — tema (claro/escuro/contraste/sépia) + tamanho
            de fonte da interface. Pedido do Miguel 09/08. */}
        <A11yControls />

        <section className="cfg-section">
          <h2 className="cfg-section-title">{t("cfg_keys_section")}</h2>
          <SettingsForm initial={config} onSaved={handleSaved} />
        </section>

        {/* ☁️ Memória na nuvem (ordem do Miguel, 31/08): o "espaçozinho" pro
            token do Cloudflare R2 / Backblaze B2 — backup da memória do usuário. */}
        <section className="cfg-section">
          <h2 className="cfg-section-title">☁️ {t("cloud_title")}</h2>
          <CloudSettings />
        </section>
      </div>

      <SiteFooter />

      {/* CSS migrado para globals.css */}
    </main>
  );
}
