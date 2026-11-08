import { useEffect, useState } from "react";
import { UniverseView } from "./universe/UniverseView";
import { FissionBar } from "./FissionBar";
import { DetailPanel } from "./DetailPanel";
import { ListView } from "./ListView";
import { MemoView } from "./MemoView";
import { CalendarView } from "./CalendarView";
import { ReflectionView } from "./ReflectionView";
import { SettingsView } from "./SettingsView";
import { StartupAnimation, type StartupKind } from "./Startup";
import { CommandPalette } from "./CommandPalette";
import { createRootGoal, ensureLoaded, getSettings, selectGoal } from "./store";
import { useAppState } from "./useAppState";

type View = "universe" | "list" | "memo" | "calendar" | "reflection" | "settings";

const NAV: Array<{ id: View; label: string; icon: string }> = [
  { id: "universe", label: "宇宙", icon: "✷" },
  { id: "calendar", label: "暦", icon: "▤" },
  { id: "memo", label: "メモ", icon: "✎" },
  { id: "reflection", label: "振返", icon: "◌" },
  { id: "settings", label: "設定", icon: "⚙" },
];

export function App(): React.JSX.Element {
  const state = useAppState();
  const [view, setView] = useState<View>("universe");
  const [newRoot, setNewRoot] = useState("");
  const [startup, setStartup] = useState<StartupKind | null>(null);
  const [palette, setPalette] = useState(false);
  // 起動演出が終わってからUIを「定着」させる(クラス付与でアニメーション開始)
  const [uiReady, setUiReady] = useState(false);

  useEffect(() => {
    ensureLoaded();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { skipStartup } = getSettings();
    setStartup(skipStartup || reduced ? "short" : "first");
    // スキップ/動きを減らす設定では待たせず、すぐ定着させる
    if (skipStartup || reduced) setUiReady(true);
  }, []);

  // 分裂が始まったら宇宙へ返す(メモ→目標化、Reflection→承認して分裂 など)
  useEffect(() => {
    if (state.fission) {
      setView((v) => (v === "memo" || v === "calendar" || v === "reflection" ? "universe" : v));
    }
  }, [state.fission?.parentId, state.fission?.phase]);

  // Cmd/Ctrl+K で検索パレットを開閉する(目標が増えた時のジャンプ手段)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const showFirstGoal = state.goals.length === 0 && !state.fission;
  const primaryView = view === "universe" || view === "list";

  return (
    <div className={`app ${uiReady ? "ui-ready" : ""}`}>
      {view === "universe" || view === "list" ? (
        view === "universe" ? <UniverseView /> : <ListView goals={state.goals} />
      ) : null}

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">✷</span>
          <span className="brand-text">Mind Signature</span>
        </div>
        <div className="topbar-actions">
          <button
            className="btn ghost small"
            aria-label="検索"
            title="検索 (⌘K / Ctrl+K)"
            onClick={() => setPalette(true)}
          >
            検索
          </button>
          {view === "list" && (
            <button
              className="btn ghost small"
              onClick={() => {
                setView("universe");
                selectGoal(state.selection);
              }}
            >
              宇宙へ
            </button>
          )}
          {view === "universe" && (
            <div className="view-toggle" role="tablist">
              <button className="on" aria-pressed="true">宇宙</button>
              <button onClick={() => setView("list")} aria-pressed="false">リスト</button>
            </div>
          )}
          {primaryView && (
            <button
              className="btn ghost small"
              aria-label="新しいルート目標"
              title="新しいルート目標"
              onClick={() => {
                const title = window.prompt("新しいルート目標", "");
                if (title && title.trim()) createRootGoal(title);
              }}
            >
              ＋
            </button>
          )}
        </div>
      </header>

      {/* 承認待ちのReflection提案があれば、ホームに薄い導線だけ出す(spec §9) */}
      {primaryView && state.reflections.some((r) => r.approvalStatus === "pending") && (
        <button className="reflection-banner" onClick={() => setView("reflection")}>
          ◌ 未確認の振り返り提案があります
        </button>
      )}

      {!primaryView && (
        <div className="view-fx" key={view}>
          {view === "memo" && <MemoView />}
          {view === "calendar" && <CalendarView />}
          {view === "reflection" && <ReflectionView />}
          {view === "settings" && <SettingsView />}
        </div>
      )}

      {view === "universe" && showFirstGoal && (
        <div className="first-goal">
          <p className="first-goal-hint">最初の目標をひとつだけ入力してください。あとはAIと一緒に、ゆっくり分裂させていきます。</p>
          <div className="manual-row">
            <input
              type="text"
              value={newRoot}
              placeholder="例:自分だけのAIを開発する"
              maxLength={60}
              onChange={(e) => setNewRoot(e.target.value)}
              onKeyDown={() => {
                // Enter単体では確定しない(ボタン操作のみ)
              }}
            />
            <button
              className="btn primary"
              disabled={newRoot.trim().length === 0}
              onClick={() => {
                createRootGoal(newRoot.trim());
                setNewRoot("");
              }}
            >
              宇宙をはじめる
            </button>
          </div>
        </div>
      )}

      {primaryView && !showFirstGoal && state.fission && <FissionBar />}
      {primaryView && !state.fission && state.selection && <DetailPanel />}

      {/* 分裂中・詳細シート中は誤操作防止のため下ナビを隠す */}
      {!(primaryView && state.fission) && (
        <nav className="bottomnav" aria-label="メインナビゲーション">
          {NAV.map((n) => {
            const active =
              view === n.id || (n.id === "universe" && view === "list");
            return (
              <button
                key={n.id}
                className={`nav-item ${active ? "on" : ""}`}
                aria-pressed={active}
                onClick={() => setView(n.id)}
              >
                <span className="nav-icon" aria-hidden="true">{n.icon}</span>
                <span className="nav-label">{n.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {palette && (
        <CommandPalette
          goals={state.goals}
          memos={state.memos}
          onClose={() => setPalette(false)}
          onGoView={(v) => setView(v)}
          onPickGoal={(id) => selectGoal(id)}
        />
      )}

      {startup && (
        <StartupAnimation
          kind={startup}
          onDone={() => {
            setStartup(null);
            setUiReady(true);
          }}
        />
      )}
    </div>
  );
}
