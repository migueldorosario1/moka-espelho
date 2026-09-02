"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopNav, TopNavActions } from "@/components/TopNav";
import { ZeMocaAvatar } from "@/components/ZeMocaAvatar";
import { LangSwitcher } from "@/components/LangSwitcher";
import { AuthGate } from "@/components/AuthGate";
import { SiteFooter } from "@/components/SiteFooter";
// (Mural das IAs mudou pra página própria /mural-das-ias — Miguel, 24/08.)
import { TelemetryIconButton } from "@/components/TelemetryIconButton";
import { useI18n } from "@/components/I18nProvider";

/**
 * /ajuda — HELP do V3 (doc 15): página bem explicativa para quem nunca
 * viu "API", com busca e robô de dúvidas (responde do FAQ por palavras-chave;
 * funciona offline, sem gastar IA). Substitui o tutorial antigo (backup local).
 */


/** Os ícones do leitor explicados (Miguel, 26/08). */
const ICONES_HELP: Array<{ icon: string; nome: { pt: string; en: string }; desc: { pt: string; en: string } }> = [
  { icon: "🌐", nome: { pt: "Traduzir página inteira", en: "Translate whole page" }, desc: { pt: "Traduz a página que está na tela (confirma antes).", en: "Translates the page on screen (asks first)." } },
  { icon: "🧠", nome: { pt: "Explicar página inteira", en: "Explain whole page" }, desc: { pt: "A IA explica o que a página quer dizer, no seu idioma.", en: "The AI explains what the page means, in your language." } },
  { icon: "🌍", nome: { pt: "Traduzir o livro inteiro", en: "Translate the whole book" }, desc: { pt: "O livro todo em volumes (mostra estimativa antes).", en: "The whole book in volumes (shows an estimate first)." } },
  { icon: "🔊", nome: { pt: "Ler em voz alta", en: "Read aloud" }, desc: { pt: "O Moka lê a página em voz (neural ou mecânica).", en: "Moka reads the page aloud (neural or robotic voice)." } },
  { icon: "📝", nome: { pt: "Resumo da página/livro", en: "Page/book summary" }, desc: { pt: "Resumo do que está na tela, em minutos.", en: "Summary of what's on screen, in minutes." } },
  { icon: "💬", nome: { pt: "Perguntar sobre o texto", en: "Ask about the text" }, desc: { pt: "Faça perguntas sobre a página — a IA responde.", en: "Ask questions about the page — the AI answers." } },
  { icon: "🔖", nome: { pt: "Marcar página", en: "Bookmark page" }, desc: { pt: "Salva a página pra achar depois (nos Marcadores).", en: "Saves the page to find later (in Bookmarks)." } },
  { icon: "📊", nome: { pt: "Suas IAs / Mural das IAs", en: "Your AIs / AI Wall" }, desc: { pt: "Gastos (telemetria) e ranking das IAs pra escolher.", en: "Spending (telemetry) and AI ranking to choose." } },
  { icon: "⚙️", nome: { pt: "Configurações", en: "Settings" }, desc: { pt: "Chaves de IA, idiomas, voz, vídeo, avisos.", en: "AI keys, languages, voice, video, notices." } },
  { icon: "📚", nome: { pt: "Estante", en: "Bookshelf" }, desc: { pt: "Sua biblioteca (livros, capas, progresso).", en: "Your library (books, covers, progress)." } },
  { icon: "👁", nome: { pt: "Mostrar/esconder menu", en: "Show/hide menu" }, desc: { pt: "Destrava o menu se sumir (clique traz de volta).", en: "Brings the menu back if it hides (click to recover)." } },
  { icon: "⛶", nome: { pt: "Tela cheia", en: "Fullscreen" }, desc: { pt: "Leitura imersiva, só a página na tela.", en: "Immersive reading, only the page on screen." } },
  // ── Família MOKA (obra, 30/08): novidades explicadas ──
  { icon: "🧠", nome: { pt: "Moka Memória", en: "Moka Memory" }, desc: { pt: "Tudo que você leu e viu vira memória organizada e pesquisável: 🎒 bagagem (seu consumo) e ⚡ operacional (contexto da IA). Importe .md, jogue livros da estante, exporte num arquivo portátil.", en: "Everything you read and watch becomes an organized, searchable memory: 🎒 baggage and ⚡ operational. Import .md, add books, export a portable file." } },
  { icon: "💬", nome: { pt: "Moka Harness — a IA do Moka", en: "Moka Harness — the Moka AI" }, desc: { pt: "Converse com a SUA memória usando a SUA chave de IA. No chat você escolhe usar 🎒 bagagem e/ou ⚡ operacional — cada uma mostra o custo estimado por pergunta.", en: "Chat with YOUR memory using YOUR AI key. Pick 🎒 baggage and/or ⚡ operational — each shows the estimated cost per question." } },
  { icon: "✍️", nome: { pt: "Moka Writer", en: "Moka Writer" }, desc: { pt: "Seu estúdio de escrever: aba Estúdio (a IA escreve e corrige no SEU estilo salvo; texto grande mostra orçamento antes) e aba Ler. Baixe .md e jogue na memória.", en: "Your writing studio: Studio tab (AI writes and fixes in YOUR style; big texts get an estimate first) and Read tab. Download .md, add to memory." } },
  { icon: "🧮", nome: { pt: "Orçamento antes de tarefas grandes", en: "Estimate before big tasks" }, desc: { pt: "Traduzir livro inteiro ou corrigir texto longo mostra antes: qual IA, quantos tokens, tempo e custo na SUA moeda. Você confirma — e no fim vê o custo REAL.", en: "Whole-book translation or long fixes show first: which AI, tokens, time and cost in YOUR currency. You confirm — and see the REAL cost at the end." } },
];

