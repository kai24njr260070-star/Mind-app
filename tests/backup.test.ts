import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_INTERVAL_MS,
  MAX_BACKUPS,
  autoBackup,
  backupDataAt,
  listBackups,
} from "../src/backup";
import { MemoryStorage } from "./memoryStorage";

/** goals/memos の件数だけを持つ最小のスナップショット。 */
function payload(goals: number, memos = 0): string {
  return JSON.stringify({
    goals: Array.from({ length: goals }, (_, i) => ({ id: `g${i}`, title: `goal ${i}`, parentId: null })),
    candidates: [],
    memos: Array.from({ length: memos }, (_, i) => ({ id: `m${i}`, content: `memo ${i}` })),
    reflections: [],
  });
}

describe("自動バックアップ", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  it("最初の世代を保存し、件数を記録する", () => {
    expect(autoBackup(payload(2, 1), 1000)).toBe(true);
    const entries = listBackups();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ at: 1000, goals: 2, memos: 1 });
  });

  it("同じ内容は重複保存しない", () => {
    const data = payload(1);
    autoBackup(data, 1000, true);
    expect(autoBackup(data, 2000, true)).toBe(false);
    expect(listBackups()).toHaveLength(1);
  });

  it("forceでなければ間隔内の変更を1世代にまとめる", () => {
    autoBackup(payload(1), 1000);
    expect(autoBackup(payload(2), 1000 + AUTO_INTERVAL_MS - 1)).toBe(false);
    expect(autoBackup(payload(3), 1000 + AUTO_INTERVAL_MS)).toBe(true);
    expect(listBackups().map((e) => e.goals)).toEqual([3, 1]);
  });

  it("forceなら間隔内でも保存する", () => {
    autoBackup(payload(1), 1000);
    expect(autoBackup(payload(5), 1001, true)).toBe(true);
    expect(listBackups()[0].goals).toBe(5);
  });

  it(`直近${MAX_BACKUPS}世代だけを保持する`, () => {
    for (let i = 0; i < MAX_BACKUPS + 3; i++) {
      autoBackup(payload(i + 1), 1000 + i * AUTO_INTERVAL_MS);
    }
    const entries = listBackups();
    expect(entries).toHaveLength(MAX_BACKUPS);
    expect(entries[0].goals).toBe(MAX_BACKUPS + 3);
    expect(entries[entries.length - 1].goals).toBe(4);
  });

  it("容量が足りない時は古い世代を捨てて最新を残す", () => {
    vi.stubGlobal("localStorage", new MemoryStorage(2));
    for (let i = 0; i < 4; i++) {
      autoBackup(payload(i + 1), 1000 + i, true);
    }
    const entries = listBackups();
    expect(entries).toHaveLength(2);
    expect(entries[0].goals).toBe(4);
  });

  it("指定時刻の内容を取り出せる", () => {
    autoBackup(payload(3), 5000, true);
    expect(backupDataAt(5000)).toBe(payload(3));
    expect(backupDataAt(9999)).toBeNull();
  });

  it("壊れた保存値でも例外を投げず空を返す", () => {
    localStorage.setItem("mind-signature-backups-v1", "{壊れている");
    expect(listBackups()).toEqual([]);
  });
});
