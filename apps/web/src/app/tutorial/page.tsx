"use client";

import Link from "next/link";
import { CafezinhoLogo } from "@/components/CafezinhoLogo";
import { LangSwitcher } from "@/components/LangSwitcher";
import { AuthGate } from "@/components/AuthGate";
import { SiteFooter } from "@/components/SiteFooter";
import { ZeMocaAvatar } from "@/components/ZeMocaAvatar";
import { useI18n } from "@/components/I18nProvider";

/** Links diretos pra pegar a chave (neutros de idioma). */
const PROVIDERS: { nome: string; url: string; nota: string }[] = [
  { nome: "DeepSeek", url: "https://platform.deepseek.com/", nota: "a mais usada no Moka ☕" },
  { nome: "Z.ai (GLM)", url: "https://open.bigmodel.cn/", nota: "a mais barata de todas" },
  { nome: "OpenAI", url: "https://platform.openai.com/api-keys", nota: "também transcreve vídeo (Whisper)" },
  { nome: "Qwen (Alibaba)", url: "https://bailian.console.aliyun.com/", nota: "" },
  { nome: "Kimi (Moonshot)", url: "https://platform.moonshot.ai/", nota: "pesquisa profunda" },
  { nome: "Anthropic (Claude)", url: "https://console.anthropic.com/", nota: "premium literário" },
  { nome: "Google Gemini", url: "https://aistudio.google.com/apikey", nota: "tem nível grátis" },
  { nome: "Groq", url: "https://console.groq.com/keys", nota: "o mais rápido do mundo" },
];

/**
 * /tutorial — o tutorial completo do usuário BYOK (pedido do Miguel, 05/08):
 * passo a passo + a matemática do "quanto vai custar" (tokens → preço),
 * com links diretos pra cada provedor. Nos 12 idiomas.
 */
export default function Tutorial() {
  const { t } = useI18n();

  const steps = [
    { n: "1", title: t("tut_s1_t"), desc: t("tut_s1_d"), link: { href: "/ajuda", label: `${t("tut_ranking_link")} →` } },
    { n: "2", title: t("tut_s2_t"), desc: t("tut_s2_d"), providers: true },
    { n: "3", title: t("tut_s3_t"), desc: t("tut_s3_d") },
    { n: "4", title: t("tut_s4_t"), desc: t("tut_s4_d1"), extra: [t("tut_s4_d2"), t("tut_s4_d3")] },
    { n: "5", title: t("tut_s5_t"), desc: t("tut_s5_d") },
    { n: "6", title: t("tut_s6_t"), desc: t("tut_s6_d"), extra: [t("tut_s6_d2")] },
  ];

  return (
    <main className="help">
      <div className="igot-topbar help-topbar">
        <div className="igot-topbar-left">
          <Link href="/" className="brand" title="MOKA — Ir para página central">
            <CafezinhoLogo size={26} opacity={0.85} />
            <span>MOKA</span>
          </Link>
        </div>
        <div className="igot-topbar-actions">
          <AuthGate />
          <LangSwitcher />
        </div>
      </div>

      <div className="help-body">
        {/* 🤖 Zé Moca no topo — o roceiro que te ensina (pedido do Miguel). */}
        <section className="ze-moca-banner">
          <div className="ze-moca-avatar"><ZeMocaAvatar size={72} /></div>
          <div className="ze-moca-text">
            <h2 className="ze-moca-name">Zé Moca</h2>
            <p className="ze-moca-intro">
              {t("ze_moca_intro") || "Oi, eu sou o Zé Moca! Vou te ensinar tudo, passo a passo. Em 5 minutos você tá lendo com IA."}
            </p>
          </div>
        </section>

        <p className="help-kicker">{t("tut_title")}</p>
        <h1 className="help-title">{t("tut_intro")}</h1>

        {/* 🔑 "O que é API?" — pedido do Miguel (05/08): o tutorial tem que
            abrir explicando o que é a API, antes de qualquer passo */}
        <div className="tut-api-card">
          <h2>{t("tut_api_t")}</h2>
          <p>{t("tut_api_d")}</p>
        </div>

        <div className="tut-steps">
          {steps.map((s) => (
            <section key={s.n} className="tut-step">
              <div className="tut-num">{s.n}</div>
              <div className="tut-content">
                <h2>{s.title}</h2>
                <p>{s.desc}</p>
                {s.extra?.map((x, i) => <p key={i}>{x}</p>)}
                {s.link && (
                  <p>
                    <Link href={s.link.href} className="tut-link">{s.link.label}</Link>
                  </p>
                )}
                {s.providers && (
                  <ul className="tut-providers">
                    {PROVIDERS.map((p) => (
                      <li key={p.nome}>
                        <a href={p.url} target="_blank" rel="noreferrer">{p.nome} →</a>
                        {p.nota && <span> · {p.nota}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>

        <div className="tut-video-note">
          <p>{t("tut_video")}</p>
        </div>

        <p style={{ textAlign: "center", marginTop: 22 }}>
          <Link href="/estante" className="tut-link" style={{ fontSize: 16 }}>
            {t("tut_cta")}
          </Link>
        </p>
      </div>{/* fim help-body */}

      <SiteFooter />

      {/* CSS migrado para globals.css — cura FOUC (era <style jsx>) */}
    </main>
  );
}
