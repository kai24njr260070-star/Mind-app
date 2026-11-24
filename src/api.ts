import type { AICandidate, FissionError, GoalIdea, MusicTrack } from "./types";
import { directFission, directIdeas, directMusic, directReflection, directStatus } from "./directAi";
import type { IdeaRequestPayload, MusicRequestPayload } from "./aiShared";

/**
 * ネイティブアプリ(Capacitor/Tauri)では配信元が localhost 系になるため、
 * ビルド時に VITE_API_BASE で Worker のURLを指定する。
 * 空なら同一オリジン(Web版)。
 */
const API_BASE = String(import.meta.env?.VITE_API_BASE ?? "").replace(/\/+$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export class FissionApiError extends Error {
  constructor(public kind: FissionError, public detail?: string) {
    super(`fission api error: ${kind}`);
  }
}

/** /api が無い静的ホスティング(Cloudflare Pages 直配信など)か。 */
function notWorkerApi(res: Response): boolean {
  const type = res.headers.get("content-type") ?? "";
  return res.status === 404 || res.status === 405 || !type.includes("application/json");
}

/**
 * ブラウザ直結の失敗理由(Error.message)をUI向けの種別へ変換する。
 *  - cors_blocked: そのプロバイダはブラウザ直結できない(Frebuff/OpenAI/xAI)
 *  - network: 通信断・CORS遮断
 *  - それ以外(provider 401 など)は ai_failed とし、理由を detail に残す
 */
function directError(err: unknown): FissionApiError {
  const msg = err instanceof Error ? err.message : "";
  if (msg === "not_configured") return new FissionApiError("not_configured");
  if (msg === "cors_blocked") return new FissionApiError("cors_blocked");
  if (msg === "model_not_found") {
    return new FissionApiError("ai_failed", "利用できるモデルを決められませんでした。設定でモデル名を指定してください。");
  }
  if (msg === "cors_or_network") return new FissionApiError("network");
  return new FissionApiError("ai_failed", msg || undefined);
}

/** Workerが使えないとき、この端末のキーでプロバイダへ直接つなぐ。 */
async function viaDirect<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw directError(e);
  }
}

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

/** Worker のエラー応答から種別と理由を取り出す。 */
async function workerError(res: Response): Promise<FissionApiError> {
  let kind: FissionError = res.status === 503 ? "not_configured" : "ai_failed";
  let detail: string | undefined;
  try {
    const json = (await res.json()) as { error?: string; detail?: string };
    if (json.error && ["not_configured", "ai_failed", "bad_request"].includes(json.error)) {
      kind = json.error as FissionError;
    }
    if (typeof json.detail === "string" && json.detail.trim()) detail = json.detail.trim();
  } catch {
    // 本文なし; ステータスコードを優先
  }
  return new FissionApiError(kind, detail);
}

export async function requestFissionCandidates(payload: {
  parent: { title: string; description?: string };
  ancestors: string[];
  siblings: string[];
  depth: number;
}): Promise<AICandidate[]> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/ai/fission"), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    return viaDirect(() => directFission(payload));
  }
  if (notWorkerApi(res)) {
    return viaDirect(() => directFission(payload));
  }
  if (!res.ok) throw await workerError(res);
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
    res = await fetch(apiUrl("/api/ai/reflection"), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    return viaDirect(() => directReflection(payload));
  }
  if (notWorkerApi(res)) {
    return viaDirect(() => directReflection(payload));
  }
  if (!res.ok) throw await workerError(res);
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

/** 目標づくりのヒント(AI生成)。他の利用者のデータは送らない。 */
export async function requestIdeaHints(payload: IdeaRequestPayload): Promise<GoalIdea[]> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/ai/ideas"), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    return viaDirect(() => directIdeas(payload));
  }
  if (notWorkerApi(res)) return viaDirect(() => directIdeas(payload));
  if (!res.ok) throw await workerError(res);
  const json = (await res.json()) as {
    ideas?: Array<{ title?: unknown; why?: unknown }>;
  };
  const ideas = (json.ideas ?? [])
    .filter((i) => typeof i?.title === "string")
    .map((i) => ({ title: String(i.title ?? "").trim(), why: String(i.why ?? "").trim() }))
    .filter((i) => i.title.length > 0)
    .slice(0, 6);
  if (ideas.length === 0) throw new FissionApiError("ai_failed", "例を取得できませんでした");
  return ideas;
}

/**
 * 予定に合わせた音楽の提案をAIに依頼する。
 * 失敗時は例外(FissionApiError)を投げ、呼び出し側で端末内候補へ切り替える。
 */
export async function requestMusicSuggestions(
  payload: MusicRequestPayload
): Promise<{ mood: string; summary: string; tracks: MusicTrack[] }> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/ai/music"), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    return viaDirect(() => directMusic(payload));
  }
  if (notWorkerApi(res)) return viaDirect(() => directMusic(payload));
  if (!res.ok) throw await workerError(res);
  const json = (await res.json()) as {
    mood?: string;
    summary?: string;
    tracks?: Array<{ title?: unknown; artist?: unknown; reason?: unknown }>;
  };
  const tracks: MusicTrack[] = (json.tracks ?? [])
    .filter((t) => typeof t?.title === "string")
    .map((t) => ({
      title: String(t.title ?? "").trim(),
      artist: String(t.artist ?? "").trim(),
      reason: String(t.reason ?? "").trim(),
    }))
    .filter((t) => t.title.length > 0)
    .slice(0, 5);
  if (tracks.length === 0) {
    throw new FissionApiError("ai_failed", "音楽の候補を取得できませんでした");
  }
  return {
    mood: String(json.mood ?? "").trim() || "おまかせ",
    summary: String(json.summary ?? "").trim(),
    tracks,
  };
}

/** 設定画面用:実際に生成できるかを確認する(キーものは返さない)。 */
export async function requestAIStatus(): Promise<{
  configured: boolean;
  ok: boolean;
  model: string | null;
  error: string | null;
  envConfigured: boolean;
}> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/ai/status"), { headers: jsonHeaders() });
  } catch {
    return directStatus();
  }
  // /api が無いホストでは HTML が返るので、その端末のキーで直結確認する
  if (notWorkerApi(res)) return directStatus();
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
}
