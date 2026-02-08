import type { CursorPosition } from "../types";

export function RemoteCursor({ cursor }: { cursor: CursorPosition }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${cursor.x * 100}%`,
        top: `${cursor.y * 100}%`,
        transition: "left 100ms linear, top 100ms linear",
        transform: "translate(-16px, -4px)",
      }}
    >
      <svg width="32" height="36" viewBox="0 0 40 40" fill="none" role="img" aria-hidden="true">
        <circle cx="20" cy="2" r="1.5" fill="#c084fc" opacity="0.5" />
        <circle cx="15" cy="3.5" r="1" fill="#c084fc" opacity="0.35" />
        <circle cx="24.5" cy="2.5" r="1.2" fill="#c084fc" opacity="0.3" />
        <rect x="19" y="4" width="2" height="2" rx="0.5" fill="#666" />
        <rect x="16.5" y="6" width="7" height="3.5" rx="1.5" fill="#999" stroke="#555" strokeWidth="0.7" />
        <path
          d="M14 13.5 L14 11.5 Q14 9.5 17 9.5 L23 9.5 Q26 9.5 26 11.5 L26 13.5 Z"
          fill="#ccc"
          stroke="#555"
          strokeWidth="0.7"
        />
        <rect x="14" y="13.5" width="12" height="22" rx="0.5" fill="#e4e4e7" stroke="#555" strokeWidth="0.8" />
        <rect x="14.4" y="19" width="11.2" height="11" rx="0.3" fill="#a855f7" />
        <rect x="15.5" y="14" width="1.5" height="21" rx="0.75" fill="white" opacity="0.25" />
        <rect x="13" y="35" width="14" height="2" rx="1" fill="#aaa" stroke="#555" strokeWidth="0.5" />
      </svg>
      <span className="text-[10px] text-zinc-400/80 whitespace-nowrap absolute left-8 top-2">{cursor.name}</span>
    </div>
  );
}
