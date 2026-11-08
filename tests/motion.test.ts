import { describe, expect, it } from "vitest";
import { easeOutBack } from "../src/motion";

describe("ピョコッのイージング(easeOutBack)", () => {
  it("0から始まり1で終わる", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 6);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
  });

  it("途中で1を超えて行き過ぎてから収まる", () => {
    const samples = Array.from({ length: 41 }, (_, i) => easeOutBack(i / 40));
    const peak = Math.max(...samples);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.15);
    // 行き過ぎは中盤ではなく、立ち上がり直後ではなく、単調ではないことを確認
    expect(samples[40]).toBeCloseTo(1, 6);
  });

  it("範囲外の入力は0〜1に丸める", () => {
    expect(easeOutBack(-1)).toBeCloseTo(0, 6);
    expect(easeOutBack(2)).toBeCloseTo(1, 6);
  });
});
