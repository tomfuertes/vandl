import { useState, useCallback, useRef } from "react";
import { useAgent } from "agents/react";
import type { GraffitiPiece, WallState, WallMessage, CursorPosition } from "../types";

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

  const agent = useAgent<WallState>({
    agent: "graffiti-wall",
    name: "wall",
    onStateUpdate: (state) => {
      setTotalPieces(state.totalPieces);
    },
    onMessage: (event: MessageEvent) => {
      let msg: WallMessage;
      // Parse only — catch is intentionally narrow so runtime errors in the
      // switch handlers below surface instead of being silently swallowed (#15)
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // Non-JSON message (Agents SDK state sync, identity, etc.)
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
          setBackgroundImage(msg.backgroundImage);
          setWallEpoch(msg.wallEpoch);
          break;
      }
    },
  });

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
  };
}
