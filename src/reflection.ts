import type { Goal, Memo, Reflection, ReflectionAction } from "./types";
import {
  FissionApiError,
  requestReflection,
  type ReflectionContextGoal,
} from "./api";
import { getGoal, recordReflection } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(iso: string | number): number {
  const t = typeof iso === "number" ? iso : new Date(`${iso}T00:00:00Z`).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}

function childCountOf(goals: Goal[], id: string): number {
  return goals.filter((g) => g.parentId === id && g.status === "active").length;
}

/** spec §7.2 相当の停滞検知。断定はせず「可能性」として扱う。 */
export function detectStagnation(
  goals: Goal[],
  memos: Memo[]
): { overdue: Goal[]; stagnant: Goal[]; troubledMemoCount: number } {
  const t = today();
  const overdue = goals.filter(
    (g) => g.status === "active" && g.deadline && g.deadline < t
  );
  // 子を持たない行動レベルの目標が1週間以上残っている状態
  const stagnant = goals.filter(
    (g) => g.status === "active" && childCountOf(goals, g.id) === 0 && daysSince(g.createdAt) >= 7
  );
  const words = ["難しい", "分からない", "わからない", "止ま", "つまず", "エラー", "進まな"];
  const cutoff = new Date(Date.now() - 3 * DAY_MS).toISOString().slice(0, 10);
  const troubledMemoCount = memos.filter(
    (m) => m.date >= cutoff && words.some((w) => m.content.includes(w))
  ).length;
  return { overdue, stagnant, troubledMemoCount };
}

function addDays(isoDate: string, days: number): string {
  const t = new Date(`${isoDate}T00:00:00Z`).getTime() + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** オフライン用のルールベース振り返り(ネットワーク/AI鍵が無くても成立する)。 */
function offlineReflection(
  goals: Goal[],
  memos: Memo[]
): { summary: string; actions: ReflectionAction[] } {
  const { overdue, stagnant, troubledMemoCount } = detectStagnation(goals, memos);
  const parts: string[] = [];
  const actions: ReflectionAction[] = [];

  if (overdue.length > 0) {
    const g = overdue[0];
    parts.push(
      `期限を過ぎている目標が${overdue.length}件あります(例:「${g.title}」)。失敗ではなく、計画を合わせ直すだけです。`
    );
    actions.push({
      kind: "reschedule",
      goalId: g.id,
      label: `「${g.title}」の期限を14日後に変更する`,
      newDeadline: addDays(today(), 14),
    });
  }
  if (stagnant.length > 0) {
    const g = stagnant[0];
    parts.push(`「${g.title}」は少し大きすぎて止まっているかもしれません。2つに分けると取り組みやすくなります。`);
    actions.push({ kind: "split", goalId: g.id, label: `「${g.title}」を2つに分裂させる` });
  }
  if (troubledMemoCount > 0) {
    parts.push(
      `直近のメモに「難しい・分からない」系の記録が${troubledMemoCount}件あります。今日は1つだけ小さく確認するのはどうですか。`
    );
    actions.push({ kind: "focus", label: "今日は一番小さい一歩だけ進める" });
  }
  if (parts.length === 0) {
    parts.push("大きな停滞は見つかりませんでした。進んでいる目標から今日の一歩を選びましょう。");
    actions.push({ kind: "focus", label: "今日取り組む目標を選ぶ" });
  }
  return { summary: parts.join("\n"), actions };
}

/** AI(Worker)を試し、失敗したら端末内のルール判定へフォールバックする。 */
export async function runReflection(goals: Goal[], memos: Memo[]): Promise<Reflection> {
  const relatedGoalIds = [...new Set(goals.filter((g) => g.status === "active").map((g) => g.id))].slice(0, 30);
  const contextGoals: ReflectionContextGoal[] = relatedGoalIds.map((id, idx) => {
    const g = goals.find((x) => x.id === id)!;
    return {
      idx,
      title: g.title,
      status: g.status,
      deadline: g.deadline,
      childCount: childCountOf(goals, g.id),
      daysOld: daysSince(g.createdAt),
    };
  });

  try {
    const res = await requestReflection({
      goals: contextGoals,
      memos: memos.slice(0, 5).map((m) => ({ date: m.date, content: m.content.slice(0, 120) })),
      today: today(),
    });
    const actions: ReflectionAction[] = res.actions
      .map((a): ReflectionAction | null => {
        const goalId =
          typeof a.goalIdx === "number" && a.goalIdx >= 0 && a.goalIdx < relatedGoalIds.length
            ? relatedGoalIds[a.goalIdx]
            : undefined;
        return {
          kind: a.kind,
          goalId,
          label: a.label.slice(0, 120),
          newDeadline:
            a.kind === "reschedule" && typeof a.days === "number" && a.days > 0 && a.days <= 90
              ? addDays(today(), Math.round(a.days))
              : undefined,
        };
      })
      .filter((a): a is ReflectionAction => a !== null)
      .slice(0, 3);
    return recordReflection({
      relatedGoalIds,
      summary: res.summary || "今日の状況をまとめました。",
      suggestedActions: actions.length > 0 ? actions : offlineReflection(goals, memos).actions,
      origin: "ai",
    });
  } catch (e) {
    // AI鍵なし・失敗時も体験は止めない(spec §13)。オフライン判定であることを明示する。
    if (e instanceof FissionApiError && e.kind === "network") throw e;
    const fb = offlineReflection(goals, memos);
    return recordReflection({
      relatedGoalIds,
      summary: `端末内の簡易判定です(サーバー側AIに接続できませんでした)。\n${fb.summary}`,
      suggestedActions: fb.actions,
      origin: "offline",
    });
  }
}

/** 提案対象の目標タイトル(表示用)。 */
export function goalTitleOf(id?: string): string | undefined {
  return getGoal(id ?? null)?.title;
}
