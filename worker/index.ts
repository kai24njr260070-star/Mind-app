/// <reference types="@cloudflare/workers-types" />

import {
  PROVIDER_BASES,
  PROVIDER_FALLBACK_MODELS,
  fissionRequestBody,
  ideaRequestBody,
  musicRequestBody,
  parseCandidates,
  parseIdeas,
  parseMusic,
  parseReflection,
  pickChatModel,
  reflectionRequestBody,
  type FissionRequestPayload,
  type IdeaRequestPayload,
  type MusicRequestPayload,
  type ReflectionRequestPayload,
} from "../src/aiShared";

export interface Env {
  OPENAI_API_KEY?: string;
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  XAI_API_KEY?: string;
  FREEBUFF_MODEL?: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

// プロバイダ定義・プロンプト・パースは ブラウザ直結経路と共有する(src/aiShared.ts)。
const DEFAULT_BASES = PROVIDER_BASES;

/**
 * 環境変数キーの割当(provider → env キー名)。
 * Cloudflare の Secrets / .dev.vars に置けば、ブラウザにキーを入れずに使える。
 */
const ENV_KEYS: Record<string, keyof Env> = {
  freebuff: "OPENAI_API_KEY",
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  gemini: "GEMINI_API_KEY",
  grok: "XAI_API_KEY",
};

interface AIConfig {
  key: string | null;
  baseUrl: string;
  provider: string;
  modelHint: string | null;
}

/** リクエスト設定(設定画面→ヘッダ)を優先しつつキーを解決する。 */
function requestAIConfig(request: Request, env: Env): AIConfig {
  const provider = (request.headers.get("x-ai-provider") ?? "freebuff").toLowerCase();
  const headerKey = request.headers.get("x-ai-key")?.trim() ?? "";
  const headerModel = request.headers.get("x-ai-model")?.trim() ?? "";
  const envKey = String(env[ENV_KEYS[provider] ?? "OPENAI_API_KEY"] ?? "").trim();

  const baseUrl = normBaseUrl(DEFAULT_BASES[provider] ?? DEFAULT_BASES.freebuff);

  // 説明: headerKey(設定画面のキー)最優先。無ければ
  // 設定済みプロバイダの環境変数キー(Freebuff=OPENAI_API_KEY、Groq=GROQ_API_KEY)を使う。
  const key = headerKey || (provider in ENV_KEYS ? envKey : null);
  return { key: key || null, baseUrl, provider, modelHint: headerModel || env.FREEBUFF_MODEL || null };
}

function normBaseUrl(base: string): string {
  return base.replace(/\/+$/, "");
}

/** プロバイダの応答本文から、キーを含まない短い失敗理由を作る。 */
async function failureDetail(res: Response): Promise<string> {
  let text = "";
  try {
    text = (await res.text()).slice(0, 300).replace(/\s+/g, " ").trim();
  } catch {
    // 本文なし
  }
  return `provider ${res.status}${text ? `: ${text}` : ""}`;
}

async function listModels(base: string, key: string): Promise<string[]> {
  const res = await fetch(`${normBaseUrl(base)}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`models ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

// モデル一覧のキャッシュ(同じ isolate 内で繰り返し叩かない)。
const cachedModelsByBase = new Map<string, string[]>();

async function discoverModel(cfg: AIConfig): Promise<string | null> {
  if (!cfg.key) return null;
  const cacheKey = `${cfg.provider}:${cfg.baseUrl}:${cfg.key.slice(0, 6)}`;
  const cached = cachedModelsByBase.get(cacheKey);
  if (cached) return pickChatModel(cached, cfg.provider);
  try {
    const ids = await listModels(cfg.baseUrl, cfg.key);
    cachedModelsByBase.set(cacheKey, ids);
    return pickChatModel(ids, cfg.provider);
  } catch {
    // 一覧APIが無い/権限が無いプロバイダもある(フォールバックモデルで試す)
    return null;
  }
}

/**
 * 試すモデルの順番: 設定指定 → 一覧から自動選択 → プロバイダ既定。
 * (以前は baseUrl の末尾をモデル名にしていたため "paid" を送って失敗していた)
 */
async function resolveModels(cfg: AIConfig): Promise<string[]> {
  const models: string[] = [];
  const push = (model: string | null | undefined): void => {
    const m = String(model ?? "").trim();
    if (m && !models.includes(m)) models.push(m);
  };
  push(cfg.modelHint);
  if (!cfg.modelHint) push(await discoverModel(cfg));
  push(PROVIDER_FALLBACK_MODELS[cfg.provider]);
  return models;
}

type ChatResult =
  | { ok: true; content: string }
  | { ok: false; status: number; detail: string };

async function chatCompletion(
  cfg: AIConfig,
  body: Record<string, unknown>
): Promise<ChatResult> {
  if (!cfg.key) return { ok: false, status: 0, detail: "not_configured" };
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, detail: await failureDetail(res) };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return { ok: true, content: json.choices?.[0]?.message?.content ?? "" };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      detail: e instanceof Error ? `network: ${e.message}` : "network",
    };
  }
}

