import { useEffect, useRef, useState } from "react";
import { playChime } from "./sound";

export type StartupKind = "first" | "short";

/**
 * スタートシーケンス(spec §8)。
 * - first : SCENE01〜04(約3.5秒)。スキップ可能。
 * - short : 発光とロゴだけの短縮版(約1.1秒)。
 * prefers-reduced-motion / 設定でのスキップ指定では短縮版を使う。
 * 演出の終了はアプリ準備完了と無関係(ViteのSPAなので常時即時)。
 */
export function StartupAnimation({
  kind,
  onDone,
}: {
  kind: StartupKind;
  onDone: () => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [closing, setClosing] = useState(false);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setClosing(true);
    window.setTimeout(onDone, 500);
  };

  useEffect(() => {
    if (kind === "short") playChime("awake");
    const canvas = canvasRef.current;
    if (!canvas) return finish();
    const ctx = canvas.getContext("2d");
    if (!ctx) return finish();

    const FIRST_TOTAL = 2600;
    const SHORT_TOTAL = 1100;
    const total = kind === "first" ? FIRST_TOTAL : SHORT_TOTAL;
    const start = performance.now();
    let raf = 0;

    const rand = (seed: number) => {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const rnd = rand(781);
    // 遠景の星
    const far = Array.from({ length: 70 }, () => ({
      a: rnd() * Math.PI * 2,
      r: 0.15 + rnd() * 0.85,
      s: 0.4 + rnd() * 1.2,
      delay: rnd() * 900,
    }));
    // 中心へ集まる粒子
    const particles = Array.from({ length: 46 }, () => ({
      a: (rnd() * 2 - 1) * Math.PI,
      d: 0.5 + rnd() * 1.6,
      s: 0.7 + rnd() * 0.8,
    }));
    // 星座(ロゴ周辺)の星
    const constellation = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      return { a, r: 70 + rnd() * 55, size: 1.4 + rnd() * 1.6, delay: i * 90 };
    });

    const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

    const draw = (ts: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(rect.width * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2 - Math.min(30, h * 0.06);
      const t = ts - start;
      const R = Math.min(w, h);

      ctx.fillStyle = "#070b18";
      ctx.fillRect(0, 0, w, h);

      // SCENE01 遠景の星が点在
      if (kind === "first") {
        for (const s of far) {
          const born = ease((t - s.delay * 0.4) / 700);
          if (born <= 0) continue;
          ctx.globalAlpha = born * 0.85 * (0.6 + 0.4 * Math.sin(ts * 0.002 * s.s + s.a));
          ctx.fillStyle = "#cfe0ff";
          ctx.beginPath();
          ctx.arc(cx + Math.cos(s.a) * s.r * R * 0.42, cy + Math.sin(s.a) * s.r * R * 0.3, s.s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // SCENE02 中心の光が強くなり、粒子が集まる。円環が一度だけ広がる
      const glowT = kind === "first" ? Math.min(1, t / 1000) : Math.min(1, t / 260);
      const glowR = (2 + ease(glowT) * 26) * (kind === "short" ? 1.3 : 1);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR * 3);
      grad.addColorStop(0, `rgba(190,225,255,${0.75 * glowT})`);
      grad.addColorStop(0.35, `rgba(127,212,255,${0.35 * glowT})`);
      grad.addColorStop(1, "rgba(127,212,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR * 3, 0, Math.PI * 2);
      ctx.fill();

      if (kind === "first" && t > 500) {
        // 集まる粒子
        const pt = Math.min(1, (t - 500) / 900);
        for (const p of particles) {
          const k = ease(pt) * p.s;
          const d = p.d * R * 0.4 * (1 - k) + 4;
          ctx.globalAlpha = 0.5 * (1 - pt * 0.4);
          ctx.fillStyle = "#e8f3ff";
          ctx.beginPath();
          ctx.arc(cx + Math.cos(p.a) * d, cy + Math.sin(p.a) * d * 0.72, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      const ringT = kind === "first" ? (t - 850) / 700 : (t - 200) / 500;
      if (ringT > 0 && ringT < 1) {
        const rr = ease(ringT) * R * 0.34;
        ctx.strokeStyle = `rgba(127,212,255,${0.5 * (1 - ringT)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // SCENE03 光の線が伸び、星々がつながる
      const constT = kind === "first" ? (t - 1800) / 1000 : (t - 350) / 500;
      if (constT > 0) {
        const k = ease(constT);
        for (const c of constellation) {
          const x = cx + Math.cos(c.a) * c.r * (0.9 + 0.1 * k);
          const y = cy + Math.sin(c.a) * c.r * 0.62;
          // 中央から線を引く
          if (k > c.delay / 1000) {
            const lk = ease((constT - c.delay / 1000) / 0.35);
            ctx.strokeStyle = `rgba(170,220,255,${0.5 * lk})`;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + (x - cx) * lk, cy + (y - cy) * lk);
            ctx.stroke();
          }
          ctx.globalAlpha = Math.max(0, Math.min(1, constT * 1.4));
          ctx.fillStyle = "#dff0ff";
          ctx.shadowColor = "rgba(140,210,255,0.9)";
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(x, y, c.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
      }

      // SCENE04 ロゴ(fade in はCSS)

      if (doneRef.current) return;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const timer = window.setTimeout(() => {
      playChime(kind === "first" ? "done" : "node");
      finish();
    }, total + 200);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 中途退出のためのタップスキップ(spec §8.4)
  return (
    <div
      className={`startup ${closing ? "closing" : ""}`}
      role="presentation"
      onClick={finish}
    >
      <canvas ref={canvasRef} className="startup-canvas" />
      {kind === "first" && (
        <button type="button" className="startup-skip" onClick={finish}>
          スキップ
        </button>
      )}
      <div
        className="startup-logo"
        style={{ animationDelay: kind === "first" ? "0.5s" : "0.15s" }}
        aria-hidden="true"
      >
        <span className="startup-logo-mark">✷</span>
        <span className="startup-logo-text">Mind Signature</span>
        <span className="startup-logo-sub">Your Universe, Your Path.</span>
      </div>
    </div>
  );
}
