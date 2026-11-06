import type { AppState } from "./types";

/**
 * 端末内の自動バックアップ(localStorage)。
 * 目標ツリー・候補履歴・メモ・振り返りを定期的にスナップショットし、直近数世代を保持する。
 * ブラウザのデータ削除や誤操作に対する最後の復元手段(spec §13 データ管理の補強)。
 */
export const BACKUP_KEY = "mind-signature-backups-v1";
/** 保持する世代数。 */
export const MAX_BACKUPS = 5;
/** 通常の自動保存の間隔。これより短い間隔の変更は1世代にまとめる。 */
export const AUTO_INTERVAL_MS = 5 * 60 * 1000;

export interface BackupEntry {
  /** 保存時刻(epoch ms) */
  at: number;
  /** その時点の目標数(一覧表示用) */
  goals: number;
  /** その時点のメモ数(一覧表示用) */
  memos: number;
  /** STORAGE_KEY と同じ形のJSON */
  data: string;
}

interface BackupFile {
  version: 1;
  entries: BackupEntry[];
}

type Snapshot = Pick<AppState, "goals" | "candidates" | "memos" | "reflections">;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 永続化と同じ形(goals/candidates/memos/reflections)のJSONを作る。 */
export function payloadOf(snapshot: Snapshot): string {
  return JSON.stringify({
    goals: snapshot.goals,
    candidates: snapshot.candidates,
    memos: snapshot.memos,
    reflections: snapshot.reflections,
  });
}

function countsOf(data: string): { goals: number; memos: number } {
  try {
    const parsed = JSON.parse(data) as Partial<Snapshot>;
    return {
      goals: Array.isArray(parsed.goals) ? parsed.goals.length : 0,
      memos: Array.isArray(parsed.memos) ? parsed.memos.length : 0,
    };
  } catch {
    return { goals: 0, memos: 0 };
  }
}

/** 新しい順のバックアップ一覧。壊れた値は無視して空配列を返す。 */
export function listBackups(): BackupEntry[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(BACKUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<BackupFile>;
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .filter((e): e is BackupEntry => typeof e?.at === "number" && typeof e?.data === "string")
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_BACKUPS);
  } catch {
    return [];
  }
}

/** 容量超過などで書けない場合は古い世代を捨てて再挑戦する。 */
function writeBackups(entries: BackupEntry[]): boolean {
  const s = storage();
  if (!s) return false;
  let list = entries.slice(0, MAX_BACKUPS);
  while (list.length > 0) {
    try {
      const file: BackupFile = { version: 1, entries: list };
      s.setItem(BACKUP_KEY, JSON.stringify(file));
      return true;
    } catch {
      list = list.slice(0, list.length - 1);
    }
  }
  return false;
}

/**
 * 自動バックアップを1世代追加する。
 * - 直前の世代と同じ内容なら何もしない
 * - force でない場合は AUTO_INTERVAL_MS 以内の変更をまとめる
 * - 削除・復元などの破壊的操作の直前は force で必ず残す
 */
export function autoBackup(data: string, now: number = Date.now(), force = false): boolean {
  const entries = listBackups();
  if (entries[0]?.data === data) return false;
  if (!force && entries[0] && now - entries[0].at < AUTO_INTERVAL_MS) return false;
  const { goals, memos } = countsOf(data);
  return writeBackups([{ at: now, goals, memos, data }, ...entries]);
}

/** 指定時刻のバックアップ内容(STORAGE_KEY と同じ形のJSON)。 */
export function backupDataAt(at: number): string | null {
  return listBackups().find((e) => e.at === at)?.data ?? null;
}
