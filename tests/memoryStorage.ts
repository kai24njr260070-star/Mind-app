/** テスト用のlocalStorage代替。ブラウザ無しで保存系のロジックを検証するための最小実装。 */
export class MemoryStorage {
  private map = new Map<string, string>();

  /**
   * @param maxBackupEntries BACKUP_KEY に保存できる最大世代数。容量超過の再現用。
   * @param backupKey 世代数を制限する対象のキー。
   */
  constructor(
    private maxBackupEntries = Number.POSITIVE_INFINITY,
    private backupKey = "mind-signature-backups-v1"
  ) {}

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    const next = String(value);
    if (key === this.backupKey && Number.isFinite(this.maxBackupEntries)) {
      let count = 0;
      try {
        count = ((JSON.parse(next) as { entries?: unknown[] }).entries ?? []).length;
      } catch {
        count = 0;
      }
      if (count > this.maxBackupEntries) {
        // ブラウザの QuotaExceededError 相当
        throw new Error("QuotaExceededError");
      }
    }
    this.map.set(key, next);
  }
}
