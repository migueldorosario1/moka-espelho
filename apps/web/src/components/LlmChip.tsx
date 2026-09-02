"use client";

/**
 * LlmChip — mostra QUEM está ligada (ordem do Miguel, 31/08: "tem que
 * colocar visível quem é a LLM que tá ligada, qual modelo — e poder
 * mudar"). Chip no topo do Harness/Writer: "🔌 DeepSeek · deepseek-chat".
 * Um toque abre as configurações pra trocar.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./I18nProvider";
import { PRESETS } from "@igot/ai-providers";
import { getEntryForText, loadConfigCache } from "@/lib/config";

export function LlmChip() {
  const { t } = useI18n();
  const router = useRouter();
  const [info, setInfo] = useState<{ name: string; model?: string } | null | undefined>(undefined);

  useEffect(() => {
    void loadConfigCache().then(() => {
      const c = getEntryForText();
      if (!c) {
        setInfo(null);
        return;
      }
      setInfo({
        name: PRESETS.find((p) => p.id === c.providerId)?.name ?? c.providerId,
        model: c.model,
      });
    });
  }, []);

  if (info === undefined) return null;

  if (info === null) {
    return (
      <button
        type="button"
        className="llm-chip none"
        onClick={() => router.push("/configuracoes")}
      >
        ⚠️ {t("llm_none")} · {t("llm_change")} →
      </button>
    );
  }

  return (
    <button
      type="button"
      className="llm-chip"
      onClick={() => router.push("/configuracoes")}
      title={t("llm_change")}
    >
      🔌 {t("llm_on", { model: info.model ? `${info.name} · ${info.model}` : info.name })} · {t("llm_change")}
    </button>
  );
}
