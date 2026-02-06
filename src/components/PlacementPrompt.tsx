import { useState, useRef, useEffect } from "react";

interface PlacementPromptProps {
  pos: { x: number; y: number };
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function PlacementPrompt({ pos, onSubmit, onCancel, isSubmitting }: PlacementPromptProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Delay focus to next frame — the canvas click that spawned this component
    // still has the browser's focus, so immediate focus() gets stolen back
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

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

  return (
    <div
      className="absolute z-30 animate-fade-in"
      style={{
        left: `${pos.x * 100}%`,
        top: `${pos.y * 100}%`,
        transform: "translate(-50%, -120%)",
      }}
      onClick={(e) => e.stopPropagation()}
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
          placeholder="Write on the wall..."
          maxLength={500}
          disabled={isSubmitting}
          className="bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-1.5 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-colors w-48"
        />
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-3 py-1.5 text-zinc-400 hover:text-white text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!text.trim() || isSubmitting}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-bold text-sm rounded-lg transition-colors whitespace-nowrap"
        >
          {isSubmitting ? "Spraying..." : "Spray"}
        </button>
      </form>
    </div>
  );
}