interface Faq { q: string; a: string; tags: string[] }

const FAQ_PT: Faq[] = [
  { q: "O Moka tem paywall ou cobrança?", tags: ["paywall", "cobrança", "pagar", "assinatura", "grátis", "gratuito", "cadastro", "conta", "login"],
    a: "Não. O Moka Reader é 100% gratuito: sem paywall, sem assinatura e sem compra dentro do app. E sem cadastro obrigatório — você abre o site e usa tudo na hora, sem nem criar conta (a conta é opcional e serve só pra sincronizar sua biblioteca entre aparelhos). A única coisa que vem de fora é a chave de IA: você conecta a sua, do provedor que quiser, e paga o provedor diretamente pelo que usar — o Moka nunca cobra nada." },
  { q: "O que é o Moka?", tags: ["moka", "que", "é", "app", "aplicativo"],
    a: "O Moka é um leitor com inteligência artificial: ele resume vídeos do YouTube e livros (EPUB/PDF) em minutos, traduz, explica, identifica personagens e responde perguntas sobre o conteúdo — no seu idioma. E é GRATUITO." },
  { q: "O Moka é grátis mesmo?", tags: ["grátis", "gratuito", "preço", "custa", "valor", "quanto", "pontos", "ponto", "créditos", "saldo"],
    a: "Sim — o Moka é grátis de verdade: você não compra nada aqui. A IA roda com a SUA chave de API (a chave da sua inteligência artificial), e você paga o provedor diretamente pelo que usar — centavos por livro/vídeo. Se quiser apoiar o projeto, tem o botão de doação no rodapé. ☕" },
  { q: "Quanto vou gastar com a minha própria API?", tags: ["gasto", "custo", "api", "provedor", "estimativa", "400", "paginas", "páginas"],
    a: "Pouco: com a IA mais econômica (DeepSeek V4 Flash), resumir um livro de 400 páginas custa centavos. Com modelos premium (Claude Opus, GPT-5), sobe pra centavos/reais por livro. Veja o Ranking de Preços das IAs aqui embaixo — dá pra comparar e escolher." },
  { q: "Como consigo uma chave de API?", tags: ["comprar", "compra", "chave", "api", "conseguir", "key", "onde"],
    a: "Em 1 minuto, no site do provedor que você escolher (DeepSeek, OpenAI, Z.ai, Qwen, Kimi, Anthropic, Gemini...): crie a conta, gere a chave e cole nas ⚙️ Configurações do Moka. Ela fica salva só no seu dispositivo, criptografada — nunca passa pelos nossos servidores." },
  { q: "Vídeo usa a mesma chave?", tags: ["vídeo", "video", "youtube", "transcrever", "legenda", "whisper", "áudio"],
    a: "Cuidado: vídeo é OUTRO sistema. Vídeo COM legenda é grátis e não gasta nada. Vídeo SEM legenda precisa de API de transcrição de ÁUDIO (ex.: OpenAI/Whisper) — nem toda API de texto serve pra isso. Preço: ~US$ 0,04–0,36 por hora de vídeo, conforme o serviço." },
  { q: "O que é uma chave de API?", tags: ["api", "o que é", "senha", "funciona"],
    a: "É como uma senha que liga o Moka à inteligência artificial que você escolheu (DeepSeek, OpenAI…). Você cria a sua de graça no site do provedor e adiciona crédito lá mesmo (cartão) — o Moka não vende crédito. O passo a passo completo está no /tutorial." },
  { q: "Qual IA devo escolher?", tags: ["ia", "llm", "modelo", "deepseek", "openai", "groq", "claude", "gemini", "escolher", "melhor"],
    a: "Pra começar: a mais econômica que resolve muito bem é a DeepSeek V4 Flash (centavos por livro). Se quiser o máximo de qualidade literária, Claude e GPT-5 são os premium — e custam mais. O Ranking de Preços aqui embaixo compara todos os modelos que o Moka aceita." },
  { q: "Minha chave fica segura?", tags: ["dados", "privacidade", "segurança", "seguro", "chave", "servidor"],
    a: "Sim. Sua chave fica só no seu dispositivo (criptografada no navegador) — nunca vai pra nossos servidores. Seus livros e vídeos também ficam no seu aparelho; se você entrar com Google/e-mail, a biblioteca synca na nuvem pra abrir em qualquer aparelho." },
  { q: "O Moka funciona em outros idiomas?", tags: ["idioma", "língua", "inglês", "espanhol", "tradução"],
    a: "Sim. A interface fala 12 idiomas (bandeirinha no topo), o Moka detecta automaticamente o idioma do vídeo ou livro e responde no SEU idioma. Um vídeo em inglês vira resumo em português sem você configurar nada." },
  { q: "Preciso instalar alguma coisa?", tags: ["instalar", "baixar", "download", "app"],
    a: "Não. O Moka funciona no navegador, no celular e no computador. Se quiser, dá pra instalar como aplicativo — é grátis." },
  { q: "Preciso criar conta?", tags: ["conta", "cadastro", "login", "google", "email", "senha", "registrar"],
    a: "Não. O Moka funciona sem cadastro: abra o site e use na hora, sem entrar com nada. A conta (Google ou e-mail) é opcional e gratuita — com ela, sua biblioteca (livros, anotações, traduções e progresso) fica guardada na nuvem e abre em qualquer aparelho." },
  { q: "Quem faz o Moka?", tags: ["quem", "cafezinho", "empresa", "time"],
    a: "O Moka é feito pelo time de O Cafezinho, com carinho de jornalista e precisão de engenharia. É gratuito — quem quiser apoiar, tem a doação no rodapé (PayPal e Pix)." },
  { q: "Como funciona o menu de dentro do livro?", tags: ["menu", "leitor", "botões", "grandes", "submenus", "página", "marcar", "perguntar"],
    a: "Ao abrir um livro você vê 3 BOTÕES GRANDES no alto da página. 📖 Página abre um submenu com: ler a página em voz alta, resumir/explicar e traduzir (a página ou o livro inteiro). 📌 Marcar abre: marcar página, tirar foto da página e suas notas. 🎤 Perguntar abre a caixinha pra perguntar qualquer coisa sobre o livro, por voz ou texto. À direita, o botão ☰ junta ajuda, suas IAs, mural e configurações." },
  { q: "O que é a Memória na nuvem (Cloudflare R2 / Backblaze B2)?", tags: ["memória", "nuvem", "cloud", "r2", "b2", "backblaze", "cloudflare", "backup", "bucket", "token"],
    a: "É o backup da sua memória E DA SUA ESTANTE no SEU próprio espaço de nuvem: você cria uma conta grátis no Cloudflare R2 ou Backblaze B2 (os planos gratuitos sobram pra isso), cola a credencial em ⚙️ Configurações → ☁️ Memória na nuvem e aponta Testar conexão. Suas chaves ficam criptografadas só no seu aparelho — o Moka não tem servidor no meio. Na página Memória, ☁️ Salvar na nuvem guarda o texto da memória; na Estante, ☁️ Salvar estante na nuvem guarda cada livro com o ARQUIVO ORIGINAL inteiro (PDF/EPUB de verdade — nunca texto convertido) — e Restaurar estante traz tudo de volta em qualquer aparelho, do jeito que estava." },
  { q: "Por que um PDF grande demora pra entrar na estante?", tags: ["pdf", "grande", "demora", "lento", "barra", "progresso", "capa", "renderizando"],
    a: "Livros PDF grandes (dezenenas de MB) levam um ou dois minutos pra subir: o Moka renderiza as primeiras páginas de verdade pra ENCONTRAR A CAPA certa do livro (não vale a primeira página de um scan). Durante tudo isso aparece uma barrinha de percentual contando a etapa — 'Abrindo o livro', 'Verificando as páginas', 'Renderizando pra achar a capa — página 3 de 11', 'Salvando na estante'. É normal, é só esperar a barrinha chegar ao fim." },
];

