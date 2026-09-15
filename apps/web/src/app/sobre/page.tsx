import { Metadata } from "next";
import { LangSwitcher } from "@/components/LangSwitcher";
import { AuthGate } from "@/components/AuthGate";
import { SiteFooter } from "@/components/SiteFooter";
import { TopNav, TopNavActions } from "@/components/TopNav";

export const metadata: Metadata = {
  title: "Quem Somos — Moka",
  description: "Conheça o Moka e o Cafezinho Media Group.",
  alternates: { canonical: "/sobre" },
};

/**
 * Página /sobre — Quem Somos.
 *
 * Apresenta o Moka, o criador (Miguel do Rosário) e o Cafezinho Media Group.
 * Linkada na capa (Uploader) e nas Configurações.
 */
export default function SobrePage() {
  return (
    <main className="info-page">
      {/* TopNav padrão (ordem do Miguel 15/09: menu no alto em TODAS as páginas
          — o "← Moka" antigo virou o 🏠 padrão). */}
      <TopNav right={<TopNavActions />} />
      <article className="info-card">

        <h1>Quem Somos</h1>

        <h2>Moka — dois em um 📖🎬</h2>
        <p>
          O <strong>Moka</strong> é um aplicativo <strong>dois em um</strong>:
          o <strong>Moka Reader</strong> 📖 lê livros e documentos (PDF e EPUB)
          e o <strong>Moka Video</strong> 🎬 assiste vídeos por você (YouTube,
          X/Twitter, Instagram) — transcrevendo, identificando personagens,
          dando o contexto político, fazendo a crítica e resumindo de 1 a 10
          minutos de leitura. Tudo com inteligência artificial, em qualquer
          idioma, sem sair da página.
        </p>
        <p>
          O Moka permite que o usuário converse com o texto: peça explicações,
          traduções, contextualizações e aprofundamentos. O leitor pode até
          ouvir o texto em voz alta e fazer perguntas falando, com reconhecimento
          de voz nativo.
        </p>
        <p>
          Toda a inteligência artificial fica no seu controle: você escolhe o
          provedor de IA que prefere usar, e a chave de acesso fica guardada e
          criptografada no seu próprio aparelho — nunca no servidor do Moka.
          Assim, a privacidade das suas leituras é total e o custo depende só
          do que você consome.
        </p>

        <h2>Criador</h2>
        <p>
          Criado e desenvolvido pelo jornalista <strong>Miguel do Rosário</strong>.
        </p>
        <p>
          Miguel do Rosário é jornalista, nascido no Rio de Janeiro e hoje mora
          em Niterói (RJ). É editor do portal <strong>Cafezinho</strong>,
          âncora do <strong>Jornal da Fórum</strong> e do programa de YouTube
          <strong> TV Fórum</strong>.
        </p>
        <ul className="info-links">
          <li><a href="https://cafezinho.com" target="_blank" rel="noreferrer">Cafezinho.com ↗</a></li>
          <li><a href="https://www.youtube.com/@TVForum" target="_blank" rel="noreferrer">TV Fórum no YouTube ↗</a></li>
        </ul>

        <h2>Cafezinho Media Group</h2>
        <p>
          O Moka é um produto do <strong>Cafezinho Media Group</strong>, empresa
          de conteúdo e tecnologia que opera diversos sites e produtos digitais.
          O Cafezinho Media Group tem como missão democratizar o acesso à
          informação e ao conhecimento.
        </p>
        <p>
          <strong>Fundador:</strong> Miguel do Rosário<br />
          <strong>Contato:</strong>{" "}
          <a href="mailto:migueldorosario@ocafezinho.com">migueldorosario@ocafezinho.com</a><br />
          <strong>Sede:</strong> Niterói, RJ — Brasil
        </p>

        <h2>Missão</h2>
        <p>
          Criar o melhor ambiente do mundo para ler, compreender e conversar com
          qualquer texto. Não queremos construir apenas um leitor de livros —
          queremos construir o companheiro de leitura que sempre imaginamos
          existir.
        </p>

        <p className="info-footer">
          <a href="/privacidade">Política de Privacidade →</a>
        </p>
      </article>

      <style>{`
        .info-page {
          min-height: 100vh;
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-sans);
          padding: 40px 20px;
        }
        .info-card {
          max-width: 680px;
          margin: 0 auto;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 40px 48px;
          box-shadow: var(--shadow);
        }
        .info-topbar {
          max-width: 680px;
          margin: 0 auto 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .info-back {
          display: inline-block;
          color: var(--accent);
          text-decoration: none;
          font-size: 14px;
        }
        .info-card h1 { font-family: var(--font-brand); font-weight: 600;
          font-size: 28px;
          font-weight: 700;
          margin: 0 0 24px;
          color: var(--accent);
        }
        .info-card h2 {
          font-size: 20px;
          font-weight: 600;
          margin: 28px 0 12px;
          color: var(--text);
        }
        .info-card p {
          font-size: 15px;
          line-height: 1.8;
          color: var(--text);
          margin: 0 0 16px;
        }
        .info-card strong {
          font-weight: 600;
        }
        .info-links {
          list-style: none;
          padding: 0;
          margin: 16px 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .info-links a {
          color: var(--accent);
          text-decoration: none;
          font-size: 14px;
        }
        .info-links a:hover {
          text-decoration: underline;
        }
        .info-footer {
          margin-top: 32px;
          padding-top: 20px;
          border-top: 1px solid var(--border);
        }
        .info-footer a {
          color: var(--accent);
          text-decoration: none;
        }
        @media (max-width: 600px) {
          .info-card {
            padding: 24px 20px;
          }
        }
      `}</style>
          <SiteFooter />
    </main>
  );
}
