import type {
  FamilyMessageItem,
  HealthResponse,
  LanguageCode,
  PlanRequest,
  PlanResponse,
  QAResponse,
} from "../types/nouba";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error("Health check failed");
  return (await res.json()) as HealthResponse;
}

export function generatePlan(req: PlanRequest): Promise<PlanResponse> {
  return postJson<PlanResponse>("/api/plan", req);
}

export function generateMessages(
  plan: PlanResponse,
  language: LanguageCode,
  cutWindowLabel: string
): Promise<{ messages: FamilyMessageItem[] }> {
  return postJson<{ messages: FamilyMessageItem[] }>("/api/messages", {
    plan,
    language,
    cut_window_label: cutWindowLabel,
  });
}

export function askQuestion(
  plan: PlanResponse,
  question: string,
  language: LanguageCode
): Promise<QAResponse> {
  return postJson<QAResponse>("/api/qa", { plan, question, language });
}