/** モデル違い(400/404/422)なら次の候補を試す価値がある。 */
function shouldRetryWithNextModel(status: number): boolean {
  return status === 400 || status === 404 || status === 422;
}

type FissionRequestBody = FissionRequestPayload;

async function handleFission(request: Request, env: Env): Promise<Response> {
  const cfg = requestAIConfig(request, env);
  if (!cfg.key || !cfg.baseUrl) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  let body: FissionRequestBody;
  try {
    body = (await request.json()) as FissionRequestBody;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const parentTitle = String(body.parent?.title ?? "").trim();
  if (!parentTitle) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const models = await resolveModels(cfg);
  if (models.length === 0) {
    return Response.json(
      { error: "ai_failed", detail: "モデルを決定できませんでした" },
      { status: 502 }
    );
  }

  let detail = "";
  for (const model of models) {
    const result = await chatCompletion(cfg, fissionRequestBody(model, body));
    if (!result.ok) {
      detail = `${model} → ${result.detail}`;
      if (shouldRetryWithNextModel(result.status)) continue;
      break;
    }
    try {
      const candidates = parseCandidates(result.content);
      if (candidates.length > 0) return Response.json({ candidates });
      detail = `${model} → 候補を解析できませんでした`;
    } catch {
      detail = `${model} → JSON以外の応答`;
    }
  }

  return Response.json({ error: "ai_failed", detail }, { status: 502 });
}

type ReflectionRequestBody = ReflectionRequestPayload;

async function handleReflection(request: Request, env: Env): Promise<Response> {
  const cfg = requestAIConfig(request, env);
  if (!cfg.key || !cfg.baseUrl) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  let body: ReflectionRequestBody;
  try {
    body = (await request.json()) as ReflectionRequestBody;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const goals = (body.goals ?? []).slice(0, 30);
  if (goals.length === 0) {
    // 目標が無い場合も怠惰ではない。静かに待機を返すだけでよい
    return Response.json({
      summary: "まだ宇宙に目標がありません。最初の目標をひとつ入力すると、AIが分裂候補を出します。",
      actions: [],
    });
  }

  const models = await resolveModels(cfg);
  if (models.length === 0) {
    return Response.json(
      { error: "ai_failed", detail: "モデルを決定できませんでした" },
      { status: 502 }
    );
  }

  let detail = "";
  for (const model of models) {
    const result = await chatCompletion(
      cfg,
      reflectionRequestBody(model, { ...body, goals })
    );
    if (!result.ok) {
      detail = `${model} → ${result.detail}`;
      if (shouldRetryWithNextModel(result.status)) continue;
      break;
    }
    try {
      return Response.json(parseReflection(result.content));
    } catch {
      detail = `${model} → JSON以外の応答`;
    }
  }

  return Response.json({ error: "ai_failed", detail }, { status: 502 });
}

/**
 * 目標づくりのヒント。他の利用者のデータは使わず、AIに一般的な例を作らせる。
 */
async function handleIdeas(request: Request, env: Env): Promise<Response> {
  const cfg = requestAIConfig(request, env);
  if (!cfg.key || !cfg.baseUrl) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  let body: IdeaRequestPayload;
  try {
    body = (await request.json()) as IdeaRequestPayload;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const models = await resolveModels(cfg);
  if (models.length === 0) {
    return Response.json({ error: "ai_failed", detail: "モデルを決定できませんでした" }, { status: 502 });
  }

  let detail = "";
  for (const model of models) {
    const result = await chatCompletion(cfg, ideaRequestBody(model, body));
    if (!result.ok) {
      detail = `${model} → ${result.detail}`;
      if (shouldRetryWithNextModel(result.status)) continue;
      break;
    }
    try {
      return Response.json({ ideas: parseIdeas(result.content) });
    } catch {
      detail = `${model} → 例を解析できませんでした`;
    }
  }

  return Response.json({ error: "ai_failed", detail }, { status: 502 });
}

/**
 * 予定に合わせた音楽の提案。Apple Music の検索リンクで開く(曲の再生はしない)。
 */
async function handleMusic(request: Request, env: Env): Promise<Response> {
  const cfg = requestAIConfig(request, env);
  if (!cfg.key || !cfg.baseUrl) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  let body: MusicRequestPayload;
  try {
    body = (await request.json()) as MusicRequestPayload;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!String(body.goalTitle ?? "").trim()) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const models = await resolveModels(cfg);
  if (models.length === 0) {
    return Response.json(
      { error: "ai_failed", detail: "モデルを決定できませんでした" },
      { status: 502 }
    );
  }

  let detail = "";
  for (const model of models) {
    const result = await chatCompletion(cfg, musicRequestBody(model, body));
    if (!result.ok) {
      detail = `${model} → ${result.detail}`;
      if (shouldRetryWithNextModel(result.status)) continue;
      break;
    }
    try {
      return Response.json(parseMusic(result.content));
    } catch {
      detail = `${model} → 曲の候補を解析できませんでした`;
    }
  }

  return Response.json({ error: "ai_failed", detail }, { status: 502 });
}

/**
 * 設定画面の「接続テスト」用。
 * 実際の生成と同じモデルで小さな chat を1回だけ呼び、生成できることまで確認する。
 * (以前は /models が取れるだけで OK にしていたため、生成だけ失敗する状態を見逃していた)
 */
async function handleStatus(request: Request, env: Env): Promise<Response> {
  const cfg = requestAIConfig(request, env);
  const envConfigured = Boolean(
    env.OPENAI_API_KEY?.trim() ||
      env.GROQ_API_KEY?.trim() ||
      env.GEMINI_API_KEY?.trim() ||
      env.XAI_API_KEY?.trim()
  );
  if (!cfg.key || !cfg.baseUrl) {
    return Response.json({ configured: false, ok: false, model: null, error: null, envConfigured });
  }

  const models = await resolveModels(cfg);
  let detail = "モデルを決定できませんでした";
  for (const model of models) {
    const result = await chatCompletion(cfg, {
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    if (result.ok) {
      return Response.json({ configured: true, ok: true, model, error: null, envConfigured });
    }
    detail = `${model} → ${result.detail}`;
    if (!shouldRetryWithNextModel(result.status)) break;
  }

  return Response.json({
    configured: true,
    ok: false,
    model: models[0] ?? null,
    error: detail,
    envConfigured,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/ai/status" && request.method === "GET") {
        return await handleStatus(request, env);
      }
      if (url.pathname === "/api/ai/fission" && request.method === "POST") {
        return await handleFission(request, env);
      }
      if (url.pathname === "/api/ai/reflection" && request.method === "POST") {
        return await handleReflection(request, env);
      }
      if (url.pathname === "/api/ai/music" && request.method === "POST") {
        return await handleMusic(request, env);
      }
      if (url.pathname === "/api/ai/ideas" && request.method === "POST") {
        return await handleIdeas(request, env);
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
