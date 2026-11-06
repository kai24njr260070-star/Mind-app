import { useState } from "react";
import { applyReflectionAction, declineReflection, selectGoal, startFission } from "./store";
import { useAppState } from "./useAppState";
import { goalTitleOf, runReflection } from "./reflection";

const KIND_LABEL: Record<string, string> = {
  split: "分裂",
  reschedule: "期限の変更",
  focus: "今日の一歩",
  rest: "休む",
};

/** Reflection画面(spec §7)。提案は必ず承認制。断りを失敗として記録しない。 */
export function ReflectionView(): React.JSX.Element {
  const state = useAppState();
  const [busy, setBusy] = useState(false);
  const pending = state.reflections.find((r) => r.approvalStatus === "pending");
  const history = state.reflections.filter((r) => r.id !== pending?.id);

  const run = async () => {
    setBusy(true);
    try {
      await runReflection(state.goals, state.memos);
    } catch {
      // ネットワーク断でもpendingは作らず、静かに案内だけ出す
    } finally {
      setBusy(false);
    }
  };

  const act = (kind: string, goalId?: string) => {
    if (kind === "split" && goalId) startFission(goalId);
    else if (goalId) selectGoal(goalId);
    // focus/rest は同意の記録だけで、状態は変更しない
  };

  return (
    <div className="page">
      <div className="page-block refl-cta">
        <p className="page-note">
          Reflection AIは、進捗・メモ・期限をもとに「計画の修正案」を出します。あなたを評価しません。
          提案は承認するまで適用されません。
        </p>
        <button className="btn primary" disabled={busy} onClick={run}>
          {busy ? "確認中…" : "今日の状況を振り返る"}
        </button>
      </div>

      {pending && (
        <div className="page-block refl-card">
          <div className="sheet-meta">
            <span className="chip active">{pending.origin === "ai" ? "AI判定" : "端末内の簡易判定"}</span>
          </div>
          <p className="refl-summary">{pending.summary}</p>
          {pending.suggestedActions.map((a, i) => (
            <div key={i} className="refl-action">
              <span className="chip">{KIND_LABEL[a.kind] ?? a.kind}</span>
              <span className="refl-text">{a.label}</span>
              <div className="row">
                {a.kind === "split" && (
                  <button
                    className="btn primary small"
                    onClick={() => {
                      applyReflectionAction(a);
                      act(a.kind, a.goalId);
                    }}
                  >
                    承認して分裂する
                  </button>
                )}
                {a.kind === "reschedule" && a.newDeadline && (
                  <button
                    className="btn primary small"
                    onClick={() => {
                      // 変更はこのボタンを押した時だけ反映される(spec §7.4)
                      applyReflectionAction(a);
                    }}
                  >
                    承認して {a.newDeadline} に変更
                  </button>
                )}
                {(a.kind === "focus" || a.kind === "rest") && (
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      applyReflectionAction(a);
                      act(a.kind, a.goalId);
                    }}
                  >
                    進める
                  </button>
                )}
                {a.goalId && (
                  <button className="btn ghost small" onClick={() => selectGoal(a.goalId!)}>対象を見る</button>
                )}
              </div>
            </div>
          ))}
          <div className="row refl-decline">
            <button
              className="btn ghost small"
              onClick={() => {
                // 辞退は失敗記録にならない(spec §7.3)
                declineReflection(pending.id);
              }}
            >
              問題はそこではない / 今は使わない
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="page-block">
          <h3 className="page-subtitle">過去の提案履歴</h3>
          {history.map((r) => (
            <details key={r.id} className="refl-history">
              <summary>
                <span className="memo-date">{new Date(r.createdAt).toLocaleString("ja-JP")}</span>
                <span className="chip">{r.approvalStatus === "acted" ? "適用あり" : "辞退"}</span>
              </summary>
              <p className="refl-summary">{r.summary}</p>
            </details>
          ))}
        </div>
      )}

      {state.goals.length === 0 && goalTitleOf() === undefined && (
        <p className="list-empty">目標がまだありません。まず宇宙で最初の目標を入力してください。</p>
      )}
    </div>
  );
}
