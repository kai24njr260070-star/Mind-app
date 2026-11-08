import { useEffect, useRef } from "react";
import type { FissionCandidateLive, Goal } from "../types";
import { confirmFission, selectGoal } from "../store";
import { useAppState } from "../useAppState";
import { computeLayout, fissionCandidatePositions, type LayoutNode } from "./layout";
import { easeOutBack } from "../motion";

interface Cam {
  x: number;
  y: number;
  scale: number;
}

const BG_STAR_COUNT = 160;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBgStars(): Array<{ x: number; y: number; r: number; phase: number; speed: number }> {
  const rand = mulberry32(20261031);
  return Array.from({ length: BG_STAR_COUNT }, () => ({
    x: (rand() * 2 - 1) * 2600,
    y: (rand() * 2 - 1) * 2600,
    r: 0.5 + rand() * 1.1,
    phase: rand() * Math.PI * 2,
    speed: 0.4 + rand() * 1.2,
  }));
}

const BG_STARS = makeBgStars();

function starRadius(depth: number): number {
  // 大目標/中目標/小目標 の差をはっきりさせる(spec §4.2)
  return [14, 9.5, 7, 5.5][Math.min(depth, 3)];
}

/** 深さごとの星のスタイル(色+発光)。完了は共通の落ち着いた色。 */
function depthStyle(depth: number): { fill: string; glow: string; blur: number } {
  if (depth <= 0) return { fill: "rgba(250,252,255,1)", glow: "rgba(170,225,255,0.95)", blur: 30 };
  if (depth === 1) return { fill: "rgba(155,225,255,0.98)", glow: "rgba(127,212,255,0.85)", blur: 20 };
  if (depth === 2) return { fill: "rgba(212,196,255,0.96)", glow: "rgba(185,164,255,0.8)", blur: 13 };
  return { fill: "rgba(186,196,238,0.9)", glow: "rgba(170,190,240,0.55)", blur: 9 };
}

function labelStyle(depth: number): { font: string; color: string } {
  if (depth <= 0) return { font: "bold 13px system-ui, -apple-system, sans-serif", color: "rgba(240,246,255,0.98)" };
  if (depth === 1) return { font: "12px system-ui, -apple-system, sans-serif", color: "rgba(225,233,255,0.92)" };
  return { font: "11px system-ui, -apple-system, sans-serif", color: "rgba(215,222,245,0.78)" };
}

function truncateLabel(text: string): string {
  return text.length > 14 ? `${text.slice(0, 13)}…` : text;
}

