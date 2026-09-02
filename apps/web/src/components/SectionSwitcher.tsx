"use client";

import Link from "next/link";
import { useI18n } from "./I18nProvider";

/**
 * Seletor de seções do Moka — A FAMÍLIA COMPLETA (obra MOKA).
 *
 * 📖 Reader (livros) · 🎬 Vídeo · 🧠 Memória · 💬 Harness · ✍️ Writer
 *
 * Ordem do Miguel (30/08 ~15h): "ícones grandes" de reader, vídeo, memória,
 * harness e writer. TÍTULOS/LABELS 100% i18n (ordem ~16h: nada hardcode).
 */
export type SectionKey = "reader" | "video" | "memoria" | "harness" | "writer";

const SECTIONS: Array<{ key: SectionKey; href: string; icon: string; titleKey: "sec_reader" | "sec_video" | "sec_memoria" | "sec_harness" | "sec_writer" }> = [
  { key: "reader", href: "/estante", icon: "📖", titleKey: "sec_reader" },
  { key: "video", href: "/video", icon: "🎬", titleKey: "sec_video" },
  { key: "memoria", href: "/memoria", icon: "🧠", titleKey: "sec_memoria" },
  { key: "harness", href: "/harness", icon: "💬", titleKey: "sec_harness" },
  { key: "writer", href: "/writer", icon: "✍️", titleKey: "sec_writer" },
];

export function SectionSwitcher({ active }: { active?: SectionKey }) {
  const { t } = useI18n();
  return (
    <nav className="section-switch" aria-label={t("sec_nav")}>
      {SECTIONS.map((s) => (
        <Link
          key={s.key}
          href={s.href}
          className={`section-switch-btn ${active === s.key ? "active" : ""}`}
          title={t(s.titleKey)}
          aria-label={t(s.titleKey)}
          aria-current={active === s.key ? "page" : undefined}
        >
          {s.icon}
        </Link>
      ))}
    </nav>
  );
}