const FAQ_EN: Faq[] = [
  { q: "Does Moka have a paywall or any charge?", tags: ["paywall", "charge", "payment", "subscription", "free", "account", "login", "signup"],
    a: "No. Moka Reader is 100% free: no paywall, no subscription and no in-app purchase. And no mandatory sign-up — you open the site and use everything right away, without creating an account (an account is optional and only syncs your library across devices). The only thing that comes from outside is the AI key: you connect your own, from whichever provider you choose, and pay the provider directly for what you use — Moka never charges anything." },
  { q: "What is Moka?", tags: ["moka", "what", "is", "app"],
    a: "Moka is a reader with artificial intelligence: it summarizes YouTube videos and books (EPUB/PDF) in minutes, translates, explains, identifies characters and answers questions about the content — in your language. And it's FREE." },
  { q: "Is Moka really free?", tags: ["free", "price", "cost", "how much", "credits", "points"],
    a: "Yes — Moka is truly free: you don't buy anything here. The AI runs with YOUR API key (your AI's key), and you pay the provider directly for what you use — pennies per book/video. If you want to support the project, there's a donation button in the footer. ☕" },
  { q: "How much will I spend with my own API?", tags: ["spend", "cost", "api", "provider", "estimate", "400", "pages"],
    a: "Very little: with the cheapest AI (DeepSeek V4 Flash), summarizing a 400-page book costs pennies. With premium models (Claude Opus, GPT-5), it goes up to cents per book. See the AI Price Ranking below — you can compare and choose." },
  { q: "How do I get an API key?", tags: ["buy", "purchase", "key", "api", "get", "where"],
    a: "In 1 minute, on the provider's website you choose (DeepSeek, OpenAI, Z.ai, Qwen, Kimi, Anthropic, Gemini...): create an account, generate the key and paste it in Moka's ⚙️ Settings. It's stored only on your device, encrypted — never goes through our servers." },
  { q: "Does video use the same key?", tags: ["video", "youtube", "transcribe", "caption", "whisper", "audio"],
    a: "Careful: video is ANOTHER system. Video WITH captions is free and costs nothing. Video WITHOUT captions needs an audio transcription API (e.g.: OpenAI/Whisper) — not every text API works for this. Price: ~US$ 0.04–0.36 per hour of video, depending on the service." },
  { q: "What is an API key?", tags: ["api", "what is", "password", "works"],
    a: "It's like a password that connects Moka to the AI you chose (DeepSeek, OpenAI…). You create yours for free on the provider's website and add credit there (card) — Moka doesn't sell credit. The complete step-by-step is in /tutorial." },
  { q: "Which AI should I choose?", tags: ["ai", "llm", "model", "deepseek", "openai", "groq", "claude", "gemini", "choose", "best"],
    a: "To start: the most economical that works very well is DeepSeek V4 Flash (pennies per book). If you want maximum literary quality, Claude and GPT-5 are the premium ones — and cost more. The Price Ranking below compares all models Moka accepts." },
  { q: "Is my key safe?", tags: ["data", "privacy", "security", "safe", "key", "server"],
    a: "Yes. Your key stays only on your device (encrypted in the browser) — never goes to our servers. Your books and videos also stay on your device; if you sign in with Google/email, your library syncs to the cloud to open on any device." },
  { q: "Does Moka work in other languages?", tags: ["language", "english", "spanish", "translation"],
    a: "Yes. The interface speaks 12 languages (flag at the top), Moka automatically detects the language of the video or book and responds in YOUR language. An English video becomes a summary in Portuguese without you configuring anything." },
  { q: "Do I need to install anything?", tags: ["install", "download", "app"],
    a: "No. Moka works in the browser, on your phone and computer. If you want, you can install it as an app — it's free." },
  { q: "Do I need to create an account?", tags: ["account", "signup", "login", "google", "email", "password", "register"],
    a: "No. Moka works without any account: open the site and use it right away, without signing in. An account (Google or email) is optional and free — with it, your library (books, notes, translations and progress) is saved in the cloud and opens on any device." },
  { q: "Who makes Moka?", tags: ["who", "cafezinho", "company", "team"],
    a: "Moka is made by the O Cafezinho team, with a journalist's care and engineering precision. It's free — if you want to support it, there's a donation button in the footer (PayPal and Pix)." },
  { q: "How does the in-book menu work?", tags: ["menu", "reader", "buttons", "big", "submenu", "page", "mark", "ask"],
    a: "When you open a book you see 3 BIG BUTTONS at the top. 📖 Page opens a submenu: read the page aloud, summarize/explain, and translate (the page or the whole book). 📌 Mark opens: bookmark page, take a page photo and your notes. 🎤 Ask opens the box to ask anything about the book, by voice or text. On the right, the ☰ button gathers help, your AIs, the wall and settings." },
  { q: "What is Cloud memory (Cloudflare R2 / Backblaze B2)?", tags: ["memory", "cloud", "r2", "b2", "backblaze", "cloudflare", "backup", "bucket", "token"],
    a: "It's the backup of your memory AND your shelf in YOUR own cloud space: create a free account on Cloudflare R2 or Backblaze B2 (free tiers are more than enough), paste the credential in ⚙️ Settings → ☁️ Cloud memory and hit Test connection. Your keys stay encrypted on your device only — Moka has no server in between. On the Memory page, ☁️ Save to cloud stores the memory text; on the Shelf, ☁️ Save shelf to cloud stores every book WITH its ORIGINAL file (the actual PDF/EPUB — never converted text) — and Restore shelf brings it all back on any device, just as it was." },
  { q: "Why does a big PDF take a while to land on the shelf?", tags: ["pdf", "large", "slow", "progress", "bar", "cover", "rendering"],
    a: "Large PDFs (tens of MB) take a minute or two to upload: Moka actually renders the first pages to FIND the book's real cover (a scan's first page isn't always it). All along you see a percent bar telling the stage — 'Opening the book', 'Checking the pages', 'Rendering to find the cover — page 3 of 11', 'Saving to your shelf'. It's normal — just let the bar finish." },
];

