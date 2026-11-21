import { t } from "../i18n";
import type { FamilyMessageItem, LanguageCode } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  messages: FamilyMessageItem[];
  loading: boolean;
  onRefresh: () => void;
}

export function FamilyMessages({ lang, messages, loading, onRefresh }: Props) {
  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{t(lang, "messages")}</h2>
        <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
          {loading ? "..." : "Regenerate"}
        </button>
      </div>
      <div className="grid-2">
        {messages.map((m) => {
          const encoded = encodeURIComponent(m.text);
          return (
            <article key={m.family_id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                <strong>{m.family_name}</strong>
                <span className="badge">{m.source}</span>
              </div>
              <p style={{ margin: "0 0 0.65rem 0", fontSize: "0.92rem" }}>{m.text}</p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <a className="btn" href={`sms:?body=${encoded}`}>SMS</a>
                <a className="btn" href={`https://wa.me/?text=${encoded}`} target="_blank" rel="noreferrer">WhatsApp</a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
