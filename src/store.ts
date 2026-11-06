import type { AICandidate, AppState, FissionError, Goal, Memo, Reflection, ReflectionAction, Settings } from "./types";
import { requestFissionCandidates } from "./api";

const STORAGE_KEY = "mind-signature-v1";
const SETTINGS_KEY = "mind-signature-settings-v1";

let state: AppState = {
  goals: [],
  candidates: [],
  memos: [],
  reflections: [],
  selection: null,
  fission: null,
  fx: null,
};

export let settings: Settings = { skipStartup: false, sound: false, apiKey: "", providerId: "freebuff", aiModel: "" };

let loaded = false;

function loadPersisted(): void {
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      state = {
        goals: Array.isArray(parsed.goals) ? parsed.goals : [],
        candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
        memos: Array.isArray(parsed.memos) ? parsed.memos : [],
        reflections: Array.isArray(parsed.reflections) ? parsed.reflections : [],
        selection: null,
        fission: null,
        fx: null,
      };
    }
  } catch {
    state = { goals: [], candidates: [], memos: [], reflections: [], selection: null, fission: null, fx: null };
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      settings = { ...settings, ...parsed };
    }
  } catch {
    // 設定が壊れていても既定値で続行
  }

  // 他タブとの同時編集で古いメモリ内状態がlocalStorageを上書きして
  // 目標が消えたように見える事故を防ぐ(spec §4タブ間同期)。storageイベントは
  // 書き込み元タブには発火しないため、自タブの保存と競合しない。
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key !== STORAGE_KEY || e.newValue === null) return;
      try {
        const parsed = JSON.parse(e.newValue) as Partial<AppState>;
        setState({
          goals: Array.isArray(parsed.goals) ? parsed.goals : state.goals,
          candidates: Array.isArray(parsed.candidates) ? parsed.candidates : state.candidates,
          memos: Array.isArray(parsed.memos) ? parsed.memos : state.memos,
          reflections: Array.isArray(parsed.reflections) ? parsed.reflections : state.reflections,
        });
      } catch {
        // 解析できない更新は無視
      }
    });
  }
}

function persist(): void {
  try {
    const data = { goals: state.goals, candidates: state.candidates, memos: state.memos, reflections: state.reflections };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 保存に失敗してもアプリ動作は継続(メモリ内)
  }
}

const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getState(): AppState {
  return state;
}

/** 状態は常に新しいオブジェクトへ差し替え(useSyncExternalStoreが変更を検知できるように)。 */
function setState(next: Partial<AppState>): void {
  state = { ...state, ...next };
  emit();
}

function emit(): void {
  for (const l of listeners) l();
}

export function ensureLoaded(): void {
  if (!loaded) loadPersisted();
}

export function getSettings(): Settings {
  return settings;
}

export function updateSettings(next: Partial<Settings>): void {
  settings = { ...settings, ...next };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 設定の永続化に失敗してもセッション内は有効
  }
  // 設定をUIに反映させる(状態オブジェクトの参照を新しくする)
  setState({});
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getGoal(id: string | null): Goal | undefined {
  if (!id) return undefined;
  return state.goals.find((g) => g.id === id);
}

function makeGoal(
  parentId: string | null,
  title: string,
  description: string | undefined,
  source: "manual" | "ai"
): Goal {
  const now = Date.now();
  const orderIndex = parentId
    ? state.goals.filter((g) => g.parentId === parentId).length
    : state.goals.filter((g) => g.parentId === null).length;
  return {
    id: uid("goal"),
    parentId,
    title,
    description,
    status: "active",
    createdAt: now,
    updatedAt: now,
    deadline: undefined,
    completionDate: null,
    source,
    orderIndex,
  };
}

/** ルート → 自分 までの目標チェーン。AIへの文脈として渡す。 */
export function ancestorChain(goal: Goal): string[] {
  const chain: string[] = [];
  let cur: Goal | undefined = goal;
  while (cur) {
    chain.unshift(cur.title);
    cur = getGoal(cur.parentId);
  }
  return chain;
}

export async function createRootGoal(title: string): Promise<Goal> {
  ensureLoaded();
  const goal = makeGoal(null, title.trim(), undefined, "manual");
  setState({ goals: [...state.goals, goal], selection: goal.id });
  persist();
  void startFission(goal.id);
  return goal;
}

