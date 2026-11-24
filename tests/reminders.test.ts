import { describe, expect, it } from "vitest";
import type { Goal, GoalBlock } from "../src/types";
import { dueBlockReminders, localDateISO, planningNudge } from "../src/reminders";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    parentId: null,
    title: "AIを作る",
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    source: "manual",
    orderIndex: 0,
    ...overrides,
  };
}

function block(overrides: Partial<GoalBlock> = {}): GoalBlock {
  return {
    id: "b1",
    goalId: "g1",
    date: "2026-11-24",
    start: "10:00",
    end: "10:30",
    createdAt: 0,
    ...overrides,
  };
}

const at = (h: number, m = 0): Date => new Date(2026, 10, 24, h, m, 0, 0);

describe("予定のリマインド", () => {
  it("開始1時間前・10分前・開始時刻に通知する", () => {
    const blocks = [block()];
    const goals = [goal()];

    expect(dueBlockReminders(blocks, goals, at(9, 0), new Set()).map((r) => r.kind)).toEqual(["lead60"]);
    expect(dueBlockReminders(blocks, goals, at(9, 50), new Set()).map((r) => r.kind)).toEqual(["lead10"]);
    expect(dueBlockReminders(blocks, goals, at(10, 0), new Set()).map((r) => r.kind)).toEqual(["start"]);
  });

  it("通知済みのキーは繰り返さない", () => {
    const blocks = [block()];
    const goals = [goal()];
    const fired = new Set(["b1:lead10"]);
    expect(dueBlockReminders(blocks, goals, at(9, 52), fired)).toEqual([]);
  });

  it("大きく過ぎた予定では通知しない", () => {
    const blocks = [block()];
    const goals = [goal()];
    expect(dueBlockReminders(blocks, goals, at(10, 11), new Set())).toEqual([]);
  });

  it("完了した目標の予定は通知しない", () => {
    const blocks = [block()];
    const goals = [goal({ status: "completed" })];
    expect(dueBlockReminders(blocks, goals, at(9, 0), new Set())).toEqual([]);
  });

  it("通知本文に目標名と時間帯が入る", () => {
    const [reminder] = dueBlockReminders([block()], [goal()], at(9, 0), new Set());
    expect(reminder.title).toContain("AIを作る");
    expect(reminder.body).toContain("10:00〜10:30");
  });
});

describe("明日の予定づくりナッジ", () => {
  it("8:00に明日の予定が空なら促す", () => {
    const nudge = planningNudge(at(8, 0), 0, true);
    expect(nudge?.title).toBe("明日の予定は作りましたか？");
    expect(nudge?.key).toBe("nudge:2026-11-24T08:00");
  });

  it("30分おきのスロットの頭でだけ促す", () => {
    expect(planningNudge(at(8, 30), 0, true)).not.toBeNull();
    expect(planningNudge(at(8, 5), 0, true)).toBeNull();
    expect(planningNudge(at(8, 45), 0, true)).toBeNull();
  });

  it("明日の予定が1件でもあれば止める", () => {
    expect(planningNudge(at(9, 0), 1, true)).toBeNull();
  });

  it("夜間・無効時は促さない", () => {
    expect(planningNudge(at(7, 0), 0, true)).toBeNull();
    expect(planningNudge(at(22, 30), 0, true)).toBeNull();
    expect(planningNudge(at(12, 0), 0, false)).toBeNull();
  });
});

describe("日付", () => {
  it("端末のローカル日付を返す(UTCずれなし)", () => {
    expect(localDateISO(at(0, 30))).toBe("2026-11-24");
    expect(localDateISO(at(23, 30))).toBe("2026-11-24");
  });
});
