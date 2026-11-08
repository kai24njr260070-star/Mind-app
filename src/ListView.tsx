import type { Goal } from "./types";
import { selectGoal } from "./store";

interface Props {
  goals: Goal[];
}

interface Row {
  goal: Goal;
  depth: number;
}

function flatten(goals: Goal[]): Row[] {
  const byParent = new Map<string, Goal[]>();
  const roots: Goal[] = [];
  for (const g of goals) {
    if (g.parentId === null) roots.push(g);
    else {
      const list = byParent.get(g.parentId) ?? [];
      list.push(g);
      byParent.set(g.parentId, list);
    }
  }
  const sortGoals = (a: Goal, b: Goal) => a.orderIndex - b.orderIndex || a.createdAt - b.createdAt;
  const out: Row[] = [];
  const walk = (list: Goal[], depth: number): void => {
    for (const g of [...list].sort(sortGoals)) {
      out.push({ goal: g, depth });
      walk(byParent.get(g.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

/** 星空操作に不慣れなユーザー向けの、同一ツリーの階層リスト表示(spec §4.4)。 */
export function ListView({ goals }: Props): React.JSX.Element {
  const rows = flatten(goals);
  return (
    <div className="list-view">
      {rows.length === 0 && <p className="list-empty">目標はまだありません。</p>}
      {rows.map(({ goal, depth }, index) => (
        <button
          key={goal.id}
          className={`list-row ${goal.status === "completed" ? "done" : ""}`}
          style={{
            paddingLeft: `${12 + depth * 18}px`,
            // 上から順に「ピョコッ」と現れる
            animationDelay: `${Math.min(index, 10) * 28}ms`,
          }}
          onClick={() => selectGoal(goal.id)}
        >
          <span
            className={`list-icon ${depth === 0 ? "root" : ""}`}
            aria-hidden="true"
          >
            {goal.status === "completed" ? "✓" : depth === 0 ? "✷" : depth === 1 ? "✦" : "·"}
          </span>
          <span className={`list-title ${depth === 0 ? "root" : ""}`}>{goal.title}</span>
        </button>
      ))}
    </div>
  );
}
