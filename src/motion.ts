/**
 * 0→1 へ、少し行き過ぎてから収まるイージング(easeOutBack)。
 * 生成直後の星やカードを「ピョコッ」と弾ませるために使う。
 * 戻り値は 0 から始まり、途中で約1.1まで行き過ぎてから1に収束する。
 */
export function easeOutBack(t: number, overshoot = 1.7): number {
  const clamped = Math.min(1, Math.max(0, t));
  const p = clamped - 1;
  return 1 + (overshoot + 1) * p * p * p + overshoot * p * p;
}
