import type { AICandidate } from "./types";
import {
  PROVIDER_BASES,
  PROVIDER_FALLBACK_MODELS,
  fissionRequestBody,
  normBase,
  parseCandidates,
  parseReflection,
  pickChatModel,
  reflectionRequestBody,
  supportsBrowserDirect,
  type FissionRequestPayload,
  type ParsedReflectionAction,
  type ReflectionRequestPayload,
} from "./aiShared";

/**
 * ブラウザ直結のAI呼び出し。
 * Cloudflare Pages のような静的配信では /api/ai/* が存在しないため、
 * この端末(localStorage)のキーでプロバイダへ直接つなぐ。
 * ※CORSを許可しているプロバイダ(Groq / Gemini)でのみ動く。
 */

const SETTINGS_KEY = "mind-signature-settings-v1";

export interface BrowserAIConfig {
  provider: string;
  key: string;
  model: string;
  baseUrl: string;
}

function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 設定からプロバイダ情報を読む(キーが無ければ null)。 */
function readConfig(): { provider: string; key: string; hint: string; baseUrl: string } | null {
  const s = readSettings();
  const key = typeof s.apiKey === "string" ? s.apiKey.trim() : "";
  if (!key) return null;
  const provider = (typeof s.providerId === "string" && s.providerId) || "freebuff";
  const hint = typeof s.aiModel === "string" ? s.aiModel.trim() : "";
  const baseUrl = normBase(PROVIDER_BASES[provider] ?? PROVIDER_BASES.freebuff);
  return { provider, key, hint, baseUrl };
}

async function listModels(cfg: { baseUrl: string; key: string }): Promise<string[]> {
  const res = await fetch(`${cfg.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${cfg.key}` },
  });
  if (!res.ok) throw new Error(`models ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * ブラウザ直結に必要な情報を解決する。
 * 失敗理由は Error の message に短いコードで入れる(api.ts が UI 用に変換する)。
 *  - not_configured: キー未入力
 *  - cors_blocked: このプロバイダはブラウザから直接呼べない(Freebuff/OpenAI/xAI)
 */
async function resolveBrowserAIConfig(): Promise<BrowserAIConfig> {
  const cfg = readConfig();
  if (!cfg) throw new Error("not_configured");
  if (!supportsBrowserDirect(cfg.provider)) throw new Error("cors_blocked");

  let model = cfg.hint || PROVIDER_FALLBACK_MODELS[cfg.provider] || "";
  if (!model) {
    try {
      model = pickChatModel(await listModels(cfg), cfg.provider) ?? "";
    } catch {
      // 一覧が取れない場合は下でエラーにする
    }
  }
  if (!model) throw new Error("model_not_found");
  return { provider: cfg.provider, key: cfg.key, model, baseUrl: cfg.baseUrl };
}

type ChatResult = { ok: true; content: string } | { ok: false; detail: string };

async function chat(
  cfg: BrowserAIConfig,
  body: Record<string, unknown>
): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
    });
  } catch {
    // CORSで遮断された場合もブラウザは TypeError になる
    return { ok: false, detail: "cors_or_network" };
  }
  if (!res.ok) {
    let text = "";
    try {
      text = (await res.text()).slice(0, 200).replace(/\s+/g, " ").trim();
    } catch {
      // 本文なし
    }
    return { ok: false, detail: `provider ${res.status}${text ? `: ${text}` : ""}` };
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return { ok: true, content: json.choices?.[0]?.message?.content ?? "" };
}

export async function directFission(payload: FissionRequestPayload): Promise<AICandidate[]> {
  const cfg = await resolveBrowserAIConfig();
  const res = await chat(cfg, fissionRequestBody(cfg.model, payload));
  if (!res.ok) throw new Error(res.detail);
  return parseCandidates(res.content);
}

export async function directReflection(payload: ReflectionRequestPayload): Promise<{
  summary: string;
  actions: ParsedReflectionAction[];
}> {
  const cfg = await resolveBrowserAIConfig();
  const res = await chat(cfg, reflectionRequestBody(cfg.model, payload));
  if (!res.ok) throw new Error(res.detail);
  return parseReflection(res.content);
}

/** 設定画面の「接続テスト」(直結)。実際の生成と同じ小さな chat で確認する。 */
export async function directStatus(): Promise<{
  configured: boolean;
  ok: boolean;
  model: string | null;
  error: string | null;
  envConfigured: boolean;
}> {
  const cfg = readConfig();
  if (!cfg) {
    return { configured: false, ok: false, model: null, error: null, envConfigured: false };
  }
  if (!supportsBrowserDirect(cfg.provider)) {
    return {
      configured: true,
      ok: false,
      model: cfg.hint || null,
      error: "cors_blocked",
      envConfigured: false,
    };
  }
  try {
    const resolved = await resolveBrowserAIConfig();
    const res = await chat(resolved, {
      model: resolved.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    if (!res.ok) {
      return {
        configured: true,
        ok: false,
        model: resolved.model,
        error: res.detail,
        envConfigured: false,
      };
    }
    return {
      configured: true,
      ok: true,
      model: resolved.model,
      error: null,
      envConfigured: false,
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      model: null,
      error: e instanceof Error ? e.message : "unknown",
      envConfigured: false,
    };
  }
}
