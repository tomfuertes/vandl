import { useState, useRef, type FormEvent } from "react";

interface ContributeFormProps {
  onSubmit: (text: string, authorName?: string) => Promise<void>;
  isSubmitting: boolean;
}

export function ContributeForm({ onSubmit, isSubmitting }: ContributeFormProps) {
  const [text, setText] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lastSubmitRef = useRef(0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!text.trim() || isSubmitting) return;

    // Client-side debounce: 5s between submissions
    const now = Date.now();
    if (now - lastSubmitRef.current < 5000) {
      setError("Wait a few seconds between submissions.");
      return;
    }
    lastSubmitRef.current = now;

    try {
      await onSubmit(text, authorName || undefined);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="fixed bottom-0 left-0 right-0 z-20 backdrop-blur-xl bg-zinc-950/90 border-t border-zinc-800 p-4"
    >
      <div className="max-w-2xl mx-auto">
        {error && (
          <p className="text-red-400 text-xs mb-2">{error}</p>
        )}
        <div className="flex gap-3 items-end">
          <div className="flex-1 space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write something on the wall..."
              maxLength={500}
              rows={2}
              className="w-full bg-zinc-900/80 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 text-sm resize-none focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-colors"
            />
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Your name (optional)"
              maxLength={50}
              className="w-full bg-zinc-900/80 border border-zinc-700 rounded-lg px-3 py-1.5 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={!text.trim() || isSubmitting}
            className="px-5 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-bold text-sm rounded-lg transition-colors whitespace-nowrap"
          >
            {isSubmitting ? "Spraying..." : "Spray it"}
          </button>
        </div>
      </div>
    </form>
  );
}
