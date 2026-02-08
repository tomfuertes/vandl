import { useState, useCallback, useRef } from "react";
import { useAgent } from "agents/react";
import type { GraffitiPiece, WallState, WallMessage, CursorPosition } from "../types";
import { useWallHistory } from "./useWallHistory";

export function useWall() {
  const [pieces, setPieces] = useState<GraffitiPiece[]>([]);
  const [totalPieces, setTotalPieces] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | undefined>();
  const [cursors, setCursors] = useState<CursorPosition[]>([]);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [wallEpoch, setWallEpoch] = useState(0);
  const hasLoadedHistory = useRef(false);
  const cursorThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref to break circular dependency: onMessage needs wallHistory.refreshIndex,
  // but wallHistory needs agent. We update the ref after both are created.
  const refreshHistoryRef = useRef<() => void>(() => {});

  const agent = useAgent<WallState>({
    agent: "graffiti-wall",
    name: "wall",
    onStateUpdate: (state) => {
      setTotalPieces(state.totalPieces);
    },
    onMessage: (event: MessageEvent) => {
      let msg: WallMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "wall_history":
          if (!hasLoadedHistory.current) {
            setPieces(msg.pieces);
            setTotalPieces(msg.total);
            setTurnstileSiteKey(msg.turnstileSiteKey);
            setBackgroundImage(msg.backgroundImage);
            setWallEpoch(msg.wallEpoch);
            hasLoadedHistory.current = true;
          }
          break;

        case "piece_added":
          setPieces((prev) => [...prev, msg.piece]);
          break;

        case "piece_updated":
          setPieces((prev) =>
            prev.map((p) => (p.id === msg.piece.id ? msg.piece : p))
          );
          break;

        case "cursor_update":
          setCursors(msg.cursors);
          break;

        case "wall_rotated":
          setPieces([]);
          setBackgroundImage(msg.backgroundImage);
          setWallEpoch(msg.wallEpoch);
          hasLoadedHistory.current = true;
          break;

        case "wall_history_updated":
          refreshHistoryRef.current();
          break;
      }
    },
  });

  const wallHistory = useWallHistory({ agent });
  refreshHistoryRef.current = wallHistory.refreshIndex;

  const contribute = useCallback(
    async (text: string, authorName?: string, turnstileToken?: string, posX?: number, posY?: number) => {
      setIsSubmitting(true);
      try {
        await agent.call("contribute", [text, authorName, turnstileToken, posX, posY]);
      } finally {
        setIsSubmitting(false);
      }
    },
    [agent]
  );

  const sendCursor = useCallback(
    (x: number, y: number, name: string) => {
      if (cursorThrottleRef.current) return;
      agent.send(`C:${x},${y},${name}`);
      cursorThrottleRef.current = setTimeout(() => {
        cursorThrottleRef.current = null;
      }, 100);
    },
    [agent]
  );

  const loadMore = useCallback(async () => {
    const result = await agent.call<{
      pieces: GraffitiPiece[];
      total: number;
    }>("getHistory", [pieces.length]);
    if (result.pieces.length > 0) {
      setPieces((prev) => [...result.pieces, ...prev]);
    }
  }, [agent, pieces.length]);

  return {
    pieces,
    contribute,
    loadMore,
    isSubmitting,
    totalPieces,
    turnstileSiteKey,
    cursors,
    backgroundImage,
    wallEpoch,
    sendCursor,
    wallHistory,
  };
}
