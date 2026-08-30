"use client";

import Link from "next/link";

/**
 * Seletor de seções do Moka unificado (V 2.0 — fusão Reader + Video).
 *
 * Fica no topo, ao lado da marca: 📖 livros · 🎬 vídeos.
 * Um app só, como pediu o Miguel: "íconezinho de vídeo e íconezinho de livro".
 */
export function SectionSwitcher({ active }: { active: "reader" | "video" }) {
  return (
    <nav className="section-switch" aria-label="Seções do Moka">
      <Link
        href="/estante"
        className={`section-switch-btn ${active === "reader" ? "active" : ""}`}
        title="Moka Reader — seus livros"
        aria-label="Livros"
        aria-current={active === "reader" ? "page" : undefined}
      >
        📖
      </Link>
      <Link
        href="/video"
        className={`section-switch-btn ${active === "video" ? "active" : ""}`}
        title="Moka Video — leia vídeos"
        aria-label="Vídeos"
        aria-current={active === "video" ? "page" : undefined}
      >
        🎬
      </Link>
    </nav>
  );
}
