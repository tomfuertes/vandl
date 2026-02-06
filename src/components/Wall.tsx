import { useState, useRef, useCallback, type MouseEvent, type TouchEvent } from "react";
import { useWall } from "../hooks/useWall";
import { Header } from "./Header";
import { CanvasPiece } from "./CanvasPiece";
import { RemoteCursor } from "./RemoteCursor";
import { PlacementPrompt } from "./PlacementPrompt";

export function Wall() {
  const {
    pieces,
    contribute,
    isSubmitting,
    totalPieces,
    cursors,
    backgroundImage,
    sendCursor,
  } = useWall();

  const [promptPos, setPromptPos] = useState<{ x: number; y: number } | null>(null);
  const [authorName, setAuthorName] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);

  const toNormalized = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = canvasRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    },
    []
  );

  const handleCanvasClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const pos = toNormalized(e.clientX, e.clientY);
      if (pos) setPromptPos(pos);
    },
    [toNormalized]
  );

  const handleCanvasTouch = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const pos = toNormalized(touch.clientX, touch.clientY);
      if (pos) setPromptPos(pos);
    },
    [toNormalized]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const pos = toNormalized(e.clientX, e.clientY);
      if (pos) sendCursor(pos.x, pos.y, authorName || "Anonymous");
    },
    [toNormalized, sendCursor, authorName]
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!promptPos) return;
      await contribute(text, authorName || undefined, undefined, promptPos.x, promptPos.y);
      setPromptPos(null);
    },
    [contribute, authorName, promptPos]
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 text-white flex flex-col">
      <Header
        totalPieces={totalPieces}
        authorName={authorName}
        onAuthorNameChange={setAuthorName}
      />

      <div
        ref={canvasRef}
        className="relative flex-1 cursor-spray"
        style={
          backgroundImage
            ? {
                backgroundImage: `url(${backgroundImage})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : {
                background: "radial-gradient(ellipse at center, #18181b 0%, #09090b 100%)",
              }
        }
        onClick={handleCanvasClick}
        onTouchEnd={handleCanvasTouch}
        onMouseMove={handleMouseMove}
      >
        {pieces.map((piece) => (
          <CanvasPiece key={piece.id} piece={piece} />
        ))}

        {cursors.map((cursor) => (
          <RemoteCursor key={cursor.id} cursor={cursor} />
        ))}

        {promptPos && (
          <PlacementPrompt
            pos={promptPos}
            onSubmit={handleSubmit}
            onCancel={() => setPromptPos(null)}
            isSubmitting={isSubmitting}
          />
        )}

        {pieces.length === 0 && !promptPos && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-zinc-500 text-lg">The wall is empty.</p>
              <p className="text-zinc-600 text-sm mt-1">Click anywhere to leave your mark.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
