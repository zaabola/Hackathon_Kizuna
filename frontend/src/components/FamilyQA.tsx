import { useState } from "react";
import { askQuestion } from "../api/client";
import { t } from "../i18n";
import type { LanguageCode, PlanResponse, QAResponse } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  plan: PlanResponse;
}

export function FamilyQA({ lang, plan }: Props) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QAResponse | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setQaError(null);
    try {
      const res = await askQuestion(plan, question.trim(), lang);
      setResult(res);
    } catch (err) {
      setQaError(err instanceof Error ? err.message : "Failed to answer question");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card">
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t(lang, "qaTitle")}</h2>
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
        <div style={{ marginTop: "0.75rem", padding: "0.75rem", borderRadius: 8, background: "var(--surface-alt)" }}>
          <p style={{ margin: "0 0 0.4rem 0" }}>{result.answer}</p>
          <span className="badge">
            {result.grounded ? "Plan-grounded" : "Unverified"} · {result.source}
          </span>
        </div>
      )}
    </section>
  );
}
