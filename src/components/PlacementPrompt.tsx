import { useEffect, useRef, useState } from "react";

interface PlacementPromptProps {
  pos: { x: number; y: number };
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

// The form is ~44px tall. Default to 56px above click (44 + 12 gap).
const DEFAULT_DY = -56;

export function PlacementPrompt({ pos, onSubmit, onCancel, isSubmitting }: PlacementPromptProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const offsetRef = useRef({ x: 0, y: DEFAULT_DY });

  useEffect(() => {
    // Measure on the first frame (visibility:hidden — no paint, no flash)
    // then clamp edges and reveal
    requestAnimationFrame(() => {
      const el = formRef.current;
      const parent = el?.parentElement;
      if (el && parent) {
        const pr = parent.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        let dy = -er.height - 12;
        let dx = 0;
        if (er.top + dy < pr.top) dy = 12; // flip below
        if (er.left - er.width / 2 < pr.left) dx = er.width / 2 - (er.left - pr.left);
        if (er.left + er.width / 2 > pr.right) dx = -(er.left + er.width / 2 - pr.right);
        offsetRef.current = { x: dx, y: dy };
      }
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (ready) inputRef.current?.focus();
  }, [ready]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const handleSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!text.trim() || isSubmitting) return;
    await onSubmit(text);
  };

  const { x: dx, y: dy } = ready ? offsetRef.current : { x: 0, y: DEFAULT_DY };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only — not an interactive element
    <div
      ref={formRef}
      className={ready ? "absolute z-30 animate-fade-in" : "absolute z-30"}
      style={{
        left: `${pos.x * 100}%`,
        top: `${pos.y * 100}%`,
        translate: `calc(-50% + ${dx}px) ${dy}px`,
        visibility: ready ? "visible" : "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <form
        onSubmit={handleSubmit}
        className="backdrop-blur-xl bg-zinc-900/90 border border-zinc-700/50 rounded-xl p-3 shadow-2xl flex gap-2 items-center"
      >
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          disabled={isSubmitting}
          className="bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-colors w-48"
        />
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-3 py-1.5 text-zinc-400 hover:text-white text-sm transition-colors"
        >
          Nah
        </button>
        <button
          type="submit"
          disabled={!text.trim() || isSubmitting}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-bold text-sm rounded-lg transition-colors whitespace-nowrap"
        >
          {isSubmitting ? "Tagging..." : "Tag it"}
        </button>
      </form>
    </div>
  );
}
