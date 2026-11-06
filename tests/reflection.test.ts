import { describe, expect, it } from "vitest";
import { detectStagnation } from "../src/reflection";
import type { Goal, Memo } from "../src/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    parentId: null,
    title: `goal ${id}`,
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completionDate: null,
    source: "manual",
    orderIndex: 0,
    ...extra,
  };
}

function memo(id: string, content: string, date = new Date().toISOString().slice(0, 10)): Memo {
  return {
    id,
    date,
    content,
    tags: [],
    linkedGoalIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("停滞・期限の検知", () => {
  it("期限を過ぎた未完了の目標だけを overdue に含める", () => {
    const goals = [
      goal("ok", { deadline: "2999-01-01" }),
      goal("over", { deadline: "2000-01-01" }),
      goal("done", { deadline: "2000-01-01", status: "completed" }),
    ];
    expect(detectStagnation(goals, []).overdue.map((g) => g.id)).toEqual(["over"]);
  });

  it("子を持たないまま1週間以上経った目標を停滞として扱う", () => {
    const goals = [
      goal("old-leaf", { createdAt: Date.now() - 10 * DAY_MS }),
      goal("new-leaf", { createdAt: Date.now() }),
      goal("parent", { createdAt: Date.now() - 10 * DAY_MS }),
      goal("child", { parentId: "parent" }),
    ];
    expect(detectStagnation(goals, []).stagnant.map((g) => g.id)).toEqual(["old-leaf"]);
  });

  it("完了した目標は停滞に数えない", () => {
    const goals = [goal("done", { createdAt: Date.now() - 30 * DAY_MS, status: "completed" })];
    expect(detectStagnation(goals, []).stagnant).toHaveLength(0);
  });

  it("直近3日の「難しい・分からない」系メモだけを数える", () => {
    const today = new Date();
    const recent = new Date(today.getTime() - 1 * DAY_MS).toISOString().slice(0, 10);
    const old = new Date(today.getTime() - 5 * DAY_MS).toISOString().slice(0, 10);
    const memos = [
      memo("m1", "今日は難しいと感じた", recent),
      memo("m2", "よく分からないところがある", recent),
      memo("m3", "難しい", old),
      memo("m4", "順調に進んだ", recent),
    ];
    expect(detectStagnation([], memos).troubledMemoCount).toBe(2);
  });
});
