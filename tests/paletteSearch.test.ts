import { describe, expect, it } from "vitest";
import { buildItems, searchItems, type CommandItem } from "../src/paletteSearch";
import type { Goal, Memo } from "../src/types";

function goal(id: string, title: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    parentId: null,
    title,
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    completionDate: null,
    source: "manual",
    orderIndex: 0,
    ...extra,
  };
}

function memo(id: string, content: string, date = "2026-11-06"): Memo {
  return { id, date, content, tags: [], linkedGoalIds: [], createdAt: 1, updatedAt: 1 };
}

function item(label: string, kind: CommandItem["kind"] = "goal", sub = "目標"): CommandItem {
  return { key: `${kind}:${label}`, kind, refId: label, label, sub };
}

describe("検索インデックス", () => {
  it("画面・目標・メモを1本の一覧にまとめる", () => {
    const items = buildItems([goal("g1", "AIを開発する")], [memo("m1", "今日の学び\n詳細")]);
    expect(items.filter((i) => i.kind === "view").length).toBeGreaterThan(0);
    expect(items.find((i) => i.kind === "goal")).toMatchObject({
      refId: "g1",
      label: "AIを開発する",
    });
    // メモは本文の1行目をラベルにする
    expect(items.find((i) => i.kind === "memo")).toMatchObject({ label: "今日の学び" });
  });

  it("期限や完了状態を補足として表示する", () => {
    const items = buildItems(
      [
        goal("g1", "締切あり", { deadline: "2026-12-01" }),
        goal("g2", "完了済み", { status: "completed" }),
      ],
      []
    );
    expect(items.find((i) => i.refId === "g1")?.sub).toContain("2026-12-01");
    expect(items.find((i) => i.refId === "g2")?.sub).toContain("完了");
  });
});

describe("検索", () => {
  it("空の検索語では先頭から件数分を返す", () => {
    const items = Array.from({ length: 20 }, (_, i) => item(`目標${i}`));
    expect(searchItems(items, "", 5)).toHaveLength(5);
    expect(searchItems(items, "   ")).toHaveLength(8);
  });

  it("前方一致を部分一致より上位にする", () => {
    const items = [item("自分だけのAI開発"), item("AI開発")];
    expect(searchItems(items, "AI")[0].label).toBe("AI開発");
  });

  it("空白区切りの語はすべて一致するものだけ返す", () => {
    const items = [item("AI開発"), item("AI研究"), item("Web開発")];
    expect(searchItems(items, "AI 開発").map((i) => i.label)).toEqual(["AI開発"]);
  });

  it("ラベルに無くても補足欄に一致すれば拾う", () => {
    const items = [item("星A", "goal", "期限 2026-12-01")];
    expect(searchItems(items, "2026-12-01")).toHaveLength(1);
  });

  it("一致が無ければ空を返す", () => {
    expect(searchItems([item("AI開発")], "見つからない")).toEqual([]);
  });

  it("件数上限を超えない", () => {
    const items = Array.from({ length: 30 }, (_, i) => item(`AI${i}`));
    expect(searchItems(items, "AI", 3)).toHaveLength(3);
  });
});
