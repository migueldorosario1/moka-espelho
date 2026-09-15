"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CafezinhoLogo } from "@/components/CafezinhoLogo";
import { LangSwitcher } from "@/components/LangSwitcher";
import { useI18n } from "@/components/I18nProvider";
import { useAuth } from "@/lib/auth";
import { TopNav } from "@/components/TopNav";

/**
 * /auth/atualizar-senha — destino do link "esqueci a senha".
 * O e-mail de recuperação cai no /api/auth/callback (troca o code por
 * sessão) e de lá vem pra cá (param `next`). A pessoa cria a nova senha
 * e já entra logada.
 */
export default function AtualizarSenha() {
  const { t } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  const salvar = async () => {
    if (senha.length < 6) {
      setErro(t("auth_password_short"));
      return;
    }
    setBusy(true);
    setErro("");
    try {
      await auth.updatePassword(senha);
      router.push("/");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <main className="igot-shell ft">
      {/* TopNav padrão (ordem do Miguel 15/09: menu no alto em TODAS as páginas). */}
      <TopNav />

      <div className="capa-body" style={{ maxWidth: 420, margin: "0 auto" }}>
        <h1 className="capa-tagline" style={{ fontSize: 26 }}>{t("auth_new_password")}</h1>
        {erro && <p style={{ color: "var(--accent)", marginTop: 10 }}>⚠️ {erro}</p>}
        <form
          style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <input
            type="password"
            required
            minLength={6}
            placeholder={t("auth_password")}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="new-password"
            style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", color: "var(--text)", fontSize: 15 }}
          />
          <button
            type="submit"
            disabled={busy}
            style={{ padding: 12, border: "none", borderRadius: 10, cursor: "pointer", background: "var(--accent)", color: "var(--accent-contrast, #fff)", fontSize: 15, fontWeight: 700 }}
          >
            {busy ? "⏳" : t("auth_save")}
          </button>
        </form>
      </div>
    </main>
  );
}
