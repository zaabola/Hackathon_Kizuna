import { useEffect, useState } from "react";
import { askQuestion } from "../api/client";
import { t } from "../i18n";
import type { LanguageCode, PlanResponse, QAResponse } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  plan: PlanResponse;
}

const SUGGESTIONS: Record<LanguageCode, string[]> = {
  en: [
    "Why is irrigation scheduled at night?",
    "Why are we not getting 100% of our water need?",
    "How does NOUBA save electricity compared to fixed rotation?",
  ],
  fr: [
    "Pourquoi l'irrigation est-elle programmée la nuit ?",
    "Pourquoi ne recevons-nous pas 100 % de notre besoin ?",
    "Comment NOUBA réduit-il la facture d'électricité ?",
  ],
  ar: [
    "لماذا تم تحديد الري الليلة؟",
    "لماذا لا نحصل على 100% من حاجتنا للماء؟",
    "كيف يقلل نوبة تكلفة الكهرباء؟",
  ],
  "tn-darija": [
    "علاش السقيان الليلة موش في النهار؟",
    "علاش ما ناخذوش 100% من حاجتنا بالماء؟",
    "كيفاش نوبة ينقص فاتورة الضوء؟",
  ],
  ja: [
    "なぜ今夜の夜間配水なのですか？",
    "なぜ必要量の100%をもらえないのですか？",
    "固定輪番より電気代が安くなる理由は？",
  ],
};

export function FamilyQA({ lang, plan }: Props) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QAResponse | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setQaError(null);
  }, [plan]);

  const submitQuestion = async (qText: string) => {
    const trimmed = qText.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setLoading(true);
    setQaError(null);
    try {
      const res = await askQuestion(plan, trimmed, lang);
      setResult(res);
    } catch (err) {
      setQaError(err instanceof Error ? err.message : "Failed to answer question");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitQuestion(question);
  };

  return (
    <section className="card">
      <h2 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1.1rem" }}>{t(lang, "qaTitle")}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.65rem" }}>
        {(SUGGESTIONS[lang] || SUGGESTIONS.en).map((q) => (
          <button
            key={q}
            type="button"
            className="btn"
            style={{ fontSize: "0.8rem", padding: "0.35rem 0.65rem" }}
            disabled={loading}
            onClick={() => void submitQuestion(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          aria-label={t(lang, "qaTitle")}
          placeholder={t(lang, "askPlaceholder")}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "..." : t(lang, "askBtn")}
        </button>
      </form>
      {qaError && (
        <div className="warn-box" role="alert" style={{ marginTop: "0.75rem" }}>
          {qaError}
        </div>
      )}
      {result && (
        <div style={{ marginTop: "0.75rem", padding: "0.85rem", borderRadius: 8, background: "var(--surface-alt)" }}>
          <p style={{ margin: "0 0 0.5rem 0", lineHeight: 1.55 }}>{result.answer}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
            <span className="badge">
              {result.grounded ? "Plan-grounded" : "Unverified"} · {result.source}
            </span>
            {result.rejected_reason && (
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                (Guardrail: {result.rejected_reason})
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
