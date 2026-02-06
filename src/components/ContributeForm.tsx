import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          size?: "invisible" | "normal" | "compact";
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface ContributeFormProps {
  onSubmit: (text: string, authorName?: string, turnstileToken?: string) => Promise<void>;
  isSubmitting: boolean;
  turnstileSiteKey?: string;
}

export function ContributeForm({ onSubmit, isSubmitting, turnstileSiteKey }: ContributeFormProps) {
  const [text, setText] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lastSubmitRef = useRef(0);
  const tokenRef = useRef<string | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const renderWidget = useCallback(() => {
    if (!turnstileSiteKey || !window.turnstile || !containerRef.current) return;
    // Remove previous widget if exists
    if (widgetIdRef.current) {
      try { window.turnstile.remove(widgetIdRef.current); } catch {}
      widgetIdRef.current = null;
    }
    tokenRef.current = null;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: turnstileSiteKey,
      size: "invisible",
      callback: (token: string) => { tokenRef.current = token; },
      "error-callback": () => { tokenRef.current = null; },
      "expired-callback": () => { tokenRef.current = null; },
    });
  }, [turnstileSiteKey]);

  useEffect(() => {
    // Turnstile script loads async — poll briefly if not ready yet
    if (!turnstileSiteKey) return;
    if (window.turnstile) {
      renderWidget();
      return;
    }
    const interval = setInterval(() => {
      if (window.turnstile) {
        clearInterval(interval);
        renderWidget();
      }
    }, 200);
    return () => clearInterval(interval);
  }, [turnstileSiteKey, renderWidget]);

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
      await onSubmit(text, authorName || undefined, tokenRef.current ?? undefined);
      setText("");
      // Reset widget to get a fresh token for next submission
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        tokenRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      // Reset widget on error too so user can retry
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        tokenRef.current = null;
      }
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
        {/* Invisible Turnstile widget container */}
        <div ref={containerRef} />
      </div>
    </form>
  );
}
