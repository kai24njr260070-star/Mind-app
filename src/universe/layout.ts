import type { Goal } from "../types";

export interface LayoutNode {
  goal: Goal;
  x: number;
  y: number;
  depth: number;
  /** 親→自分 方向の角度(rad)。ルートは -PI/2 */
  angle: number;
}

export interface FissionGeometry {
  id: string;
  x: number;
  y: number;
  bornAt: number;
}

/**
 * 目標ツリー → 星空の座標系。
 * 親の周囲に2つの子星を広げ、階層が深いほど半径を詰めていく。
 * 複数ルートは独立した星座として円状に配置する。
 */
export function computeLayout(goals: Goal[]): Map<string, LayoutNode> {
  const map = new Map<string, LayoutNode>();
  if (goals.length === 0) return map;

  const children = new Map<string, Goal[]>();
  const roots: Goal[] = [];
  for (const g of goals) {
    if (g.parentId === null) {
      roots.push(g);
    } else {
      const list = children.get(g.parentId) ?? [];
      list.push(g);
      children.set(g.parentId, list);
    }
  }
  const sortGoals = (a: Goal, b: Goal) => a.orderIndex - b.orderIndex || a.createdAt - b.createdAt;

  // ルートが複数なら、星座ごとに周囲へ離して配置
  const rootCenters: Array<[number, number]> =
    roots.length === 1
      ? [[0, 0]]
      : roots.map((_, i) => {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / roots.length + Math.PI / roots.length;
          return [Math.cos(a) * 430, Math.sin(a) * 430];
        });

  const place = (goal: Goal, x: number, y: number, depth: number, angle: number): void => {
    map.set(goal.id, { goal, x, y, depth, angle });
    const kids = [...(children.get(goal.id) ?? [])].sort(sortGoals);
    const n = kids.length;
    if (n === 0) return;

    const ringRadius = depth === 0 ? 200 : Math.max(110, 170 - depth * 18);
    // 子が広がる扇の中心角:親から子へ向かう方向(外向き)
    const span =
      n === 1
        ? 0
        : Math.min(
            (Math.PI * 2 * 11) / 12,
            ((80 + 60 * n) * Math.PI) / 180
          );
    const base = depth === 0 ? angle : angle; // 外向き方向を中心に扇を展開
    kids.forEach((kid, i) => {
      const childAngle = n === 1 ? base : base - span / 2 + (span * (i + 0.5)) / n;
      place(kid, x + Math.cos(childAngle) * ringRadius, y + Math.sin(childAngle) * ringRadius, depth + 1, childAngle);
    });
  };

  roots.forEach((root, i) => {
    const [cx, cy] = rootCenters[i];
    place(root, cx, cy, 0, -Math.PI / 2);
  });

  return map;
}

/** 分裂候補を親星の周り(左右対称)に置く座標。 */
export function fissionCandidatePositions(
  parentX: number,
  parentY: number,
  parentAngle: number,
  count: number
): Array<{ x: number; y: number }> {
  const radius = 120;
  const dir = parentAngle;
  return Array.from({ length: count }, (_, i) => {
    const offset = count === 1 ? 0 : (i - (count - 1) / 2) * (Math.PI * 2) / 9; // ±20°ずつ
    const a = dir + offset;
    return { x: parentX + Math.cos(a) * radius, y: parentY + Math.sin(a) * radius };
  });
}