export function selectGoal(id: string | null): void {
  setState({ selection: id });
}

export interface FissionResult {
  ok: boolean;
  error?: FissionError;
}

export async function startFission(goalId: string): Promise<FissionResult> {
  const goal = getGoal(goalId);
  if (!goal) return { ok: false };
  setState({ fx: null, fission: { parentId: goalId, phase: "loading", candidates: [] } });

  const chain = ancestorChain(goal);
  const siblings = state.goals
    .filter((g) => g.parentId === goal.parentId && g.id !== goal.id && g.status === "active")
    .map((g) => g.title);

  try {
    const candidates = await requestFissionCandidates({
      parent: { title: goal.title, description: goal.description },
      ancestors: chain.slice(0, -1),
      siblings,
      depth: chain.length - 1,
    });
    if (state.fission?.parentId !== goalId || state.fission?.phase !== "loading") return { ok: true };
    setState({
      fission: {
        parentId: goalId,
        phase: "ready",
        candidates: candidates.map((c) => ({
          id: uid("cand"),
          title: c.title,
          description: c.description,
          bornAt: Date.now(),
        })),
      },
    });
    return { ok: true };
  } catch (err) {
    const kind =
      err instanceof Error && "kind" in err ? (err as { kind: FissionError }).kind : "ai_failed";
    if (state.fission?.parentId !== goalId) return { ok: false, error: kind };
    setState({ fission: { parentId: goalId, phase: "error", candidates: [], error: kind } });
    return { ok: false, error: kind };
  }
}

export function cancelFission(): void {
  setState({ fission: null });
}

/**
 * 候補の確定(単独・両方)と手動入力を1つの入口にまとめる。
 * 選ばれなかったAI候補は rejected として履歴に残す(spec §3.2 候補履歴)。
 */
export function confirmFission(
  chosen: AICandidate[],
  chosenIds: string[],
  source: "manual" | "ai" = "ai"
): void {
  const fission = state.fission;
  if (!fission) return;
  const parent = getGoal(fission.parentId);
  if (!parent) {
    cancelFission();
    return;
  }

  const newGoals = chosen.map((c) =>
    makeGoal(fission.parentId, c.title, c.description || undefined, source)
  );
  const now = Date.now();

  const updatedHistory = state.candidates.map((c) =>
    fission.candidates.some((live) => live.id === c.id)
      ? {
          ...c,
          selectionStatus: chosenIds.includes(c.id)
            ? ("selected" as const)
            : ("rejected" as const),
        }
      : c
  );
  const freshRecords = fission.candidates
    .filter((c) => !state.candidates.some((h) => h.id === c.id))
    .map((c) => ({
      id: c.id,
      parentId: fission.parentId,
      title: c.title,
      description: c.description,
      createdAt: now,
      selectionStatus: (chosenIds.includes(c.id) ? "selected" : "rejected") as
        | "selected"
        | "rejected",
    }));

  const fx: AppState["fx"] = {
    type: "fission-result",
    parentId: fission.parentId,
    chosenIds: newGoals.map((g) => g.id),
    rejectedIds: fission.candidates
      .filter((c) => !chosenIds.includes(c.id) && chosen.length > 0)
      .map((c) => c.id),
    at: now,
  };

  setState({
    goals: [...state.goals, ...newGoals],
    candidates: [...updatedHistory, ...freshRecords],
    fission: null,
    fx,
    selection: newGoals[newGoals.length - 1]?.id ?? parent.id,
  });
  persist();

  window.setTimeout(() => {
    if (state.fx?.at === now) {
      setState({ fx: null });
    }
  }, 1200);
}

/** 手動入力(パターンC)。AIの候補が無くても分裂を続けられる。 */
export function confirmManualFission(title: string, description?: string): void {
  const fission = state.fission;
  if (!fission) return;
  confirmFission([{ title: title.trim(), description: description ?? "" }], [], "manual");
}

export function setGoalStatus(id: string, status: "active" | "completed"): void {
  setState({
    goals: state.goals.map((g) =>
      g.id === id
        ? {
            ...g,
            status,
            updatedAt: Date.now(),
            completionDate:
              status === "completed" ? new Date().toISOString().slice(0, 10) : null,
          }
        : g
    ),
  });
  persist();
}

