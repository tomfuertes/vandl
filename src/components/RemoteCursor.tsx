import type { CursorPosition } from "../types";

export function RemoteCursor({ cursor }: { cursor: CursorPosition }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${cursor.x * 100}%`,
        top: `${cursor.y * 100}%`,
        transition: "left 100ms linear, top 100ms linear",
      }}
    >
      <div className="w-3 h-3 rounded-full bg-purple-500/70 shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
      <span className="text-[10px] text-purple-300/80 ml-2 whitespace-nowrap">
        {cursor.name}
      </span>
    </div>
  );
}
