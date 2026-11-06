import { getSettings } from "./store";

let ctx: AudioContext | null = null;

/**
 * ごく短い電子音(spec §8)。既定はオフで、設定で有効化した時だけ鳴る。
 * ユーザー操作起点でしか呼ばないため、ブラウザの自動再生制限にも抵触しない。
 */
export function playChime(kind: "awake" | "scan" | "node" | "done"): void {
  if (!getSettings().sound) return;
  try {
    type AudioCtor = typeof AudioContext;
    const Ctor: AudioCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return;
    ctx = ctx ?? new Ctor();
    if (ctx.state === "suspended") void ctx.resume();

    const notes: Record<typeof kind, Array<{ f: number; t: number; d: number; g: number }>> = {
      awake: [{ f: 110, t: 0, d: 0.6, g: 0.05 }],
      scan: [{ f: 660, t: 0, d: 0.12, g: 0.04 }],
      node: [
        { f: 523, t: 0, d: 0.18, g: 0.05 },
        { f: 784, t: 0.09, d: 0.22, g: 0.04 },
      ],
      done: [
        { f: 659, t: 0, d: 0.2, g: 0.05 },
        { f: 880, t: 0.12, d: 0.3, g: 0.05 },
      ],
    };

    const t0 = ctx.currentTime;
    for (const n of notes[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, t0 + n.t);
      gain.gain.exponentialRampToValueAtTime(n.g, t0 + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + n.t);
      osc.stop(t0 + n.t + n.d + 0.05);
    }
  } catch {
    // 音は必須ではない。失敗しても無音で続行
  }
}
