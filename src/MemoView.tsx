import { useMemo, useState } from "react";
import type { Goal, Memo, Reflection } from "./types";
import { addMemo, applyReflectionAction, convertMemoToRootGoal, declineReflection, deleteMemo, selectGoal, startFission, updateMemo } from "./store";
import { useAppState } from "./useAppState";
import { runReflection } from "./reflection";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 日次メモ画面(spec §5)。目標ツリーから独立し、自動的に目標化されることはない。 */
export function MemoView(): React.JSX.Element {
  const state = useAppState();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [date, setDate] = useState(todayISO());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [linkedFor, setLinkedFor] = useState<string | null>(null);
  const [autoReflection, setAutoReflection] = useState<Reflection | null>(null);
  const [reflectionBusy, setReflectionBusy] = useState(false);

  const activeGoals = useMemo(
    () => state.goals.filter((g) => g.status === "active").slice(0, 30),
    [state.goals]
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    const list = [...state.memos].sort((a, b) => b.createdAt - a.createdAt);
    if (!q) return list;
    return list.filter(
      (m) => m.content.includes(q) || m.tags.some((t) => t.includes(q)) || m.date.includes(q)
    );
  }, [state.memos, query]);

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    addMemo(text, date);
    setDraft("");

    // 保存直後にAIがメモを読み込み、目標への評価・改善案を自動で出す(spec §5.3)
    setReflectionBusy(true);
    try {
      const result = await runReflection(state.goals, state.memos);
      setAutoReflection(result);
    } catch {
      // ネットワーク断などで失敗しても、メモ保存自体は完了している
      // 手動で「振り返り」画面から後で確認できる
    } finally {
      setReflectionBusy(false);
    }
  };

  const goalTitle = (id: string): string => state.goals.find((g) => g.id === id)?.title ?? "(削除済み)";

  return (
    <div className="page">
      <div className="page-block">
        <div className="row">
          <input
            type="text"
            aria-label="メモの日付"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ flex: "0 0 130px" }}
          />
          <input
            type="text"
            aria-label="メモの検索"
            placeholder="メモを検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="manual-row">
          <textarea
            className="memo-input"
            rows={3}
            placeholder="出来事・アイデア・進捗・悩みを自由に書く"
            value={draft}
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={() => {
              // Enter単体では確定しない(ボタン操作のみ)
            }}
          />
          <button className="btn primary" disabled={draft.trim().length === 0} onClick={submit}>
            保存
          </button>
        </div>
      </div>

      {filtered.length === 0 && <p className="list-empty">まだメモはありません。</p>}
      {filtered.map((m: Memo) => (
        <div key={m.id} className="memo-card">
          <div className="memo-head">
            <span className="memo-date">{m.date}</span>
            {m.tags.map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
          </div>
          {editingId === m.id ? (
            <div className="manual-row">
              <textarea
                className="memo-input"
                rows={3}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
              />
              <button
                className="btn primary small"
                onClick={() => {
                  updateMemo(m.id, { content: editText.trim() || m.content });
                  setEditingId(null);
                }}
              >
                反映
              </button>
              <button className="btn ghost small" onClick={() => setEditingId(null)}>取消</button>
            </div>
          ) : (
            <p className="memo-content">{m.content}</p>
          )}

          {m.linkedGoalIds.length > 0 && (
            <div className="memo-links">
              {m.linkedGoalIds.map((id) => (
                <button key={id} className="chip link" onClick={() => selectGoal(id)}>
                  ✦ {goalTitle(id)}
                </button>
              ))}
            </div>
          )}

          <div className="row memo-actions">
            <button className="btn ghost small" onClick={() => setLinkedFor(linkedFor === m.id ? null : m.id)}>
              目標にリンク
            </button>
            <button
              className="btn ghost small"
              onClick={() => {
                setEditingId(m.id);
                setEditText(m.content);
              }}
            >
              編集
            </button>
            <button
              className="btn ghost small"
              onClick={() => {
                if (window.confirm("このメモから新しいルート目標を作りますか?")) convertMemoToRootGoal(m.id);
              }}
            >
              目標にする
            </button>
            <button className="btn ghost small danger" onClick={() => deleteMemo(m.id)}>削除</button>
          </div>

          {linkedFor === m.id && (
            <div className="memo-link-picker">
              {activeGoals.length === 0 && <span className="memo-date">リンクできる目標がありません。</span>}
              {activeGoals.map((g: Goal) => {
                const linked = m.linkedGoalIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    className={`chip link ${linked ? "on" : ""}`}
                    onClick={() => {
                      const next = linked
                        ? m.linkedGoalIds.filter((x) => x !== g.id)
                        : [...m.linkedGoalIds, g.id];
                      updateMemo(m.id, { linkedGoalIds: next });
                    }}
                  >
                    {linked ? "✓" : "✦"} {g.title}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {reflectionBusy && (
        <div className="page-block">
          <p className="page-note">AIがメモを読み込み、目標への影響を確認しています…</p>
        </div>
      )}

      {autoReflection && (
        <div className="page-block refl-card">
          <div className="sheet-meta">
            <span className="chip active">{autoReflection.origin === "ai" ? "AI判定" : "端末内の簡易判定"}</span>
          </div>
          <p className="refl-summary">{autoReflection.summary}</p>
          {autoReflection.suggestedActions.map((a, i) => (
            <div key={i} className="refl-action">
              <span className="chip">{a.kind}</span>
              <span className="refl-text">{a.label}</span>
              <div className="row">
                {a.kind === "split" && a.goalId && (
                  <button
                    className="btn primary small"
                    onClick={() => {
                      applyReflectionAction(a);
                      startFission(a.goalId!);
                    }}
                  >
                    承認して分裂する
                  </button>
                )}
                {a.kind === "reschedule" && a.newDeadline && a.goalId && (
                  <button
                    className="btn primary small"
                    onClick={() => {
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
                declineReflection(autoReflection.id);
                setAutoReflection(null);
              }}
            >
              問題はそこではない / 今は使わない
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
