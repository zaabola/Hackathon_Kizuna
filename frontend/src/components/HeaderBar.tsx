import { t } from "../i18n";
import type { HealthResponse, LanguageCode } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  onLangChange: (lang: LanguageCode) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  health: HealthResponse | null;
}

export function HeaderBar({ lang, onLangChange, theme, onToggleTheme, health }: Props) {
  return (
    <header className="card" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "1.45rem" }}>NOUBA</h1>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>{t(lang, "subtitle")}</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
        <span className="badge" aria-live="polite">
          {health?.llm_connected ? `LLM: ${health.llm_model.split("/").pop()}` : "LLM: Fallback Mode"}
        </span>
        <select
          aria-label="Language"
          value={lang}
          onChange={(e) => onLangChange(e.target.value as LanguageCode)}
          style={{ width: "auto" }}
        >
          <option value="tn-darija">التونسية (Darija)</option>
          <option value="ar">العربية (Arabic)</option>
          <option value="fr">Français</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
        </select>
        <button type="button" className="btn" onClick={onToggleTheme} aria-label="Toggle color theme">
          {theme === "light" ? "Dark" : "Light"}
        </button>
      </div>
    </header>
  );
}
