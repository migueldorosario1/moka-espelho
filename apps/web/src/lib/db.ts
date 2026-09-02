/**
 * Camada de persistência com IndexedDB.
 *
 * Guarda a SESSÃO DE LEITURA: o último livro aberto + posição (página/capítulo)
 * + zoom. Assim, ao recarregar/fechar/desligar/navegar, o usuário volta pra
 * onde estava — como um app de leitura de verdade.
 *
 * Hoje guardamos só o ÚLTIMO livro (chave fixa "current"). Uma biblioteca de
 * múltiplos livros fica pra uma fase futura.
 *
 * Sem dependências externas — só a API nativa do navegador.
 */

import type { ParsedBook } from "@igot/parser";

const DB_NAME = "igot";
const DB_VERSION = 1;
const STORE = "sessions";
const SESSION_KEY = "current";

/** Tipo de nota salva (tradução, explicação, pergunta livre ou resumo). */
export type NoteKind = "translate" | "explain" | "ask" | "summary";

/** Uma anotação persistida pelo usuário. */
export interface SavedNote {
  id: string;
  kind: NoteKind;
  /** Trecho selecionado (pra translate/explain) ou pergunta (ask). */
  source: string;
  /** Resposta da IA. */
  result: string;
  /** Capítulo/página de origem (opcional). */
  chapterId?: string;
  savedAt: number;
}

/** Tudo que precisa pra retomar a leitura exatamente de onde parou. */
export interface Session {
  id: string;
  fileName: string;
  fileSize: number;
  book: ParsedBook;
  /** Buffer do PDF original (só quando sourceFormat === "pdf"). */
  pdfSource: Uint8Array | null;
  /** Buffer do EPUB original — pra backup/restauração na nuvem (regra do
   *  Miguel, 31/08: a estante só aceita o livro ORIGINAL, nunca texto
   *  convertido). */
  epubSource?: Uint8Array | null;
  chapterIdx: number;
  zoom: number;
  savedAt: number;
  /**
   * Traduções de página já prontas. Chave = String(chapterIdx + 1)
   * (alinha com pageNum do PdfPageCanvas). Evita re-traduzir ao navegar.
   */
  translations?: Record<string, string>;
  /** Anotações salvas pelo usuário (tradução/explicação/pergunta). */
  notes?: SavedNote[];
  /** Capa do livro (data URL) pra mostrar na estante. */
  coverImage?: string;
  /**
   * Marcadores (bookmarks) de página. Cada um guarda o chapterIdx e o
   * timestamp de criação, pra lista ordenada no painel de marcadores.
   * `pageLabel`/`preview` (opcionais, 13/08) = rótulo da página + primeiras
   * palavras, pra o leitor saber qual página marcou (pedido do Miguel).
   * `pageIdx` (13/08) = página LOCAL dentro do capítulo (pra voltar na exata).
   */
  bookmarks?: Array<{ chapterIdx: number; pageIdx?: number; savedAt: number; pageLabel?: string; preview?: string }>;
}

/**
 * Abre (ou cria) o banco. Resolve quando tá pronto pra uso.
 *
 * Importante: em alguns contextos (Safari/iOS modo privado, frames
 * restritos), o `indexedDB.open` pode NUNCA disparar onsuccess/onerror —
 * a Promise ficaria pendente pra sempre e travaria o app. Por isso o
 * timeout de segurança: se não responder em 5s, rejeita.
 */
/**
 * Abre o banco pedindo uma versão, com CURA de VersionError: se o banco já
 * estiver numa versão MAIOR (caso da v1 da obra MOKA, que chegou a subir o
 * "igot" pra v3), reabre SEM versão — anexa à atual. Os stores sessions/
 * books continuam lá (o upgrade alheio era aditivo), então nada se perde.
 */
function openVersionSafe(
  name: string,
  version: number,
  onUpgrade: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const attempt = (withVersion: boolean) => {
      const req = withVersion
        ? indexedDB.open(name, version)
        : indexedDB.open(name);
      req.onupgradeneeded = () => onUpgrade(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        const err = req.error;
        // DOMException VersionError = name "VersionError" (code 12 legado)
        if (withVersion && err && /VersionError/i.test(`${err.name} ${err.message}`)) {
          attempt(false); // banco em versão maior: anexa à atual
          return;
        }
        reject(err ?? new Error("Erro ao abrir IndexedDB."));
      };
    };
    attempt(true);
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB não disponível neste navegador."));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Timeout ao abrir IndexedDB (5s)."));
      }
    }, 5000);
    openVersionSafe(DB_NAME, DB_VERSION, (db) => {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE); // key-path externo; usamos chave fixa
      }
    })
      .then((db) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(db);
        } else {
          db.close();
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

/** Grava (ou sobrescreve) a sessão atual. */
export async function saveSession(session: Session): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(session, SESSION_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Erro ao gravar sessão."));
    };
  });
}

/** Lê a última sessão gravada (ou null se não houver). */
export async function loadSession(): Promise<Session | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(SESSION_KEY);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as Session | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error("Erro ao ler sessão."));
    };
  });
}

