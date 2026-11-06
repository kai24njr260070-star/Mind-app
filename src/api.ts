import type { AICandidate, FissionError } from "./types";

export class FissionApiError extends Error {
  constructor(public kind: FissionError) {
    super(`fission api error: ${kind}`);
  }
}

/**
 * 設定画面で入力されたキーを設定localStorageから直接読む
 * (store.ts は api.ts を import しているため、循環参照を避ける)。
 * ※jsonHeaders 経由で provider/base/model も一緒に読むため、この関数は後方互換として残置せず削除。
 */

const jsonHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const s = JSON.parse(localStorage.getItem("mind-signature-settings-v1") || "{}");
    if (typeof s.apiKey === "string" && s.apiKey.trim()) headers["X-AI-Key"] = s.apiKey.trim();
    if (typeof s.providerId === "string" && s.providerId) headers["X-AI-Provider"] = s.providerId;
    if (typeof s.aiModel === "string" && s.aiModel.trim()) headers["X-AI-Model"] = s.aiModel.trim();
  } catch {
    // 設定なし=Worker既定(Freebuff + 環境変数キー)
  }
  return headers;
};

export async function requestFissionCandidates(payload: {
  parent: { title: string; description?: string };
  ancestors: string[];
  siblings: string[];
  depth: number;
}): Promise<AICandidate[]> {
  let res: Response;
  try {
    res = await fetch("/api/ai/fission", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    throw new FissionApiError("network");
  }
  if (!res.ok) {
    let kind: FissionError = "ai_failed";
    if (res.status === 503) kind = "not_configured";
    else if (res.status === 400) kind = "bad_request";
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error && ["not_configured", "ai_failed", "bad_request"].includes(json.error)) {
        kind = json.error as FissionError;
      }
    } catch {
      /* 本文なし; ステータスコードを優先 */
    }
    throw new FissionApiError(kind);
  }
  const json = (await res.json()) as { candidates?: AICandidate[] };
  const list = (json.candidates ?? []).filter(
    (c) => typeof c?.title === "string" && c.title.trim().length > 0
  );
  return list.map((c) => ({ title: c.title.trim(), description: String(c.description ?? "").trim() }));
}

/** Reflection文脈:AIに渡す目標の要約(idxはAIがアクションで参照する番号)。 */
export interface ReflectionContextGoal {
  idx: number;
  title: string;
  status: string;
  deadline?: string;
  childCount: number;
  daysOld: number;
}

export interface ReflectionAIAction {
  goalIdx?: number;
  kind: "split" | "reschedule" | "focus" | "rest";
  label: string;
  /** reschedule時の延長日数 */
  days?: number;
}

export async function requestReflection(payload: {
  goals: ReflectionContextGoal[];
  memos: Array<{ date: string; content: string }>;
  today: string;
}): Promise<{ summary: string; actions: ReflectionAIAction[] }> {
  let res: Response;
  try {
    res = await fetch("/api/ai/reflection", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    throw new FissionApiError("network");
  }
  if (!res.ok) throw new FissionApiError(res.status === 503 ? "not_configured" : "ai_failed");
  const json = (await res.json()) as {
    summary?: string;
    actions?: Array<{ goalIdx?: unknown; kind?: unknown; label?: unknown; days?: unknown }>;
  };
  const kinds = new Set(["split", "reschedule", "focus", "rest"]);
  const actions = (json.actions ?? [])
    .filter((a) => typeof a?.kind === "string" && kinds.has(a.kind) && typeof a?.label === "string")
    .slice(0, 3)
    .map((a) => ({
      goalIdx: typeof a.goalIdx === "number" ? a.goalIdx : undefined,
      kind: a.kind as ReflectionAIAction["kind"],
      label: String(a.label).trim(),
      days: typeof a.days === "number" && Number.isFinite(a.days) ? a.days : undefined,
    }));
  return { summary: String(json.summary ?? "").trim(), actions };
}

/** 設定画面用:サーバー側からキーの有効性を確認(キーそのものは返さない)。 */
export async function requestAIStatus(): Promise<{
  configured: boolean;
  ok: boolean;
  model: string | null;
  error: string | null;
  envConfigured: boolean;
}> {
  try {
    const res = await fetch("/api/ai/status", { headers: jsonHeaders() });
    if (!res.ok) {
      return { configured: false, ok: false, model: null, error: `status ${res.status}`, envConfigured: false };
    }
    const json = (await res.json()) as {
      configured?: boolean;
      ok?: boolean;
      model?: string | null;
      error?: string | null;
      envConfigured?: boolean;
    };
    return {
      configured: json.configured === true,
      ok: json.ok === true,
      model: json.model ?? null,
      error: json.error ?? null,
      envConfigured: json.envConfigured === true,
    };
  } catch {
    return { configured: false, ok: false, model: null, error: "network", envConfigured: false };
  }
}
