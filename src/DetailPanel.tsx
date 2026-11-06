import { useEffect, useState } from "react";
import { deleteGoalDeep, getGoal, selectGoal, setDeadline, setGoalStatus, startFission } from "./store";
import { useAppState } from "./useAppState";
import { childCount } from "./types";

const STATUS_LABEL: Record<string, string> = {
  active: "進行中",
  completed: "完了",
};

export function DetailPanel(): React.JSX.Element | null {
  const state = useAppState();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 武装したまま放置すると、後で別の操作をしたつもりが「もう一度で削除」を
  // 踏んで親も子も一緒に消えてしまう事故を防ぐ。数秒で自動的に解除する。
  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDelete, state.selection]);
  const goal = getGoal(state.selection);
  if (!goal || state.fission) return null;

  const children = childCount(state.goals, goal.id);

  return (
    <div className="sheet">
      <button className="sheet-close" aria-label="閉じる" onClick={() => selectGoal(null)}>×</button>
      <div className="sheet-meta">
        <span className={`chip ${goal.status}`}>{STATUS_LABEL[goal.status] ?? goal.status}</span>
        <span className="chip">{goal.source === "ai" ? "AI候補から確定" : "手動入力"}</span>
      </div>
      <h2 className="sheet-title">{goal.title}</h2>
      {goal.description && <p className="sheet-desc">{goal.description}</p>}
      <dl className="sheet-facts">
        <div><dt>下位目標</dt><dd>{children > 0 ? `${children}件` : "なし"}</dd></div>
        <div><dt>作成日</dt><dd>{new Date(goal.createdAt).toLocaleDateString("ja-JP")}</dd></div>
        <div><dt>期限</dt><dd>{goal.deadline ?? "未設定"}</dd></div>
      </dl>

      <div className="row sheet-deadline">
        <label className="deadline-label" htmlFor="deadline-input">期限</label>
        <input
          id="deadline-input"
          type="date"
          value={goal.deadline ?? ""}
          onChange={(e) => setDeadline(goal.id, e.target.value || undefined)}
        />
        {goal.deadline && (
          <button className="btn ghost small" onClick={() => setDeadline(goal.id, undefined)}>解除</button>
        )}
      </div>

      <div className="row sheet-actions">
        {goal.status === "active" && (
          <>
            <button className="btn primary" onClick={() => startFission(goal.id)}>分裂する ⤵</button>
            <button className="btn ghost" onClick={() => setGoalStatus(goal.id, "completed")}>完了にする</button>
          </>
        )}
        {goal.status === "completed" && (
          <button className="btn ghost" onClick={() => setGoalStatus(goal.id, "active")}>未完了へ戻す</button>
        )}
        {goal.parentId && (
          <button className="btn ghost" onClick={() => selectGoal(goal.parentId)}>親へ移動</button>
        )}
        <button
          className={`btn ghost danger ${confirmDelete ? "confirm" : ""}`}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            deleteGoalDeep(goal.id);
            setConfirmDelete(false);
          }}
        >
          {confirmDelete ? "もう一度で削除" : "削除"}
        </button>
      </div>
    </div>
  );
}
