/// <reference types="@cloudflare/workers-types" />

import {
  PROVIDER_BASES,
  PROVIDER_FALLBACK_MODELS,
  fissionRequestBody,
  parseCandidates,
  parseReflection,
  reflectionRequestBody,
  type FissionRequestPayload,
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
const FALLBACK_MODELS = PROVIDER_FALLBACK_MODELS;

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

async function listModels(base: string, key: string): Promise<string[]> {
  const res = await fetch(`${normBaseUrl(base)}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`models ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .map((id) => id.replace(/^models\//, "")); // Gemini互換の models/ 接頭辞を外す
}

function pickLightModel(ids: string[]): string | null {
  return ids.find((id) => /mini|flash|lite|smallest/i.test(id)) ?? ids[0] ?? null;
}

let cachedModelByBase = new Map<string, string>();

/** modelHint(設定指定) → 自動選択(一覧) → プロバイダ別フォールバック の順で決める。 */
async function resolveModel(cfg: AIConfig): Promise<string | null> {
  if (cfg.modelHint) return cfg.modelHint;
  if (cfg.key && cfg.baseUrl) {
    const cacheKey = `${cfg.provider}:${cfg.baseUrl}:${cfg.key.slice(0, 6)}`;
    const cached = cachedModelByBase.get(cacheKey);
    if (cached) return cached;
    try {
      const ids = await listModels(cfg.baseUrl, cfg.key);
      const picked = pickLightModel(ids);
      if (picked) {
        cachedModelByBase.set(cacheKey, picked);
        return picked;
      }
    } catch {
      // 一覧取得不可のプロバイダもある(下のフォールバックへ)
    }
  }
  const fallback = FALLBACK_MODELS[cfg.provider];
  if (fallback) return fallback;
  // custom などでモデルが決められない場合
  if (cfg.baseUrl) {
    // base URL の末尾がモデル名になっている形式(model:xxx)を許容
    const asModel = cfg.baseUrl.split("/").pop();
    if (asModel && /[\w.-]/.test(asModel)) return asModel;
  }
  return null;
}

type FissionRequestBody = FissionRequestPayload;

async function handleFission(request: Request, env: Env): Promise<Response> {
  const cfg = requestAIConfig(request, env);
  if (!cfg.key || !cfg.baseUrl) {
    return Response.json(
      { error: "not_configured" },
      { status: 503 }
    );
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

  const model = await resolveModel(cfg);
  if (!model) {
    return Response.json({ error: "ai_failed" }, { status: 502 });
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fissionRequestBody(model, body)),
    });
    if (!res.ok) {
      return Response.json({ error: "ai_failed" }, { status: 502 });
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    const candidates = parseCandidates(content);
    if (candidates.length === 0) {
      return Response.json({ error: "ai_failed" }, { status: 502 });
    }
    return Response.json({ candidates });
  } catch {
    return Response.json({ error: "ai_failed" }, { status: 502 });
  }
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
  const model = await resolveModel(cfg);
  if (!model) {
    return Response.json({ error: "ai_failed" }, { status: 502 });
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reflectionRequestBody(model, { ...body, goals })),
    });
    if (!res.ok) {
      return Response.json({ error: "ai_failed" }, { status: 502 });
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = parseReflection(content);
    return Response.json(parsed);
  } catch {
    return Response.json({ error: "ai_failed" }, { status: 502 });
  }
}

/** 設定画面の「接続テスト」用:キー/base/modelの有効性をキー其の物は返さず確認する。 */
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
  try {
    const model = await resolveModel({ ...cfg, modelHint: cfg.modelHint });
    if (!model) {
      return Response.json({ configured: true, ok: false, model: null, error: "model_not_found", envConfigured });
    }
    // 実際に models 一覧が取れたかで成功判定(課金なし)
    let ok = false;
    try {
      await listModels(cfg.baseUrl, cfg.key!);
      ok = true;
    } catch {
      // 一覧APIを持たない場合(Gemini互換も含む)は、ごく小さなchat呼び出しで検証
      try {
        const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.key!}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
    }
    return Response.json({ configured: true, ok, model, error: ok ? null : "probe_failed", envConfigured });
  } catch (e) {
    return Response.json({
      configured: true,
      ok: false,
      model: null,
      error: e instanceof Error ? e.message : "unknown",
      envConfigured,
    });
  }
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
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
