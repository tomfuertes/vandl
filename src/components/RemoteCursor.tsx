import type { CursorPosition } from "../types";

export function RemoteCursor({ cursor }: { cursor: CursorPosition }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${cursor.x * 100}%`,
        top: `${cursor.y * 100}%`,
        transition: "left 100ms linear, top 100ms linear",
        transform: "translate(-16px, -32px)",
      }}
    >
      <svg width="32" height="36" viewBox="0 0 40 40" fill="none" role="img" aria-hidden="true">
        <rect x="12" y="18" width="16" height="20" rx="3" fill="#d4d4d4" stroke="#999" strokeWidth="0.5" />
        <rect x="14" y="16" width="12" height="4" rx="1.5" fill="#bbb" />
        <rect x="17" y="10" width="6" height="7" rx="1.5" fill="#999" />
        <circle cx="20" cy="28" r="4" fill="none" stroke="#aaa" strokeWidth="0.7" />
        <line x1="16" y1="22" x2="24" y2="22" stroke="#bbb" strokeWidth="0.5" />
        <circle cx="20" cy="7" r="2.5" fill="#e5e5e5" opacity="0.5" />
        <circle cx="14" cy="5" r="1.5" fill="#e5e5e5" opacity="0.3" />
      </svg>
      <span className="text-[10px] text-zinc-400/80 whitespace-nowrap absolute left-8 top-2">{cursor.name}</span>
    </div>
  );
}
