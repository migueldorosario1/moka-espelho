"use client";

import { useState } from "react";
import { TopNav, TopNavActions } from "@/components/TopNav";
import { LangSwitcher } from "@/components/LangSwitcher";
import { AuthGate } from "@/components/AuthGate";
import { BackButton } from "@/components/BackButton";
import { useI18n } from "@/components/I18nProvider";
import { BIBLIOTECA_LIVRE, type LivroLivre } from "@/lib/biblioteca-livre";
import { parseBook } from "@igot/parser";
import { saveToLibrary } from "@/lib/repository";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";

/**
 * /biblioteca — a Livraria Livre do Moka (doc 18): livros grátis de domínio
 * público real e garantido, com capa e sinopse nossas. O internauta escolhe
 * o que baixar pra SUA estante (opt-in total — e pode remover tudo depois).
 */
export default function Biblioteca() {
  const { t, lang } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [baixando, setBaixando] = useState<string | null>(null);
  const [naEstante, setNaEstante] = useState<Record<string, boolean>>({});
  const [erro, setErro] = useState<string>("");

  async function adicionar(livro: LivroLivre) {
    setErro("");
    setBaixando(livro.id);
    try {
      const r = await fetch(livro.arquivo);
      if (!r.ok) throw new Error("download falhou");
      const data = await r.arrayBuffer();
      const nome = livro.arquivo.split("/").pop() ?? `${livro.id}.epub`;
      const result = await parseBook({ data: data.slice(0), fileName: nome });
      if (!result.ok || !result.book) {
        throw new Error("error" in result ? String(result.error) : "não consegui ler o arquivo");
      }
      const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await saveToLibrary({
        id,
        fileName: nome,
        fileSize: data.byteLength,
        book: result.book,
        coverImage: livro.capa,
        pdfSource: null,
        chapterIdx: 0,
        zoom: 1,
        savedAt: Date.now(),
        translations: {},
        notes: [],
      }, auth.userId);
      setNaEstante((p) => ({ ...p, [livro.id]: true }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setBaixando(null);
    }
  }

  return (
    <main className="bib">
      <TopNav right={<TopNavActions />} />

      <div className="bib-body">
        <p className="bib-kicker">{t("bib_kicker")}</p>
        <h1 className="bib-title">{t("bib_title")}</h1>
        <p className="bib-sub">{t("bib_sub")}</p>

        {/* Chamada legal tranquilizadora (pedido do Miguel, 29/07) */}
        <p className="bib-legal">{t("bib_legal")}</p>

        {erro && <p className="bib-erro">⚠️ {erro}</p>}

        <div className="bib-grid">
          {BIBLIOTECA_LIVRE.map((livro) => (
            <article key={livro.id} className="bib-card">
              <div className="bib-capa">
                {/* Capa com moldura de proporção fixa (2:3) — a página NÃO
                    pula enquanto a imagem carrega (o "flash desconfigurado"
                    que o Miguel viu). O 📖 fica de fundo se a capa falhar. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={livro.capa} alt={`Capa de ${livro.titulo}`} loading="lazy" />
              </div>
              <div className="bib-info">
                <h2>
                  {livro.bandeira} {livro.titulo}
                  {livro.demoTraducao && <span className="bib-demo" title="Ótimo pra treinar a tradução"> 🌐</span>}
                </h2>
                <p className="bib-autor">{livro.autor}</p>
                <p className="bib-sinopse">{livro.sinopses[lang === "pt-BR" ? "pt" : "en"]}</p>
                <div className="bib-acoes">
                  {naEstante[livro.id] ? (
                    <>
                      <span className="bib-ok">{t("bib_in_shelf")}</span>
                      <button className="bib-btn bib-btn-abrir" onClick={() => router.push("/estante")}>
                        {t("bib_open_shelf")}
                      </button>
                    </>
                  ) : (
                    <button
                      className="bib-btn"
                      onClick={() => void adicionar(livro)}
                      disabled={baixando === livro.id}
                    >
                      {baixando === livro.id ? t("bib_btn_downloading") : t("bib_btn_add")}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="bib-nota">{t("bib_nota")}</p>
      </div>
    </main>
  );
}

/* Os estilos .bib-* moram em globals.css — NÃO em styled-jsx: na navegação
   client-side, o styled-jsx injeta DEPOIS do primeiro paint e a página
   aparecia SEM ESTILO por um átimo (o "flash desconfigurado" que o Miguel
   viu duas vezes). No CSS global o estilo chega junto com a página. */
