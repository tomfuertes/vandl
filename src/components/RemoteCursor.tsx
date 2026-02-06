import type { CursorPosition } from "../types";

export function RemoteCursor({ cursor }: { cursor: CursorPosition }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${cursor.x * 100}%`,
        top: `${cursor.y * 100}%`,
        transition: "left 100ms linear, top 100ms linear",
        transform: "translate(-12px, -24px)",
      }}
    >
      <svg width="24" height="28" viewBox="0 0 32 36" fill="none">
        <rect x="10" y="16" width="12" height="16" rx="2" fill="#9333ea" opacity="0.8" />
        <rect x="12" y="14" width="8" height="4" rx="1" fill="#a855f7" opacity="0.8" />
        <circle cx="16" cy="24" r="3" fill="#d8b4fe" opacity="0.7" />
        <rect x="14" y="10" width="4" height="5" rx="1" fill="#a1a1aa" opacity="0.7" />
        <circle cx="16" cy="7" r="2" fill="#d4d4d8" opacity="0.5" />
        <circle cx="12" cy="5" r="1.5" fill="#d4d4d8" opacity="0.3" />
      </svg>
      <span className="text-[10px] text-purple-300/80 whitespace-nowrap absolute left-6 top-1">
        {cursor.name}
      </span>
    </div>
  );
}
