import type {
  FamilyInput,
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

export async function fetchSampleFamilies(): Promise<FamilyInput[]> {
  const res = await fetch("/api/families/sample");
  if (!res.ok) throw new Error("Failed to load sample families CSV");
  return (await res.json()) as FamilyInput[];
}

export async function exportPlanCsv(plan: PlanResponse): Promise<void> {
  const res = await fetch("/api/plan/export-csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  if (!res.ok) throw new Error("Failed to export plan CSV");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nouba_plan_${plan.weather.date}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
