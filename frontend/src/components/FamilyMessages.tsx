import { useState } from "react";
import { t } from "../i18n";
import type { FamilyMessageItem, LanguageCode } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  messages: FamilyMessageItem[];
  loading: boolean;
  onRefresh: () => void;
}

function fallbackWaUrl(phone: string, text: string): string {
  const digits = (phone || "").replace(/\D+/g, "");
  const encoded = encodeURIComponent(text);
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

function fallbackSmsUrl(phone: string, text: string): string {
  const digits = (phone || "").replace(/\D+/g, "");
  const encoded = encodeURIComponent(text);
  return digits ? `sms:+${digits}?body=${encoded}` : `sms:?body=${encoded}`;
}

export function FamilyMessages({ lang, messages, loading, onRefresh }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      // Clipboard API may be blocked in non-HTTPS contexts
    }
  };

  const copyAll = () => {
    const combined = messages.map((m) => `${m.family_name} (${m.phone}):\n${m.text}`).join("\n\n");
    void copyText("__all__", combined);
  };

  return (
    <section className="card">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{t(lang, "messages")} ({messages.length})</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="btn" onClick={copyAll} disabled={messages.length === 0}>
            {copiedId === "__all__" ? "Copied All!" : "Copy All"}
          </button>
          <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
            {loading ? "..." : "Regenerate"}
          </button>
        </div>
      </div>
      <div className="grid-2">
        {messages.map((m) => {
          const smsHref = m.sms_url || fallbackSmsUrl(m.phone, m.text);
          const waHref = m.whatsapp_url || fallbackWaUrl(m.phone, m.text);
          return (
            <article key={m.family_id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.4rem", marginBottom: "0.35rem" }}>
                <div>
                  <strong>{m.family_name}</strong>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{m.phone || "+216 55 548 015"}</div>
                </div>
                <span className="badge">{m.source}</span>
              </div>
              <p style={{ margin: "0 0 0.65rem 0", fontSize: "0.92rem" }}>{m.text}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <a className="btn" href={smsHref}>SMS</a>
                <a className="btn btn-primary" href={waHref} target="_blank" rel="noreferrer">WhatsApp</a>
                <button type="button" className="btn" onClick={() => void copyText(m.family_id, m.text)}>
                  {copiedId === m.family_id ? "Copied!" : "Copy"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
