import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "../src/types";
import { MemoryStorage } from "./memoryStorage";

function goal(id: string, parentId: string | null, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    parentId,
    title: `goal ${id}`,
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    completionDate: null,
    source: "manual",
    orderIndex: 0,
    ...extra,
  };
}

function seedJson(goals: Goal[]): string {
  return JSON.stringify({ version: 1, goals, candidates: [], memos: [], reflections: [] });
}

/** store はモジュール内に状態を持つため、テストごとに読み込み直す。 */
async function freshStore() {
  vi.resetModules();
  return import("../src/store");
}

describe("store のデータ管理", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  it("書き出し → 読み込みで目標が復元される(選択状態は解除)", async () => {
    const store = await freshStore();
    expect(store.importData(seedJson([goal("a", null), goal("b", "a")])).ok).toBe(true);
    store.selectGoal("b");
    const exported = store.exportData();
    store.clearAllData();
    expect(store.getState().goals).toHaveLength(0);
    expect(store.importData(exported).ok).toBe(true);
    expect(store.getState().goals.map((g) => g.id)).toEqual(["a", "b"]);
    expect(store.getState().selection).toBeNull();
  });

  it("不正なJSONは拒否し、既存データを壊さない", async () => {
    const store = await freshStore();
    store.importData(seedJson([goal("a", null)]));
    expect(store.importData("{壊れている")).toMatchObject({ ok: false });
    expect(store.importData(JSON.stringify({ memos: [] }))).toMatchObject({ ok: false });
    expect(store.getState().goals).toHaveLength(1);
  });

  it("目標の削除は子孫ごと消え、削除前の状態がバックアップに残る", async () => {
    const store = await freshStore();
    const backup = await import("../src/backup");
    store.importData(seedJson([goal("root", null), goal("child", "root"), goal("grand", "child"), goal("other", null)]));
    store.deleteGoalDeep("root");
    expect(store.getState().goals.map((g) => g.id)).toEqual(["other"]);
    expect(backup.listBackups().some((e) => e.goals === 4)).toBe(true);
  });

  it("全削除しても、自動バックアップから元に戻せる", async () => {
    const store = await freshStore();
    const backup = await import("../src/backup");
    store.importData(seedJson([goal("a", null), goal("b", null)]));
    store.clearAllData();
    expect(store.getState().goals).toHaveLength(0);
    const entry = backup.listBackups().find((e) => e.goals === 2);
    expect(entry).toBeDefined();
    expect(store.restoreBackupAt(entry!.at)).toMatchObject({ ok: true });
    expect(store.getState().goals.map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("存在しない世代の復元は失敗を返す", async () => {
    const store = await freshStore();
    expect(store.restoreBackupAt(123)).toMatchObject({ ok: false });
  });

  it("完了にすると完了日が入り、戻すと消える", async () => {
    const store = await freshStore();
    store.importData(seedJson([goal("a", null)]));
    store.setGoalStatus("a", "completed");
    expect(store.getState().goals[0].completionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    store.setGoalStatus("a", "active");
    expect(store.getState().goals[0].completionDate).toBeNull();
  });

  it("プロバイダごとにAPIキーを保存し、切り替えても失われない", async () => {
    const store = await freshStore();
    store.selectProvider("groq");
    store.updateSettings({ apiKey: "gsk_1" });
    store.selectProvider("openai");
    expect(store.getSettings().apiKey).toBe("");
    store.updateSettings({ apiKey: "sk_2" });
    store.selectProvider("groq");
    expect(store.getSettings().apiKey).toBe("gsk_1");
    store.selectProvider("openai");
    expect(store.getSettings().apiKey).toBe("sk_2");
    expect(store.getSettings().perProvider?.groq.apiKey).toBe("gsk_1");
  });
});
