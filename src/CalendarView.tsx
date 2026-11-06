import { useMemo, useState } from "react";
import type { Goal } from "./types";
import { selectGoal, setDeadline, setGoalStatus } from "./store";
import { useAppState } from "./useAppState";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 目標カレンダー画面(spec §6)。期限ごとに星(目標)を置き、超過は穏やかに示す。 */
export function CalendarView(): React.JSX.Element {
  const state = useAppState();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [pickDay, setPickDay] = useState<string | null>(null);

  const byDeadline = useMemo(() => {
    const map = new Map<string, Goal[]>();
    for (const g of state.goals) {
      if (!g.deadline) continue;
      const list = map.get(g.deadline) ?? [];
      list.push(g);
      map.set(g.deadline, list);
    }
    return map;
  }, [state.goals]);

  const first = new Date(ym.y, ym.m, 1);
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const offset = first.getDay();
  const todayISO = new Date().toISOString().slice(0, 10);

  const cells: Array<{ day: number | null }> = [
    ...Array.from({ length: offset }, () => ({ day: null })),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1 })),
  ];

  const move = (delta: number) => {
    const d = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
    setPickDay(null);
  };

  const pickGoals = pickDay ? byDeadline.get(pickDay) ?? [] : [];
  const t = todayISO;

  return (
    <div className="page">
      <div className="page-block cal-head">
        <button className="btn ghost small" onClick={() => move(-1)} aria-label="前の月">‹</button>
        <span className="cal-title">{ym.y}年 {ym.m + 1}月</span>
        <button className="btn ghost small" onClick={() => move(1)} aria-label="次の月">›</button>
      </div>

      <div className="page-block">
        <div className="cal-grid" role="grid">
          {WEEKDAYS.map((d) => (
            <div key={d} className="cal-wd" aria-hidden="true">{d}</div>
          ))}
          {cells.map((c, i) => {
            if (c.day === null) return <div key={`x${i}`} />;
            const dayISO = iso(ym.y, ym.m, c.day);
            const goals = byDeadline.get(dayISO) ?? [];
            const overdue = goals.some((g) => g.status === "active" && dayISO < t);
            const isToday = dayISO === t;
            return (
              <button
                key={c.day}
                className={`cal-cell ${pickDay === dayISO ? "pick" : ""} ${isToday ? "today" : ""}`}
                onClick={() => setPickDay(pickDay === dayISO ? null : dayISO)}
              >
                <span className="cal-day">{c.day}</span>
                {goals.slice(0, 3).map((g) => (
                  <span
                    key={g.id}
                    className={`cal-dot ${g.status === "completed" ? "done" : overdue ? "over" : ""}`}
                    title={g.title}
                  >
                    {g.status === "completed" ? "✓" : "✦"}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>

      {pickDay && (
        <div className="page-block">
          <h3 className="page-subtitle">{pickDay} の目標</h3>
          {pickGoals.length === 0 && <p className="list-empty">この日に期限のある目標はありません。</p>}
          {pickGoals.map((g) => {
            const over = g.status === "active" && pickDay < t;
            return (
              <div key={g.id} className="cal-goal-row">
                <span className={`cal-gname ${g.status === "completed" ? "done" : ""}`}>{g.title}</span>
                {over && <span className="chip over">期限超過</span>}
                <div className="row">
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      selectGoal(g.id);
                    }}
                  >
                    詳細
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      const input = window.prompt("新しい期限 (YYYY-MM-DD)", g.deadline ?? pickDay);
                      if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) setDeadline(g.id, input);
                    }}
                  >
                    期限を変更
                  </button>
                  {g.status === "active" && (
                    <button className="btn ghost small" onClick={() => setGoalStatus(g.id, "completed")}>
                      完了
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <p className="cal-note">期限超過は失敗ではありません。必要なら日付をずらすか、目標をさらに分裂させてください(spec §6.4)。</p>
        </div>
      )}
    </div>
  );
}
