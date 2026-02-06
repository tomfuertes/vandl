import { useState, useCallback, useRef } from "react";
import { useAgent } from "agents/react";
import type { GraffitiPiece, WallState, WallMessage } from "../types";

export function useWall() {
  const [pieces, setPieces] = useState<GraffitiPiece[]>([]);
  const [totalPieces, setTotalPieces] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasLoadedHistory = useRef(false);

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
      }
    },
  });

  const contribute = useCallback(
    async (text: string, authorName?: string, turnstileToken?: string) => {
      setIsSubmitting(true);
      try {
        await agent.call("contribute", [text, authorName, turnstileToken]);
      } finally {
        setIsSubmitting(false);
      }
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
  };
}
