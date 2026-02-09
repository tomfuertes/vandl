import { useCallback, useEffect, useRef, useState } from "react";

interface OnboardingModalProps {
  onComplete: (profile: { name: string; style: string }) => void;
}

const STYLE_PRESETS = [
  "Bold geometric shapes",
  "Dreamy watercolor wash",
  "Gritty stencil layers",
  "Vibrant comic book pop",
  "Minimalist line work",
  "Photorealistic mural",
];

export function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [phase, setPhase] = useState<"form" | "handoff">("form");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const canSubmit = style.trim().length >= 5;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const profile = {
      name: name.trim() || "Anonymous",
      style: style.trim(),
    };
    localStorage.setItem("vandl_profile", JSON.stringify(profile));
    setPhase("handoff");
    setTimeout(() => onComplete(profile), 1200);
  }, [canSubmit, name, style, onComplete]);

  if (phase === "handoff") {
    return (
      <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
        <p className="text-4xl font-black uppercase tracking-widest text-white animate-handoff">Tag away</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
      <div className="bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-2xl p-8 max-w-md w-full animate-fade-in">
        <h2 className="text-2xl font-black tracking-tight text-white mb-1">Welcome to VANDL</h2>
        <p className="text-zinc-400 text-sm mb-6">Set your tag name and art style before you hit the wall.</p>

        <label className="block text-sm font-medium text-zinc-300 mb-1" htmlFor="onboard-name">
          Name
        </label>
        <input
          ref={nameRef}
          id="onboard-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Anonymous"
          maxLength={50}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-colors mb-5"
        />

        <label className="block text-sm font-medium text-zinc-300 mb-2" htmlFor="onboard-style">
          Art style
        </label>
        <div className="flex flex-wrap gap-2 mb-3">
          {STYLE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setStyle(preset)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                style === preset
                  ? "bg-purple-600 border-purple-500 text-white"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white hover:border-purple-500/60"
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
        <input
          id="onboard-style"
          type="text"
          value={style}
          onChange={(e) => setStyle(e.target.value.slice(0, 150))}
          placeholder="Describe your vibe (min 5 chars)"
          maxLength={150}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-colors mb-1"
        />
        <p className="text-zinc-500 text-xs mb-5">{style.trim().length}/150 — this shapes how your tags look</p>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="w-full py-2.5 rounded-lg font-bold text-sm uppercase tracking-wider transition-colors bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Let's go
        </button>
      </div>
    </div>
  );
}
