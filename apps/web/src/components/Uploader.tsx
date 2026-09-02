"use client";

import { useCallback, useRef, useState } from "react";
import { useI18n } from "./I18nProvider";

interface UploaderProps {
  onFile: (file: File) => void;
  error?: string | null;
  /** Se a IA está configurada (pra mostrar aviso de setup). */
  configReady?: boolean;
  /** Abre as configurações. */
  onOpenSettings?: () => void;
  /** Progresso da ingestão (livro grande = barrinha de % subindo). */
  progress?: { pct: number; label: string } | null;
}

/**
 * Tela inicial (onboarding + upload).
 * Apresenta o app, explica o que faz, avisa se a IA não tá configurada,
 * e aceita .epub/.pdf por arrastar-soltar ou clique.
 */
export function Uploader({ onFile, error, configReady = true, onOpenSettings, progress }: UploaderProps) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div className="uploader-page">
      <div className="uploader-card">
        {/* Hero — xícara com vapor subindo (a assinatura do Moka) */}
        <div className="hero">
          <div className="logo" aria-hidden>
            <span className="steam steam-1" />
            <span className="steam steam-2" />
            <span className="steam steam-3" />
            <span className="logo-cup">☕</span>
          </div>
          <h1 className="brand-name">Moka</h1>
          <p className="tagline">{t("app_tagline")}</p>
          <p className="subtitle">{t("upload_hero_desc")}</p>
        </div>

        {progress && (
          <div className="ingest-progress" role="status" aria-live="polite">
            <div className="ingest-progress-bar">
              <div className="ingest-progress-fill" style={{ width: `${progress.pct}%` }} />
            </div>
            <p className="ingest-progress-label">
              <span className="ingest-progress-pct">{progress.pct}%</span> — {progress.label}
            </p>
          </div>
        )}

        {/* Features */}
        <div className="features">
          <div className="feature">
            <span className="feature-icon">🌐</span>
            <span className="feature-text">{t("upload_feat_translate")}</span>
          </div>
          <div className="feature">
            <span className="feature-icon">🧠</span>
            <span className="feature-text">{t("upload_feat_explain")}</span>
          </div>
          <div className="feature">
            <span className="feature-icon">📄</span>
            <span className="feature-text">{t("upload_feat_formats")}</span>
          </div>
        </div>

        {/* Aviso: IA não configurada */}
        {!configReady && (
          <div className="setup-warning" onClick={onOpenSettings} role="button">
            <span className="setup-icon">⚠️</span>
            <div className="setup-content">
              <strong>{t("upload_config_needed")}</strong>
              <span>{t("upload_config_desc")}</span>
            </div>
            <span className="setup-arrow">⚙️ →</span>
          </div>
        )}

        {/* Dropzone */}
        <label
          className={`dropzone ${dragging ? "is-dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".epub,.pdf,application/epub+zip,application/pdf"
            onChange={handleChange}
            hidden
          />
          <div className="dropzone-inner">
            <div className="dropzone-icon" aria-hidden>
              📖
            </div>
            <p className="dropzone-title">
              {t("upload_dropzone")} <span>{t("upload_click")}</span>
            </p>
            <p className="dropzone-formats">{t("upload_format_hint")}</p>
          </div>
        </label>

        {error && (
          <p className="uploader-error" role="alert">
            ⚠️ {error}
          </p>
        )}

        {/* Badge de privacidade */}
        <div className="privacy-badge">
          🔒 <span>{t("upload_privacy")}</span>
        </div>

        {/* Links: Quem Somos + Privacidade */}
        <div className="uploader-links">
          <a href="/sobre">Quem Somos</a>
          <span>·</span>
          <a href="/privacidade">Privacidade</a>
        </div>
      </div>

      {/* CSS migrado para globals.css — cura FOUC (era <style jsx>) */}
    </div>
  );
}
