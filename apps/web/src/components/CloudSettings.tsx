"use client";

/**
 * CloudSettings — o "espaçozinho" da memória na nuvem (ordem do Miguel,
 * 31/08: a pessoa cola o token do Cloudflare R2 ou do Backblaze B2 e a
 * memória dela pode ser salva e usada mais tarde, em outro aparelho).
 *
 * BYO-bucket, igual ao BYOK das chaves de IA: as credenciais ficam SÓ no
 * aparelho (cofre AES-GCM do lib/cloud) e nada passa por servidor nosso.
 */

import { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";
import {
  loadCloudConfig,
  saveCloudConfig,
  clearCloudConfig,
  type CloudConfig,
  type CloudProvider,
} from "@/lib/cloud";
import { testCloud } from "@/lib/cloud-s3";

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; objects: number }
  | { status: "fail"; kind: "credencial" | "bucket" | "rede" };

const PROVIDERS: Array<{
  key: CloudProvider;
  labelKey: "cloud_provider_r2" | "cloud_provider_b2" | "cloud_provider_s3";
}> = [
  { key: "r2", labelKey: "cloud_provider_r2" },
  { key: "b2", labelKey: "cloud_provider_b2" },
  { key: "s3", labelKey: "cloud_provider_s3" },
];

export function CloudSettings() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<CloudConfig>({
    provider: "r2",
    host: "",
    accessKeyId: "",
    secretAccessKey: "",
    bucket: "",
  });
  const [hasSaved, setHasSaved] = useState(false);
  // ✨ Cola mágica (pedido do Miguel, 31/08: "muito campo… não tem como
  // simplificar?"): cola a tela do token INTEIRA e o app preenche tudo.
  const [magic, setMagic] = useState("");
  const [magicMsg, setMagicMsg] = useState<"ok" | "fail" | null>(null);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    void loadCloudConfig().then((c) => {
      if (c) {
        setCfg(c);
        setHasSaved(true);
      }
    });
  }, []);

  const ready = cfg.host.trim() && cfg.accessKeyId.trim() && cfg.secretAccessKey.trim() && cfg.bucket.trim();

  const aplicarMagic = () => {
    const texto = magic;
    const next = { ...cfg };
    let achou = false;
    const mR2 = texto.match(/https:\/\/([0-9a-f]{32})\.r2\.cloudflarestorage\.com/i);
    const mB2 = texto.match(/https:\/\/s3\.([a-z0-9-]+)\.backblazeb2\.com/i);
    if (mR2) {
      next.provider = "r2";
      next.host = mR2[1];
      achou = true;
    } else if (mB2) {
      next.provider = "b2";
      next.host = mB2[1];
      achou = true;
    }
    const accountId = mR2?.[1]?.toLowerCase();
    // Secret: R2 = 64 hex; B2 = applicationKey (começa com K, ~25+ chars).
    const mSk = texto.match(/\b([0-9a-f]{64})\b/i)
      ?? texto.match(/(?:applicationKey|application key|secret)\D{0,20}\b(K[0-9A-Za-z_-]{16,})\b/i);
    if (mSk) {
      next.secretAccessKey = mSk[1];
      achou = true;
    }
    // Access Key: R2 = 32 hex (≠ accountId); B2 = keyID 25 hex (ou com label).
    const hashes = texto.match(/\b([0-9a-f]{32})\b/ig) ?? [];
    const akR2 = hashes.map((h) => h.toLowerCase()).find((h) => h !== accountId);
    const akB2 = texto.match(/(?:keyID|key id|access key id)\D{0,20}\b([0-9a-f]{20,27})\b/i)?.[1]
      ?? texto.match(/\b([0-9a-f]{25})\b/i)?.[1];
    const ak = next.provider === "b2" ? (akB2 ?? akR2) : (akR2 ?? akB2);
    if (ak) {
      next.accessKeyId = ak;
      achou = true;
    }
    // Nome do bucket: a tela do token lista "Buckets: <nome>" — preenche
    // junto (pedido do Miguel, 31/08: "veio o nome do bucket na tela e
    // você esqueceu de preencher"). "All buckets" não tem nome único.
    const mBucket = texto.match(/Buckets?\s*:\s*\n\s*([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])/i);
    if (mBucket && !/^all$/i.test(mBucket[1].trim())) {
      next.bucket = mBucket[1].trim();
    }
    if (achou) {
      setCfg(next);
      setMagicMsg("ok");
    } else {
      setMagicMsg("fail");
    }
  };

  const handleTest = async () => {
    setTest({ status: "running" });
    const result = await testCloud(cfg);
    if (result.ok) setTest({ status: "ok", objects: result.objects });
    else setTest({ status: "fail", kind: result.kind });
  };

  const handleSave = async () => {
    await saveCloudConfig(cfg);
    setHasSaved(true);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2500);
  };

  const handleForget = async () => {
    await clearCloudConfig();
    setHasSaved(false);
    setTest({ status: "idle" });
    setCfg({ provider: "r2", host: "", accessKeyId: "", secretAccessKey: "", bucket: "" });
  };

  const hostKey: "cloud_host_r2" | "cloud_host_b2" | "cloud_host_s3" =
    cfg.provider === "r2" ? "cloud_host_r2" : cfg.provider === "b2" ? "cloud_host_b2" : "cloud_host_s3";
  // Placeholder = DICA, nunca um valor que pareça real (o fake de 32 hex
  // confundiu o Miguel: "porque está colado o nome do meu id?").
  const hostPh =
    cfg.provider === "r2"
      ? "cole o ID da conta OU o endereço Default do token (https://…r2.cloudflarestorage.com)"
      : cfg.provider === "b2"
        ? "cole a região (ex.: us-west-004) ou o endpoint"
        : "ex.: s3.exemplo.com";

  return (
    <div className="cloud-settings">
      <p className="cloud-intro">{t("cloud_intro")}</p>

      {/* ✨ Cola mágica: um campo só — a tela do token inteira */}
      <div className="field">
        <label>{t("cloud_magic")}</label>
        <textarea
          className="cloud-magic"
          rows={4}
          value={magic}
          onChange={(e) => {
            setMagic(e.target.value);
            setMagicMsg(null);
          }}
          placeholder={t("cloud_magic_ph")}
          spellCheck={false}
        />
        <div className="cloud-actions">
          <button type="button" className="cloud-btn" disabled={!magic.trim()} onClick={aplicarMagic}>
            {t("cloud_magic_btn")}
          </button>
        </div>
        {magicMsg === "ok" && <p className="cloud-msg ok">{t("cloud_magic_ok")}</p>}
        {magicMsg === "fail" && <p className="cloud-msg err">{t("cloud_magic_fail")}</p>}
      </div>

      <div className="field">
        <label>{t("cloud_provider")}</label>
        <div className="cloud-providers">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`cloud-provider-btn ${cfg.provider === p.key ? "active" : ""}`}
              onClick={() => {
                if (cfg.provider !== p.key) {
                  // trocou de provedor: campos do outro não servem — limpa
                  // (ordem do Miguel, 31/08: "quando muda pra Backblaze
                  // tem que limpar, o campo fica cheio").
                  setCfg({ provider: p.key, host: "", accessKeyId: "", secretAccessKey: "", bucket: "" });
                  setTest({ status: "idle" });
                  setMagicMsg(null);
                }
              }}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>{t(hostKey)}</label>
        <input
          type="text"
          name="moka-cloud-host-off"
          value={cfg.host}
          onChange={(e) => setCfg((c) => ({ ...c, host: e.target.value }))}
          placeholder={hostPh}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label>{t("cloud_key_id")}</label>
        <input
          type="text"
          value={cfg.accessKeyId}
          onChange={(e) => setCfg((c) => ({ ...c, accessKeyId: e.target.value }))}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label>{t("cloud_secret")}</label>
        <input
          type="password"
          value={cfg.secretAccessKey}
          onChange={(e) => setCfg((c) => ({ ...c, secretAccessKey: e.target.value }))}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label>{t("cloud_bucket")}</label>
        <input
          type="text"
          value={cfg.bucket}
          onChange={(e) => setCfg((c) => ({ ...c, bucket: e.target.value }))}
          placeholder="ex.: meu-bucket"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="cloud-actions">
        <button type="button" className="cloud-btn" disabled={!ready || test.status === "running"} onClick={handleTest}>
          🔌 {test.status === "running" ? t("cloud_testing") : t("cloud_test")}
        </button>
        <button type="button" className="cloud-btn primary" disabled={!ready} onClick={handleSave}>
          💾 {t("cloud_save")}
        </button>
        {hasSaved && (
          <button type="button" className="cloud-btn" onClick={handleForget}>
            🗑️ {t("cloud_forget")}
          </button>
        )}
      </div>

      {test.status === "ok" && (
        <p className="cloud-msg ok">✅ {t("cloud_test_ok", { n: test.objects })}</p>
      )}
      {test.status === "fail" && (
        <p className="cloud-msg err">
          {test.kind === "credencial" ? `❌ ${t("cloud_test_403")}` : null}
          {test.kind === "bucket" ? `❌ ${t("cloud_test_404")}` : null}
          {test.kind === "rede" ? `❌ ${t("cloud_test_net")}` : null}
        </p>
      )}
      {savedFlash && <p className="cloud-msg ok">☁️ {t("cloud_saved")}</p>}

      <p className="cloud-note">🔐 {t("cloud_hint")}</p>
      <p className="cloud-note">⚠️ {t("cloud_cors_note")}</p>
    </div>
  );
}