/** 子孫を含めて削除する。 */
export function deleteGoalDeep(id: string): void {
  const toRemove = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of state.goals) {
      if (g.parentId && toRemove.has(g.parentId) && !toRemove.has(g.id)) {
        toRemove.add(g.id);
        grew = true;
      }
    }
  }
  setState({ goals: state.goals.filter((g) => !toRemove.has(g.id)), selection: null });
  persist();
}

export function setDeadline(id: string, deadline: string | undefined): void {
  setState({
    goals: state.goals.map((g) =>
      g.id === id ? { ...g, deadline, updatedAt: Date.now() } : g
    ),
  });
  persist();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addMemo(content: string, date?: string, tags: string[] = []): Memo {
  const now = Date.now();
  const memo: Memo = {
    id: uid("memo"),
    date: date ?? today(),
    content: content.trim(),
    tags,
    linkedGoalIds: [],
    createdAt: now,
    updatedAt: now,
  };
  setState({ memos: [memo, ...state.memos] });
  persist();
  return memo;
}

export function updateMemo(id: string, patch: Partial<Pick<Memo, "content" | "date" | "tags" | "linkedGoalIds">>): void {
  setState({
    memos: state.memos.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m)),
  });
  persist();
}

export function deleteMemo(id: string): void {
  setState({ memos: state.memos.filter((m) => m.id !== id) });
  persist();
}

/** メモを承認ベースで新しいルート目標へ変換する(spec §5.2)。自動変換はしない。 */
export function convertMemoToRootGoal(memoId: string): Goal | undefined {
  const memo = state.memos.find((m) => m.id === memoId);
  if (!memo) return undefined;
  const goal = makeGoal(null, memo.content.split("\n")[0].slice(0, 60), memo.content, "manual");
  setState({ goals: [...state.goals, goal], selection: goal.id });
  persist();
  void startFission(goal.id);
  return goal;
}

export function recordReflection(ref: Omit<Reflection, "id" | "createdAt" | "approvalStatus">): Reflection {
  const reflection: Reflection = { ...ref, id: uid("refl"), createdAt: Date.now(), approvalStatus: "pending" };
  setState({ reflections: [reflection, ...state.reflections].slice(0, 50) });
  persist();
  return reflection;
}

/**
 * 提案の適用(spec §7.4:自動変更は禁止。この関数は必ずユーザー操作の結果として呼ぶ)。
 * split は分裂画面の起動に、reschedule は期限変更に使う。
 */
export function applyReflectionAction(action: ReflectionAction): void {
  const pending = state.reflections.find((r) => r.approvalStatus === "pending");
  if (pending) {
    setState({
      reflections: state.reflections.map((r) =>
        r.id === pending.id ? { ...r, approvalStatus: "acted" as const } : r
      ),
    });
    persist();
  }
  if (action.kind === "reschedule" && action.goalId && action.newDeadline) {
    setDeadline(action.goalId, action.newDeadline);
  }
}

export function declineReflection(id: string): void {
  // 断了を「失敗」として記録しない。履歴上は辞退としてだけ残す(spec §7.3)。
  setState({
    reflections: state.reflections.map((r) =>
      r.id === id ? { ...r, approvalStatus: "declined" as const } : r
    ),
  });
  persist();
}

/** バックアップ用の全データ書き出し(spec §13 データ管理)。 */
export function exportData(): string {
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), goals: state.goals, candidates: state.candidates, memos: state.memos, reflections: state.reflections },
    null,
    2
  );
}

/** 復元。goals/candidates/memos/reflections を置き換える。呼び出し前に確認を取ること。 */
export function importData(json: string): { ok: boolean; error?: string } {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (!Array.isArray(parsed.goals)) return { ok: false, error: "goals が配列ではありません" };
    state = {
      goals: parsed.goals as Goal[],
      candidates: Array.isArray(parsed.candidates) ? (parsed.candidates as AppState["candidates"]) : [],
      memos: Array.isArray(parsed.memos) ? (parsed.memos as Memo[]) : [],
      reflections: Array.isArray(parsed.reflections) ? (parsed.reflections as Reflection[]) : [],
      selection: null,
      fission: null,
      fx: null,
    };
    persist();
    emit();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "JSONを解析できませんでした" };
  }
}

export function clearAllData(): void {
  state = { goals: [], candidates: [], memos: [], reflections: [], selection: null, fission: null, fx: null };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 無視
  }
  emit();
}