/** Limpa a sessão (fecha o livro). */
export async function clearSession(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(SESSION_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Erro ao limpar sessão."));
    };
  });
}

// ─── Biblioteca (múltiplos livros) ───────────────────────────────────────

const BOOKS_STORE = "books";

/**
 * Abre o DB garantindo que o store 'books' existe (pra múltiplos livros).
 * Migra do DB v1 (só 'sessions') criando o novo store sob demanda.
 */
function openDBWithBooks(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB não disponível."));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Timeout ao abrir IndexedDB (5s)."));
      }
    }, 5000);

    // Tenta abrir na versão 2 (com o store 'books'). Se o banco já estiver
    // numa versão MAIOR (v1 da obra MOKA chegou a criar a v3), a cura do
    // openVersionSafe anexa à versão atual — sessions/books seguem lá.
    openVersionSafe(DB_NAME, 2, (db) => {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE); // sessions (legado)
      }
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: "id" });
      }
    })
      .then((db) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(db);
        } else {
          db.close();
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

/** Lista TODOS os livros da estante (sem pdfSource — leve). */
export async function listAllBooks(): Promise<Session[]> {
  const db = await openDBWithBooks();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, "readonly");
    const req = tx.objectStore(BOOKS_STORE).getAll();
    req.onsuccess = () => {
      db.close();
      const books = (req.result as Session[]) ?? [];
      // Ordena por mais recentemente acessado.
      books.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
      resolve(books);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error("Erro ao listar livros."));
    };
  });
}

/** Pega UM livro pelo ID (com pdfSource). */
export async function getBookById(id: string): Promise<Session | null> {
  const db = await openDBWithBooks();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, "readonly");
    const req = tx.objectStore(BOOKS_STORE).get(id);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as Session | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error("Erro ao ler livro."));
    };
  });
}

/** Salva (ou atualiza) um livro na estante. */
export async function saveBookToLibrary(session: Session): Promise<void> {
  const db = await openDBWithBooks();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, "readwrite");
    tx.objectStore(BOOKS_STORE).put(session);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Erro ao salvar livro."));
    };
  });
}

/** Remove um livro da estante. */
export async function deleteBookFromLibrary(id: string): Promise<void> {
  const db = await openDBWithBooks();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, "readwrite");
    tx.objectStore(BOOKS_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Erro ao remover livro."));
    };
  });
}

/**
 * Migra o livro legado (store 'sessions', chave 'current') pro novo store
 * 'books' com um ID único. Roda uma vez automaticamente quando a estante
 * carrega. Se já migrou antes (ou não tem livro antigo), não faz nada.
 */
export async function migrateLegacyBook(): Promise<void> {
  try {
    // Se já migrou (ou limpou a estante), não roda de novo.
    if (typeof localStorage !== "undefined" && localStorage.getItem("igot.migrated") === "1") {
      return;
    }
    const db = await openDBWithBooks();
    // Lê o livro antigo (store 'sessions', chave 'current').
    const old = await new Promise<Session | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(SESSION_KEY);
      req.onsuccess = () => resolve((req.result as Session | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();

    if (!old || !old.book) return;

    // Se já tem um livro com o mesmo nome na estante, não duplica.
    const existing = await listAllBooks().catch(() => []);
    const duplicate = existing.find(
      (b) => b.fileName === old.fileName && b.fileSize === old.fileSize,
    );
    if (duplicate) {
      // Já migrou antes. Limpa o legado.
      const db2 = await openDBWithBooks();
      await new Promise<void>((resolve) => {
        const tx = db2.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(SESSION_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db2.close();
      return;
    }

    // Transfere pro novo store com ID único.
    const newId = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const migrated: Session = { ...old, id: newId };
    await saveBookToLibrary(migrated);

    // Limpa o legado.
    const db3 = await openDBWithBooks();
    await new Promise<void>((resolve) => {
      const tx = db3.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(SESSION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db3.close();
    // Marca que migrou (não roda de novo).
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("igot.migrated", "1");
    }
    console.log("[igot] Livro legado migrado pra estante:", newId);
  } catch (err) {
    console.warn("[igot] Migração de livro legado falhou:", err);
  }
}

/**
 * Limpa TODOS os livros da estante — de TODAS as fontes:
 * - Store 'books' (estante nova)
 * - Store 'sessions' (legado) — senão migração recria
 * - Flag de migração (localStorage) — senão migração roda de novo
 */
export async function clearLibrary(): Promise<void> {
  // 1. Limpa o store 'books' (estante).
  const db = await openDBWithBooks();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, "readwrite");
    tx.objectStore(BOOKS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Erro ao limpar books."));
  });
  // 2. Limpa o store 'sessions' (legado) no MESMO db — senão a migração
  //    detecta o livro antigo e recria na próxima carga.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Erro ao limpar sessions."));
  });
  db.close();
  // 3. Marca que a migração já terminou (não roda de novo).
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("igot.migrated", "1");
  }
}
