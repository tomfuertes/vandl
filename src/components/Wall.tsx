import { type MouseEvent, type TouchEvent, useCallback, useEffect, useRef, useState } from "react";
import { useWall } from "../hooks/useWall";
import type { UserProfile } from "../types";
import { CanvasPiece } from "./CanvasPiece";
import { Header } from "./Header";
import { OnboardingModal } from "./OnboardingModal";
import { PlacementPrompt } from "./PlacementPrompt";
import { RemoteCursor } from "./RemoteCursor";
import { WallHistory } from "./WallHistory";

export function Wall() {
  const { pieces, contribute, isSubmitting, totalPieces, cursors, backgroundImage, sendCursor, wallHistory } =
    useWall();

  const [promptPos, setPromptPos] = useState<{ x: number; y: number } | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("vandl_profile");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.style) {
          setUserProfile(parsed);
          return;
        }
      }
    } catch {
      // Corrupted localStorage — show onboarding
    }
    setShowOnboarding(true);
  }, []);

  const handleOnboardingComplete = useCallback((profile: UserProfile) => {
    setUserProfile(profile);
    setShowOnboarding(false);
  }, []);

  const displayName = userProfile?.name || "Anonymous";

  const toNormalized = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const el = canvasRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }, []);

  const handleCanvasClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const pos = toNormalized(e.clientX, e.clientY);
      if (pos) setPromptPos(pos);
    },
    [toNormalized],
  );

  const handleCanvasTouch = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const pos = toNormalized(touch.clientX, touch.clientY);
      if (pos) setPromptPos(pos);
    },
    [toNormalized],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const pos = toNormalized(e.clientX, e.clientY);
      if (pos) sendCursor(pos.x, pos.y, displayName);
    },
    [toNormalized, sendCursor, displayName],
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!promptPos) return;
      await contribute(
        text,
        userProfile?.name || undefined,
        userProfile?.style || undefined,
        undefined,
        promptPos.x,
        promptPos.y,
      );
      setPromptPos(null);
    },
    [contribute, userProfile, promptPos],
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 text-white flex flex-col">
      {showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}

      <Header
        totalPieces={totalPieces}
        authorName={displayName}
        historyCount={wallHistory.index.length}
        onHistoryToggle={() => setHistoryOpen((prev) => !prev)}
      />

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: spatial canvas — mouse/touch interaction only */}
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
            <p className="text-white/20 text-2xl font-black uppercase tracking-widest select-none">
              Fresh wall — click to tag
            </p>
          </div>
        )}

        <WallHistory
          index={wallHistory.index}
          isLoading={wallHistory.isLoading}
          error={wallHistory.error}
          onRefresh={wallHistory.refreshIndex}
          getSnapshot={wallHistory.getSnapshot}
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      </div>
    </div>
  );
}
