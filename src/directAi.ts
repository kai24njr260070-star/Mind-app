import type { AICandidate } from "./types";
import {
  PROVIDER_BASES,
  PROVIDER_FALLBACK_MODELS,
  fissionRequestBody,
  normBase,
  parseCandidates,
  parseReflection,
  reflectionRequestBody,
  type FissionRequestPayload,
  type ParsedReflectionAction,
  type ReflectionRequestPayload,
} from "./aiShared";

/**
 * ブラウザ直結のAI呼び出し。
 * Cloudflare Pages のような静的配信では /api/ai/* が存在しないため、
 * この端末(localStorage)のキーでプロバイダへ直接つなぐ。
 * ※Groq / Gemini など CORS を許可しているプロバイダでのみ動く。
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

/** ブラウザ直結に必要な情報が揃っていれば返す(キー未入力なら null)。 */
export function browserAIConfig(): BrowserAIConfig | null {
  const s = readSettings();
  const key = typeof s.apiKey === "string" ? s.apiKey.trim() : "";
  if (!key) return null;
  const provider = (typeof s.providerId === "string" && s.providerId) || "freebuff";
  const baseUrl = normBase(PROVIDER_BASES[provider] ?? PROVIDER_BASES.freebuff);
  const hint = typeof s.aiModel === "string" ? s.aiModel.trim() : "";
  const model = hint || PROVIDER_FALLBACK_MODELS[provider] || "";
  if (!model) return null;
  return { provider, key, model, baseUrl };
}

async function chat(cfg: BrowserAIConfig, body: Record<string, unknown>): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("cors_or_network");
  }
  if (!res.ok) throw new Error(`provider ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

export async function directFission(payload: FissionRequestPayload): Promise<AICandidate[]> {
  const cfg = browserAIConfig();
  if (!cfg) throw new Error("not_configured");
  const content = await chat(cfg, fissionRequestBody(cfg.model, payload));
  return parseCandidates(content);
}

export async function directReflection(payload: ReflectionRequestPayload): Promise<{
  summary: string;
  actions: ParsedReflectionAction[];
}> {
  const cfg = browserAIConfig();
  if (!cfg) throw new Error("not_configured");
  const content = await chat(cfg, reflectionRequestBody(cfg.model, payload));
  return parseReflection(content);
}

/** 設定画面の「接続テスト」(直結)。キーそのものは返さない。 */
export async function directStatus(): Promise<{
  configured: boolean;
  ok: boolean;
  model: string | null;
  error: string | null;
  envConfigured: boolean;
}> {
  const cfg = browserAIConfig();
  if (!cfg) {
    return { configured: false, ok: false, model: null, error: null, envConfigured: false };
  }
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.key}` },
    });
    if (res.ok) {
      return { configured: true, ok: true, model: cfg.model, error: null, envConfigured: false };
    }
    // 一覧APIを持たない/権限が無いプロバイダは、ごく小さなchatで確認する
    await chat(cfg, { model: cfg.model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] });
    return { configured: true, ok: true, model: cfg.model, error: null, envConfigured: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return { configured: true, ok: false, model: cfg.model, error: msg, envConfigured: false };
  }
}
