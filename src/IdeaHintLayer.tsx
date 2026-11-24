import { useEffect, useRef, useState } from "react";
import type { GoalIdea } from "./types";
import { ensureIdeas, pickIdeas } from "./ideaHints";

/** ヒントを出しすぎない間隔。 */
const COOLDOWN_MS = 45_000;
/** 表示しておく時間。 */
const VISIBLE_MS = 7_000;

/**
 * 星画面でスクロールしたときに、ときどき薄く「たとえば」の例を出す。
 * 例はAIが生成したもので、他の利用者のデータは使わない。
 */
export function IdeaHintLayer({
  active,
  hasGoals,
  goalTitles,
}: {
  active: boolean;
  hasGoals: boolean;
  goalTitles: string[];
}): React.JSX.Element | null {
  const [shown, setShown] = useState<GoalIdea[] | null>(null);
  const lastShownAt = useRef(0);
  const goalsKey = goalTitles.join("|");

  useEffect(() => {
    if (!active || !hasGoals) return;
    const trigger = (): void => {
      const now = Date.now();
      if (now - lastShownAt.current < COOLDOWN_MS) return;
      lastShownAt.current = now;
      setShown(pickIdeas(2));
      // 次の機会に向けてAIの例を用意しておく(初回だけ実リクエスト)
      void ensureIdeas({ goals: goalTitles, context: "universe" });
    };
    window.addEventListener("wheel", trigger, { passive: true });
    window.addEventListener("touchmove", trigger, { passive: true });
    return () => {
      window.removeEventListener("wheel", trigger);
      window.removeEventListener("touchmove", trigger);
    };
    // goalTitles は goalsKey で比較する(毎レンダーの新しい配列で張り直さない)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasGoals, goalsKey]);

  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(null), VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [shown]);

  if (!active || !shown) return null;

  return (
    <div className="idea-hint" role="note">
      <span className="idea-hint-label">たとえば</span>
      {shown.map((idea) => (
        <span key={idea.title} className="idea-hint-item" title={idea.why}>
          {idea.title}
        </span>
      ))}
    </div>
  );
}

/**
 * 最初の目標を決める画面に出す、押せる例。
 * AIの例が用意できれば差し替える(取得できなければ端末内の例)。
 */
export function GoalExamples({
  onPick,
}: {
  onPick: (title: string) => void;
}): React.JSX.Element {
  const [ideas, setIdeas] = useState<GoalIdea[]>(() => pickIdeas(3));

  useEffect(() => {
    let alive = true;
    void ensureIdeas({ context: "onboarding" }).then((pool) => {
      if (alive) setIdeas(pickIdeas(3, pool));
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="goal-examples">
      <span className="goal-examples-label">たとえば</span>
      <div className="goal-example-row">
        {ideas.map((idea) => (
          <button
            key={idea.title}
            type="button"
            className="goal-example"
            title={idea.why}
            onClick={() => onPick(idea.title)}
          >
            {idea.title}
          </button>
        ))}
      </div>
    </div>
  );
}