export function UniverseView(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useAppState();

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const camRef = useRef<Cam>({ x: 0, y: 0, scale: 1 });
  const targetRef = useRef<Cam>({ x: 0, y: 0, scale: 1 });

  // 毎フレーム更新される当たり判定用の幾何(ワールド座標)
  const nodesRef = useRef<Array<{ id: string; x: number; y: number; r: number }>>([]);
  const candRef = useRef<Array<{ id: string; x: number; y: number; parentId: string }>>([]);
  // 分裂終了時にフェードアウトする候補の座標を保持(fx再生用)
  const lastFissionRef = useRef<{
    parentId: string;
    candidates: FissionCandidateLive[];
    positions: Array<{ x: number; y: number }>;
  } | null>(null);
  const fxSeenRef = useRef<number | null>(null);

  // 選択が変わったら、その星が見える位置へカメラを滑らかに寄せる
  useEffect(() => {
    const { selection, goals, fission } = state;
    const focusId = fission?.parentId ?? selection;
    if (!focusId) return;
    const layout = computeLayout(goals);
    let node: LayoutNode | undefined = layout.get(focusId);
    if (!node) {
      const goal: Goal | undefined = goals.find((g) => g.id === focusId);
      if (!goal) return;
      node = layout.get(goal.parentId ?? "");
      if (!node) return;
    }
    targetRef.current = {
      x: node.x,
      y: node.y - 30,
      scale: targetRef.current.scale,
    };
  }, [state.selection, state.fission?.parentId, state.goals]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cam = camRef.current;
    const target = targetRef.current;

    const pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t0: number; moved: boolean }>();
    let pinchDist: number | null = null;

    const cssSize = () => {
      const rect = canvas.getBoundingClientRect();
      return { w: rect.width, h: rect.height };
    };

    const toWorld = (px: number, py: number) => {
      const { w, h } = cssSize();
      return {
        x: (px - w / 2) / cam.scale + cam.x,
        y: (py - h / 2) / cam.scale + cam.y,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), moved: false });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) p.moved = true;

      if (pointers.size >= 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchDist && dist > 0) {
          const factor = Math.min(2.4, Math.max(0.35, (target.scale * dist) / pinchDist)) / target.scale;
          const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          const world = toWorld(mid.x, mid.y);
          const { w, h } = cssSize();
          cam.scale = target.scale = Math.min(2.4, Math.max(0.35, target.scale * factor));
          // ピンチ中点のワールド座標を画面上の同一点に固定
          cam.x = target.x = world.x - (mid.x - w / 2) / cam.scale;
          cam.y = target.y = world.y - (mid.y - h / 2) / cam.scale;
        }
        pinchDist = dist;
      } else if (p.moved) {
        target.x = cam.x = cam.x - dx / cam.scale;
        target.y = cam.y = cam.y - dy / cam.scale;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      pinchDist = null;
      if (!p) return;
      const dt = performance.now() - p.t0;
      if (p.moved || dt > 500) return;
      handleTap(e.clientX, e.clientY, e.shiftKey);
    };

    const handleTap = (px: number, py: number, shiftKey = false) => {
      const rect = canvas.getBoundingClientRect();
      const sx = px - rect.left;
      const sy = py - rect.top;

      const worldPoint = toWorld(sx, sy);

      // ワールド座標リングで判定(タップ許容半径16px)
      const radiusWorld = 20 / cam.scale;
      let best: { id: string; d: number } | null = null;
      for (const c of candRef.current) {
        const d = Math.hypot(c.x - worldPoint.x, c.y - worldPoint.y);
        if (d < radiusWorld + 6 && (!best || d < best.d)) best = { id: c.id, d };
      }
      if (best) {
        const st = stateRef.current;
        // Shift+クリック: 候補が2つ揃っているなら両方採用して分裂を完了
        if (
          shiftKey &&
          st.fission?.phase === "ready" &&
          st.fission.candidates.length === 2
        ) {
          confirmFission(st.fission.candidates, st.fission.candidates.map((c) => c.id));
          return;
        }
        chooseCandidate(best.id);
        return;
      }
      best = null;
      for (const n of nodesRef.current) {
        const d = Math.hypot(n.x - worldPoint.x, n.y - worldPoint.y);
        const hit = Math.max(radiusWorld, n.r + 10 / cam.scale);
        if (d < hit && (!best || d < best.d)) best = { id: n.id, d };
      }
      selectGoal(best ? best.id : null);
    };

    const chooseCandidate = (id: string) => {
      const st = stateRef.current;
      const cand = st.fission?.candidates.find((c) => c.id === id);
      if (!st.fission || !cand) return;
      confirmFission([cand], [cand.id]);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { w, h } = cssSize();
      const rect = canvas.getBoundingClientRect();
      const world = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      const factor = Math.exp(-e.deltaY * 0.0012);
      const ns = Math.min(2.4, Math.max(0.35, target.scale * factor));
      target.scale = ns;
      target.x = world.x - (e.clientX - rect.left - w / 2) / ns;
      target.y = world.y - (e.clientY - rect.top - h / 2) / ns;
      cam.x = target.x;
      cam.y = target.y;
      cam.scale = target.scale;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let raf = 0;
    const draw = (ts: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { w: cssW, h: cssH } = cssSize();
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // カメラのイージング
      cam.x += (target.x - cam.x) * 0.14;
      cam.y += (target.y - cam.y) * 0.14;
      cam.scale += (target.scale - cam.scale) * 0.14;

      // 背景
      ctx.fillStyle = "#070b18";
      ctx.fillRect(0, 0, cssW, cssH);

      const st = stateRef.current;
      const layout = computeLayout(st.goals);
      const toScreenX = (wx: number) => (wx - cam.x) * cam.scale + cssW / 2;
      const toScreenY = (wy: number) => (wy - cam.y) * cam.scale + cssH / 2;

      // 背景の星々(ゆっくり瞬く)
      for (const s of BG_STARS) {
        const alpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(ts * 0.0006 * s.speed + s.phase));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#cfe0ff";
        ctx.beginPath();
        ctx.arc(toScreenX(s.x), toScreenY(s.y), s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 接続線(親子関係)
      ctx.lineWidth = 1;
      for (const [, node] of layout) {
        if (!node.goal.parentId) continue;
        const parent = layout.get(node.goal.parentId);
        if (!parent) continue;
        const isCompleted = node.goal.status === "completed" || parent.goal.status === "completed";
        ctx.strokeStyle = isCompleted ? "rgba(150,130,210,0.25)" : "rgba(120,200,255,0.32)";
        ctx.beginPath();
        ctx.moveTo(toScreenX(parent.x), toScreenY(parent.y));
        ctx.lineTo(toScreenX(node.x), toScreenY(node.y));
        ctx.stroke();
      }

      // 当たり判定リストを更新
      const nodeList: Array<{ id: string; x: number; y: number; r: number }> = [];
      for (const [, node] of layout) {
        const ds = depthStyle(node.depth);
        const isDone = node.goal.status === "completed";
        const rWorld = starRadius(node.depth) * (isDone ? 0.85 : 1);
        // 生成直後は「ピョコッ」と少し行き過ぎてから収まる(createdAtはエポックmsでts(経過ms)と混ぜない)
        const age = Date.now() - node.goal.createdAt;
        const born = age < 900 ? 0.2 + 0.8 * easeOutBack(Math.min(1, age / 900)) : 1;
        nodeList.push({ id: node.goal.id, x: node.x, y: node.y, r: rWorld });
        const sx = toScreenX(node.x);
        const sy = toScreenY(node.y);
        const r = rWorld * born * (0.9 + 0.1 * cam.scale);

        ctx.fillStyle = isDone ? "rgba(139,123,181,0.9)" : ds.fill;
        ctx.shadowColor = isDone ? "rgba(139,123,181,0.8)" : ds.glow;
        ctx.shadowBlur = isDone ? 10 : ds.blur;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.5, r), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // 大目標には軌道リングを描いて他の星と区別できるようにする
        if (node.depth === 0 && !isDone) {
          ctx.save();
          ctx.strokeStyle = "rgba(170,225,255,0.35)";
          ctx.setLineDash([2, 7]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx, sy, r + 9 + Math.sin(ts * 0.001) * 1.2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // 中目標には細い単リング
        if (node.depth === 1 && !isDone) {
          ctx.strokeStyle = "rgba(155,225,255,0.4)";
          ctx.beginPath();
          ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }

        // 選択中の星に輪郭リング
        if (st.selection === node.goal.id) {
          ctx.strokeStyle = "rgba(170,220,255,0.95)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(1.5, r) + 6 + Math.sin(ts * 0.004) * 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1;
        }

        // ラベル(色覚特性への配慮として色に依存しない情報も常に表示)
        const label = truncateLabel(node.goal.title);
        const ls = labelStyle(node.depth);
        ctx.font = ls.font;
        ctx.fillStyle = isDone ? "rgba(170,160,205,0.85)" : ls.color;
        ctx.textAlign = "center";
        ctx.fillText(label, sx, sy + Math.max(1.5, r) + 15);
      }
      nodesRef.current = nodeList;

      // 分裂候補の星
      const candList: Array<{ id: string; x: number; y: number; parentId: string }> = [];
      if (st.fission && st.fission.phase === "ready" && st.fission.candidates.length > 0) {
        const parent = layout.get(st.fission.parentId);
        if (parent) {
          const positions = fissionCandidatePositions(parent.x, parent.y, parent.angle, st.fission.candidates.length);
          lastFissionRef.current = {
            parentId: st.fission.parentId,
            candidates: st.fission.candidates,
            positions,
          };
          fxSeenRef.current = null;

          const parentScreen = { x: toScreenX(parent.x), y: toScreenY(parent.y) };
          st.fission.candidates.forEach((c, i) => {
            const pos = positions[i];
            const sx = toScreenX(pos.x);
            const sy = toScreenY(pos.y);
            const age = Date.now() - c.bornAt;
            const born = Math.min(1, age / 500);
            const pulse = 1 + Math.sin(ts * 0.005 + i * 2) * 0.12;
            const r = 9 * born * pulse;

            // 親への点線
            ctx.save();
            ctx.setLineDash([4, 5]);
            ctx.strokeStyle = "rgba(185,164,255,0.55)";
            ctx.beginPath();
            ctx.moveTo(parentScreen.x, parentScreen.y);
            ctx.lineTo(sx, sy);
            ctx.stroke();
            ctx.restore();

            ctx.fillStyle = "rgba(185,164,255,0.95)";
            ctx.shadowColor = "rgba(185,164,255,0.9)";
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(0.1, r), 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.font = "12px system-ui, -apple-system, sans-serif";
            ctx.fillStyle = "rgba(225,218,255,0.95)";
            ctx.textAlign = "center";
            ctx.fillText(truncateLabel(c.title), sx, sy + r + 16);
            candList.push({ id: c.id, x: pos.x, y: pos.y, parentId: parent.goal.id });
          });
        }
      }
      candRef.current = candList;

      // 分裂結果の演出:選ばれた星は輪郭が膨らみ、落選候補はフェードアウト
      if (st.fx && st.fx.type === "fission-result") {
        if (fxSeenRef.current === null) fxSeenRef.current = ts;
        const fxPos = fxSeenRef.current;
        const dt = ts - fxPos;
        for (const gid of st.fx.chosenIds) {
          const node = layout.get(gid);
          if (!node) continue;
          const sx = toScreenX(node.x);
          const sy = toScreenY(node.y);
          const rr = 12 + Math.min(1, dt / 700) * 30;
          ctx.strokeStyle = `rgba(190,170,255,${0.9 * (1 - dt / 900)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy, rr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        const lf = lastFissionRef.current;
        if (lf && dt < 900) {
          lf.candidates.forEach((c, i) => {
            if (!st.fx?.rejectedIds.includes(c.id)) return;
            const pos = lf.positions[i];
            const sx = toScreenX(pos.x);
            const sy = toScreenY(pos.y);
            const alpha = 1 - dt / 900;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = "rgba(185,164,255,0.8)";
            ctx.beginPath();
            ctx.arc(sx, sy, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = "12px system-ui, -apple-system, sans-serif";
            ctx.fillStyle = "rgba(225,218,255,0.9)";
            ctx.textAlign = "center";
            ctx.fillText(truncateLabel(c.title), sx, sy + 25);
            ctx.globalAlpha = 1;
          });
        }
      } else if (!st.fx) {
        fxSeenRef.current = null;
        lastFissionRef.current = null;
      }

      // 加算的に淡く光る中心グロー(装飾・最小限)
      const grad = ctx.createRadialGradient(cssW / 2, cssH / 2, 0, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.7);
      grad.addColorStop(0, "rgba(30,50,110,0.20)");
      grad.addColorStop(1, "rgba(7,11,24,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cssW, cssH);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="universe-canvas" />;
}
