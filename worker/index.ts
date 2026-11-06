/// <reference types="@cloudflare/workers-types" />

export interface Env {
  OPENAI_API_KEY?: string;
  GROQ_API_KEY?: string;
  FREEBUFF_MODEL?: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

// Freebuff AI(OpenAI互換)_base URL。鍵はオーナーのもの。ブラウザには絶対に出さない。
const API_BASE = "https://freebuff.com/api/v1/paid";

/**
 * 対応プロバイダ。いずれも OpenAI互換(chat/completions + Bearer)のため
 * base URL とキー差し替えだけで動く。
 */
const DEFAULT_BASES: Record<string, string> = {
  freebuff: API_BASE,
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  grok: "https://api.x.ai/v1",
};

// モデル一覧の取得に失敗した場合のフォールバック(空=自動選択必須)
const FALLBACK_MODELS: Record<string, string> = {
  freebuff: "",
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  grok: "grok-3-mini",
};

/** 環境変数キーの割当(provider → env キー名)。base URLの設定が無い場合の既定。 */
const ENV_KEYS: Record<string, "OPENAI_API_KEY" | "GROQ_API_KEY"> = {
  freebuff: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
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
  const envKey = (env[ENV_KEYS[provider] ?? "OPENAI_API_KEY"] ?? "").trim();

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

const SYSTEM_PROMPT = `あなたは Mind Signature の「Element Fission(目標分裂)」アシスタントです。
ユーザーの親目標を達成するための中間目標候補を、必ず2つ提案します。

ルール:
- 候補は親目標の達成に貢献し、抽象度を必ず1段階下げる。
- 2つの候補が重複しないよう、担う領域を明確に分ける。
- ユーザーが決めていない情報(技術選定、予定など)を勝手に確定しない。
- 各候補の title は20文字以内、description は35文字以内の1文。
- 目標が既に「行動1回で終わる」規模なら、これ以上分裂させる必要のない具体レベルを提案する。
- 出力はJSONのみ。説明文は書かない。
- 形式: {"candidates":[{"title":"...","description":"..."}]}`;

interface FissionRequestBody {
  parent?: { title?: string; description?: string };
  ancestors?: string[];
  siblings?: string[];
  depth?: number;
}

function parseCandidates(content: string): Array<{ title: string; description: string }> {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json");
  const parsed: unknown = JSON.parse(content.slice(start, end + 1));
  const raw = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(raw)) throw new Error("bad shape");
  return raw
    .filter(
      (c): c is { title?: unknown; description?: unknown } =>
        typeof c === "object" && c !== null
    )
    .map((c) => ({
      title: String(c.title ?? "").trim(),
      description: String(c.description ?? "").trim(),
    }))
    .filter((c) => c.title.length > 0)
    .slice(0, 2);
}

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

  const ancestors = (body.ancestors ?? []).filter((t) => typeof t === "string").slice(0, 8);
  const siblings = (body.siblings ?? []).filter((t) => typeof t === "string").slice(0, 12);
  const depth = Number.isFinite(body.depth) ? Number(body.depth) : 0;

  const contextLines = [
    `親目標: ${parentTitle}`,
    ancestors.length > 0 ? `上位の目標(ルート側): ${ancestors.join(" > ")}` : "",
    siblings.length > 0 ? `既に確定済みの兄弟目標(これと重複しないこと): ${siblings.join(" / ")}` : "",
    depth >= 3 ? "この目標は浅い階層にある。行動レベルの具体的な候補にすること。" : "",
  ]
    .filter(Boolean)
    .join("\n");

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
      body: JSON.stringify({
        model,
        temperature: 0.8,
        max_tokens: 600,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: contextLines },
        ],
      }),
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

const REFLECTION_PROMPT = `あなたは Mind Signature の「Reflection」アシスタントです。
ユーザーを評価・批判せず、計画をユーザーに合わせて調整する提案のみを行います。

ルール:
- summary は今日の状況を穏やかにまとめた2〜3文(日本語)。
- 変更は必ず提案として示し、実行はユーザーの承認後であることを前提にする。
- actions は最大3つ。kind は split(目標をさらに分裂) / reschedule(期限の延期) / focus(今日の一歩) / rest(休む) のいずれか。
- split と reschedule は goalIdx(渡した目標リストの番号)を必ず指定する。
- reschedule は days(延ばす日数、1〜90)も指定する。期限超過を人格的な失敗として扱わない。
- label は日本語で80文字以内の具体的な提案文。
- 短期間のログだけで挫折・意欲低下を断定しない。
- 出力はJSONのみ。形式: {"summary":"...","actions":[{"goalIdx":0,"kind":"split","label":"...","days":7}]}`;

interface ReflectionRequestBody {
  goals?: ReflectionContextGoalInput[];
  memos?: Array<{ date?: string; content?: string }>;
  today?: string;
}

interface ReflectionContextGoalInput {
  idx?: number;
  title?: string;
  status?: string;
  deadline?: string;
  childCount?: number;
  daysOld?: number;
}

function parseReflection(content: string): { summary: string; actions: Array<{ goalIdx?: number; kind: string; label: string; days?: number }> } {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json");
  const parsed = JSON.parse(content.slice(start, end + 1)) as {
    summary?: unknown;
    actions?: unknown;
  };
  const kinds = new Set(["split", "reschedule", "focus", "rest"]);
  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions = rawActions
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .filter((a) => kinds.has(String(a.kind)))
    .map((a) => ({
      goalIdx: typeof a.goalIdx === "number" ? a.goalIdx : undefined,
      kind: String(a.kind),
      label: String(a.label ?? "").slice(0, 120),
      days: typeof a.days === "number" && Number.isFinite(a.days) ? Math.round(a.days) : undefined,
    }))
    .filter((a) => a.label.length > 0)
    .slice(0, 3);
  return { summary: String(parsed.summary ?? "").trim(), actions };
}

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
  const memos = (body.memos ?? []).slice(0, 5);
  const todayStr = typeof body.today === "string" ? body.today : "";

  const goalLines = goals
    .map((g) => {
      const idx = typeof g.idx === "number" ? g.idx : 0;
      const dl = typeof g.deadline === "string" ? ` 期限:${g.deadline}` : "";
      const stale = typeof g.daysOld === "number" && g.daysOld >= 7 ? `${g.daysOld}日経過` : "";
      return `[${idx}] ${String(g.title ?? "").slice(0, 60)} (status:${String(g.status ?? "active")}, 子目標:${Number.isFinite(g.childCount) ? g.childCount : 0}${dl} ${stale})`;
    })
    .join("\n");
  const memoLines = memos.length
    ? memos.map((m) => `${String(m.date ?? "")}: ${String(m.content ?? "").slice(0, 120)}`).join("\n")
    : "(メモはまだありません)";

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
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: 700,
        messages: [
          { role: "system", content: REFLECTION_PROMPT },
          { role: "user", content: `今日: ${todayStr}\n\n目標リスト:\n${goalLines}\n\n直近のメモ:\n${memoLines}` },
        ],
      }),
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
  const envConfigured = Boolean(env.OPENAI_API_KEY?.trim() || env.GROQ_API_KEY?.trim());
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
