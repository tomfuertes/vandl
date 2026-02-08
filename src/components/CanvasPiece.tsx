import { useEffect, useState } from "react";
import type { GraffitiPiece } from "../types";

export function CanvasPiece({ piece }: { piece: GraffitiPiece }) {
  const [revealed, setRevealed] = useState(piece.status === "complete");

  useEffect(() => {
    if (piece.status === "complete" && !revealed) {
      // Trigger on next frame so the transition actually plays
      requestAnimationFrame(() => setRevealed(true));
    }
  }, [piece.status, revealed]);

  return (
    <div
      className="absolute w-[200px] h-[200px] -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${piece.pos_x * 100}%`, top: `${piece.pos_y * 100}%` }}
    >
      {piece.status === "generating" && (
        <div className="w-full h-full rounded-xl animate-pulse bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-center">
          <span className="text-zinc-400 text-sm">Spraying...</span>
        </div>
      )}

      {piece.status === "complete" && piece.image_data && (
        <img
          src={piece.image_data}
          alt={piece.art_prompt || piece.original_text}
          className="w-full h-full rounded-xl object-cover"
          style={{
            clipPath: revealed ? "circle(100%)" : "circle(0%)",
            transition: "clip-path 600ms ease-out",
          }}
        />
      )}

      {piece.status === "failed" && (
        <div className="w-full h-full rounded-xl bg-red-950/40 border border-red-900/40 flex items-center justify-center">
          <span className="text-red-400 text-sm">Failed</span>
        </div>
      )}

      <p className="text-zinc-500 text-[10px] text-center mt-1 truncate">{piece.author_name}</p>
    </div>
  );
}
