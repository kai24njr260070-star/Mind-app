import type { AICandidate } from "./types";

/**
 * プロバイダ定義とプロンプト・パース処理の共有モジュール。
 * Worker(サーバー経由)と ブラウザ直結(静的ホスティング時)の両方から使う。
 */

/** 既定のベースURL(いずれも OpenAI互換 chat/completions)。 */
export const PROVIDER_BASES: Record<string, string> = {
  freebuff: "https://freebuff.com/api/v1/paid",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  grok: "https://api.x.ai/v1",
};

/** モデル一覧が取れない場合のフォールバック(空=自動選択必須)。 */
export const PROVIDER_FALLBACK_MODELS: Record<string, string> = {
  freebuff: "",
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  grok: "grok-3-mini",
};

export function normBase(base: string): string {
  return base.replace(/\/+$/, "");
}

export const FISSION_SYSTEM_PROMPT = `あなたは Mind Signature の「Element Fission(目標分裂)」アシスタントです。
ユーザーの親目標を達成するための中間目標候補を、必ず2つ提案します。

ルール:
- 候補は親目標の達成に貢献し、抽象度を必ず1段階下げる。
- 2つの候補が重複しないよう、担う領域を明確に分ける。
- ユーザーが決めていない情報(技術選定、予定など)を勝手に確定しない。
- 各候補の title は20文字以内、description は35文字以内の1文。
- 目標が既に「行動1回で終わる」規模なら、これ以上分裂させる必要のない具体レベルを提案する。
- 出力はJSONのみ。説明文は書かない。
- 形式: {"candidates":[{"title":"...","description":"..."}]}`;

export const REFLECTION_SYSTEM_PROMPT = `あなたは Mind Signature の「Reflection」アシスタントです。
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

export interface FissionRequestPayload {
  parent?: { title?: string; description?: string };
  ancestors?: string[];
  siblings?: string[];
  depth?: number;
}

export interface ReflectionGoalInput {
  idx?: number;
  title?: string;
  status?: string;
  deadline?: string;
  childCount?: number;
  daysOld?: number;
}

export interface ReflectionRequestPayload {
  goals?: ReflectionGoalInput[];
  memos?: Array<{ date?: string; content?: string }>;
  today?: string;
}

/** 分裂プロンプトに渡す文脈行。 */
export function fissionContextLines(payload: FissionRequestPayload): string {
  const parentTitle = String(payload.parent?.title ?? "").trim();
  const ancestors = (payload.ancestors ?? []).filter((t) => typeof t === "string").slice(0, 8);
  const siblings = (payload.siblings ?? []).filter((t) => typeof t === "string").slice(0, 12);
  const depth = Number.isFinite(payload.depth) ? Number(payload.depth) : 0;
  return [
    `親目標: ${parentTitle}`,
    ancestors.length > 0 ? `上位の目標(ルート側): ${ancestors.join(" > ")}` : "",
    siblings.length > 0 ? `既に確定済みの兄弟目標(これと重複しないこと): ${siblings.join(" / ")}` : "",
    depth >= 3 ? "この目標は浅い階層にある。行動レベルの具体的な候補にすること。" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 振り返りプロンプトに渡すユーザー行。 */
export function reflectionContextLines(payload: ReflectionRequestPayload): string {
  const todayStr = String(payload.today ?? "").slice(0, 10);
  const goals = (payload.goals ?? []).slice(0, 30);
  const memos = (payload.memos ?? []).slice(0, 12);
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
  return `今日: ${todayStr}\n\n目標リスト:\n${goalLines}\n\n直近のメモ:\n${memoLines}`;
}

/** chat/completions に送るリクエストボディ(分裂)。 */
export function fissionRequestBody(model: string, payload: FissionRequestPayload): Record<string, unknown> {
  return {
    model,
    temperature: 0.8,
    max_tokens: 600,
    messages: [
      { role: "system", content: FISSION_SYSTEM_PROMPT },
      { role: "user", content: fissionContextLines(payload) },
    ],
  };
}

/** chat/completions に送るリクエストボディ(振り返り)。 */
export function reflectionRequestBody(model: string, payload: ReflectionRequestPayload): Record<string, unknown> {
  return {
    model,
    temperature: 0.6,
    max_tokens: 700,
    messages: [
      { role: "system", content: REFLECTION_SYSTEM_PROMPT },
      { role: "user", content: reflectionContextLines(payload) },
    ],
  };
}

export function parseCandidates(content: string): AICandidate[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json");
  const parsed: unknown = JSON.parse(content.slice(start, end + 1));
  const raw = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(raw)) throw new Error("bad shape");
  return raw
    .filter((c): c is { title?: unknown; description?: unknown } => typeof c === "object" && c !== null)
    .map((c) => ({
      title: String(c.title ?? "").trim(),
      description: String(c.description ?? "").trim(),
    }))
    .filter((c) => c.title.length > 0)
    .slice(0, 2);
}

export type ReflectionKind = "split" | "reschedule" | "focus" | "rest";

export interface ParsedReflectionAction {
  goalIdx?: number;
  kind: ReflectionKind;
  label: string;
  days?: number;
}

export function parseReflection(content: string): {
  summary: string;
  actions: ParsedReflectionAction[];
} {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json");
  const parsed = JSON.parse(content.slice(start, end + 1)) as { summary?: unknown; actions?: unknown };
  const kinds = new Set<string>(["split", "reschedule", "focus", "rest"]);
  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions = rawActions
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .filter((a) => kinds.has(String(a.kind)))
    .map((a) => ({
      goalIdx: typeof a.goalIdx === "number" ? a.goalIdx : undefined,
      kind: String(a.kind) as ReflectionKind,
      label: String(a.label ?? "").slice(0, 120),
      days: typeof a.days === "number" && Number.isFinite(a.days) ? Math.round(a.days) : undefined,
    }))
    .filter((a) => a.label.length > 0)
    .slice(0, 3);
  return { summary: String(parsed.summary ?? "").trim(), actions };
}