/** Normaliza (minúsculas, sem acento) pra busca e pro robô. */
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Robô de dúvidas: pontua cada item do FAQ por palavras da pergunta. */
function responder(pergunta: string, faqList: Faq[]): string {
  const palavras = norm(pergunta).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let melhor: Faq | null = null;
  let melhorScore = 0;
  for (const item of faqList) {
    const alvo = norm(item.q + " " + item.tags.join(" "));
    let score = 0;
    for (const p of palavras) if (alvo.includes(p)) score += p.length > 5 ? 2 : 1;
    if (score > melhorScore) { melhorScore = score; melhor = item; }
  }
  if (!melhor || melhorScore < 2) {
    return lang_fallback_noanswer();
  }
  return melhor.a;
}

function lang_fallback_noanswer(): string {
  return "Hmm, not sure about that one. Try asking differently — or bring it to the community. Meanwhile, the topics below cover the essentials. 👇";
}

export default function Ajuda() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [resposta, setResposta] = useState("");

  // FAQ no idioma da interface (PT ou EN; outros idiomas usam EN como fallback).
  const FAQ = lang === "pt-BR" ? FAQ_PT : FAQ_EN;

  const filtrados = useMemo(() => {
    const q = norm(busca);
    if (!q) return FAQ;
    return FAQ.filter(
      (f) => norm(f.q).includes(q) || f.tags.some((tg) => norm(tg).includes(q)) || norm(f.a).includes(q),
    );
  }, [busca, FAQ]);

  return (
    <main className="help">
      <TopNav right={<TopNavActions />} />

      <div className="help-body">
        {/* 🤖 ZÉ MOCA — agente-guia em destaque, no topo da ajuda.
            Apresentação amigável + link pro futuro chat. (Pedido do Miguel,
            09/08: "entra ele com destaque, logo em cima".) */}
        <section className="ze-moca-banner">
          <div className="ze-moca-avatar"><ZeMocaAvatar size={72} /></div>
          <div className="ze-moca-text">
            <h2 className="ze-moca-name">Zé Moca</h2>
            <p className="ze-moca-intro">
              {t("ze_moca_intro") || "Oi, eu sou o Zé Moca! Sou o guia do Moka. Estou aqui pra te ajudar com qualquer dúvida — pode perguntar qualquer coisa que eu respondo. Te ensino a usar e a configurar."}
            </p>
            <Link href="/ajuda#robô" className="ze-moca-cta">
              💬 {t("ze_moca_ask") || "Conversar com o Zé Moca"}
            </Link>
          </div>
        </section>


        {/* 🧩 OS ÍCONES DO LEITOR (Miguel, 26/08: "logo no começo, bota a
            explicação dos ícones — repete o ícone grande + para que serve").
            pt-BR vê PT; demais idiomas vê EN. */}
        <section className="help-icons">
          <h2>🧩 {{pt: "Os ícones do leitor", en: "The reader icons"}[lang === "pt-BR" ? "pt" : "en"]}</h2>
          <div className="help-icons-grid">
            {ICONES_HELP.map((it) => (
              <div key={it.icon} className="help-icon-item">
                <span className="help-icon-big" aria-hidden>{it.icon}</span>
                <div>
                  <strong>{it.nome[lang === "pt-BR" ? "pt" : "en"]}</strong>
                  <p>{it.desc[lang === "pt-BR" ? "pt" : "en"]}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <p className="help-kicker">{t("help_center")}</p>
        <h1 className="help-title">{t("help_how_works")}</h1>

        {/* 🔎 Localizador — busca rápida no FAQ (filtra em tempo real).
            Ícone de lupa à esquerda dentro do campo (pedido do Miguel:
            "sem ícone de clicar pra buscar"). */}
        <div className="help-localizador">
          <span className="help-localizador-icon">🔎</span>
          <input
            className="help-busca"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("help_search_ph") || "🔎 Localizar uma dúvida... (ex.: custo, chave, vídeo)"}
          />
          {busca && (
            <button
              type="button"
              className="help-localizador-clear"
              onClick={() => setBusca("")}
              aria-label="Limpar"
            >
              ✕
            </button>
          )}
        </div>

        {/* FASE GRATUITA (pivô 2026-08-04): o essencial do BYOK em destaque,
            nos 12 idiomas (ui-strings) — antes de qualquer FAQ. */}
        <section className="help-robo" style={{ marginBottom: 18 }}>
          <h2>🆓 {t("free_title")}</h2>
          <p style={{ lineHeight: 1.6 }}>{t("free_desc")}</p>
          <p style={{ lineHeight: 1.6, marginTop: 8 }}>{t("byok_cost")}</p>
          <p style={{ lineHeight: 1.6, marginTop: 8 }}>{t("byok_video_note")}</p>
        </section>

        {/* 🎬 Serviço de transcrição próprio (ordem do Miguel 27/08: "bota
            isso também no help"). Corpo em PT (padrão da página) — o passo
            a passo de como pegar a chave de cada serviço. */}
        <section className="help-robo" id="video-transcricao" style={{ marginBottom: 18 }}>
          <h2>🎬 {t("tx_title")}</h2>
          <p style={{ lineHeight: 1.6 }}>{t("tx_intro")}</p>
          <p style={{ lineHeight: 1.6, marginTop: 8 }}>
            <b>Como funciona:</b> nas <Link href="/configuracoes">⚙️ Configurações</Link>,
            seção <b>🎬 Moka Vídeo</b>, você escolhe o serviço e cola a chave de API dele.
            A chave fica guardada só no seu navegador. Quando um vídeo não tem legenda,
            o Moka manda o link pro serviço — <b>quem baixa o vídeo é o serviço, com o
            IP dele</b> — e devolve o texto pronto, com timestamps.
          </p>
          <p style={{ lineHeight: 1.6, marginTop: 8 }}>
            <b>💡 Pode ativar mais de um (fallback em cascata):</b> marque quantos serviços
            quiser e organize a ordem com ▲ e ▼ — o Moka tenta o 1º; se ele falhar (chave
            inválida, sem créditos, fora do ar…), <b>cai pro 2º sozinho, e depois pro 3º</b>,
            avisando em tempo real na tela o que está acontecendo. Exemplo prático:
            Supadata em 1º (grátis) e TranscriptAPI em 2º — se o crédito do mês do
            Supadata acabar no meio, a transcrição continua funcionando pelo 2º sem
            você fazer nada.
          </p>
          <p style={{ lineHeight: 1.6, marginTop: 8 }}><b>Como eu pego minha chave?</b></p>
          <ul style={{ lineHeight: 1.7, marginTop: 4, paddingLeft: 20 }}>
            <li>
              <b>Supadata</b> (recomendado — 100 transcrições/mês de graça, sem cartão):
              crie conta em{" "}
              <a href="https://supadata.ai" target="_blank" rel="noreferrer">supadata.ai</a>,
              abra o painel (dashboard) e copie a <b>API key</b>. Pronto — cola nas ⚙️.
              Vídeo com legenda gasta 1 crédito; sem legenda, o Whisper deles entra
              automaticamente (2 créditos/minuto).
            </li>
            <li>
              <b>Transkriptor</b> (para quem já tem assinatura): entre em{" "}
              <a href="https://transkriptor.com" target="_blank" rel="noreferrer">transkriptor.com</a>,
              abra a área de API/Integrações da sua conta e gere a chave de desenvolvedor.
              Transcreve qualquer áudio, com identificação de falantes.
            </li>
            <li>
              <b>TranscriptAPI</b> (US$ 5/mês = 1.000 vídeos): crie conta em{" "}
              <a href="https://transcriptapi.com" target="_blank" rel="noreferrer">transcriptapi.com</a>{" "}
              e copie a chave do painel. Lê a legenda do vídeo — rápido e barato,
              mas o vídeo precisa TER legenda.
            </li>
            <li>
              <b>AssemblyAI</b> (pague só pelo que usar, ~US$ 0,37/hora): crie conta em{" "}
              <a href="https://www.assemblyai.com/dashboard" target="_blank" rel="noreferrer">assemblyai.com</a>{" "}
              e copie a API key do dashboard. Transcrição de alta qualidade com
              identificação de falantes; o Moka envia o áudio pra sua conta.
            </li>
          </ul>
          <p style={{ lineHeight: 1.6, marginTop: 8 }}>🔐 {t("tx_note")}</p>
        </section>

        {/* 🏆 Mural das IAs — página PRÓPRIA agora (pedido do Miguel, 24/08:
            não misturar com telemetria nem viver como âncora da ajuda). */}
        <section className="help-robo" style={{ marginBottom: 18 }}>
          <h2>🏆 Mural das IAs</h2>
          <p style={{ lineHeight: 1.6 }}>
            O ranking de preço e qualidade das IAs agora tem casa própria:{" "}
            <Link href="/mural-das-ias">
              <b>abrir o Mural das IAs →</b>
            </Link>
          </p>
        </section>

        {/* Robô de dúvidas */}
        <section className="help-robo" id="robô">
          <h2>🤖 {t("help_zemoca_title")}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pergunta.trim()) setResposta(responder(pergunta, FAQ));
            }}
          >
            <input
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              placeholder="Ex.: quanto custa traduzir um livro?"
            />
            <button type="submit">{t("help_ask_btn")}</button>
          </form>
          {resposta && <p className="help-resposta">{resposta}</p>}
        </section>

        {/* Tópicos — já filtrados pela busca do localizador (lá em cima). */}
        <div className="help-lista">
          {filtrados.map((f) => (
            <details key={f.q} className="help-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
          {filtrados.length === 0 && (
            <p className="help-vazio">{t("help_no_results") || "Nada encontrado — pergunta pro Zé Moca ali em cima 🧑‍🌾"}</p>
          )}
        </div>

        {/* Comunidade — Telegram @mokareader (criado pelo Miguel 09/08). */}
        <section className="help-comunidade">
          <h2>💬 {t("help_community_title")}</h2>
          <p>
            {t("help_community_desc")}{" "}
            <a href="https://t.me/mokareader" target="_blank" rel="noreferrer">
              {t("help_community_link")} →
            </a>
          </p>
        </section>
      </div>

            {/* CSS migrado para globals.css — cura o FOUC (era <style jsx>) */}
          <SiteFooter />
    </main>
  );
}
