import { useEffect, useMemo, useRef, useState } from "react";
import { buildItems, searchItems, type CommandItem } from "./paletteSearch";
import type { Goal, Memo } from "./types";

export type PaletteView = "universe" | "memo" | "calendar" | "reflection" | "settings";

interface Props {
  goals: Goal[];
  memos: Memo[];
  onClose: () => void;
  onGoView: (view: PaletteView) => void;
  onPickGoal: (id: string) => void;
}

const KIND_LABEL: Record<CommandItem["kind"], string> = {
  view: "画面",
  goal: "目標",
  memo: "メモ",
};

/**
 * Cmd/Ctrl+K の検索パレット。目標・メモ・画面を横断検索し、選ぶとその場所へ移動する。
 * 目標が増えて「あの星はどこだっけ」となった時のための導線。
 */
export function CommandPalette({
  goals,
  memos,
  onClose,
  onGoView,
  onPickGoal,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => buildItems(goals, memos), [goals, memos]);
  const results = useMemo(() => searchItems(items, query), [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const run = (item: CommandItem): void => {
    if (item.kind === "goal") {
      onPickGoal(item.refId);
      onGoView("universe");
    } else if (item.kind === "memo") {
      onGoView("memo");
    } else {
      onGoView(item.refId as PaletteView);
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = results[active];
      if (item) run(item);
    }
  };

  return (
    <div className="palette-overlay" role="presentation" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="検索"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          value={query}
          placeholder="目標・メモ・画面を検索(Escで閉じる)"
          aria-label="検索語"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" role="listbox" aria-label="検索結果">
          {results.length === 0 && <li className="palette-empty">該当する項目がありません。</li>}
          {results.map((item, i) => (
            <li key={item.key} role="option" aria-selected={i === active}>
              <button
                className={`palette-item ${i === active ? "on" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(item)}
              >
                <span className="palette-kind">{KIND_LABEL[item.kind]}</span>
                <span className="palette-label">{item.label}</span>
                <span className="palette-sub">{item.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
