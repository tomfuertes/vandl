import { useEffect, useRef, useState } from "react";
import type { WallHistoryEntry, WallSnapshot } from "../types";

function piecePosition(posX: number | undefined, posY: number | undefined): React.CSSProperties {
  return {
    left: `${(posX ?? 0.5) * 100}%`,
    top: `${(posY ?? 0.5) * 100}%`,
    transform: "translate(-50%, -50%)",
  };
}

interface WallHistoryProps {
  index: WallHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  getSnapshot: (id: string) => Promise<WallSnapshot | null>;
  isOpen: boolean;
  onClose: () => void;
}

function EpochCard({
  entry,
  getSnapshot,
}: {
  entry: WallHistoryEntry;
  getSnapshot: (id: string) => Promise<WallSnapshot | null>;
}) {
  const [snapshot, setSnapshot] = useState<WallSnapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  const doLoad = () => {
    loaded.current = true;
    setLoadError(false);
    getSnapshot(entry.id)
      .then((s) => {
        if (s) setSnapshot(s);
        else setLoadError(true);
      })
      .catch(() => setLoadError(true));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: doLoad intentionally captures entry.id/getSnapshot from props
  useEffect(() => {
    if (loaded.current) return;
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !loaded.current) {
          doLoad();
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [entry.id, getSnapshot]);

  const date = new Date(entry.createdAt);
  const timeStr = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: card click for visual expansion */}
      <div
        ref={cardRef}
        className="flex-shrink-0 w-48 h-full rounded-lg overflow-hidden cursor-pointer border border-zinc-700/50 hover:border-purple-500/50 transition-colors relative group"
        onClick={() => snapshot && setExpanded(true)}
      >
        {loadError ? (
          <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                loaded.current = false;
                doLoad();
              }}
              className="text-zinc-400 text-xs underline"
            >
              Failed to load — tap to retry
            </button>
          </div>
        ) : snapshot ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${snapshot.backgroundImage})` }}
          >
            {snapshot.pieces.map((p) => (
              <div
                key={p.id}
                className="absolute w-8 h-8 rounded-sm overflow-hidden border border-white/20"
                style={piecePosition(p.pos_x, p.pos_y)}
              >
                {p.image_data && (
                  <img src={p.image_data} alt="" className="w-full h-full object-cover" loading="lazy" />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="absolute inset-0 bg-zinc-800 animate-pulse" />
        )}

        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
          <p className="text-xs font-mono text-zinc-300">Epoch {entry.epoch}</p>
          <p className="text-[10px] text-zinc-400">{entry.pieceCount} pieces</p>
          <p className="text-[10px] text-zinc-500">{timeStr}</p>
        </div>
      </div>

      {expanded && snapshot && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop dismiss
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpanded(false)}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only */}
          <div
            className="relative w-full max-w-4xl aspect-video rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${snapshot.backgroundImage})` }}
            >
              {snapshot.pieces.map((p) => (
                <div key={p.id} className="absolute group/piece" style={piecePosition(p.pos_x, p.pos_y)}>
                  {p.image_data && (
                    <img
                      src={p.image_data}
                      alt={p.art_prompt ?? ""}
                      className="w-20 h-20 sm:w-28 sm:h-28 object-cover rounded border border-white/20"
                    />
                  )}
                  <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-white/60 whitespace-nowrap opacity-0 group-hover/piece:opacity-100 transition-opacity">
                    {p.author_name}
                  </div>
                </div>
              ))}
            </div>
            <div className="absolute top-2 right-2">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="bg-black/60 hover:bg-black/80 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm transition-colors"
              >
                &times;
              </button>
            </div>
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <p className="text-sm font-mono text-zinc-200">
                Epoch {snapshot.epoch} &middot; {snapshot.pieceCount} pieces
              </p>
              <p className="text-xs text-zinc-400">{new Date(snapshot.createdAt).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function WallHistory({ index, isLoading, error, onRefresh, getSnapshot, isOpen, onClose }: WallHistoryProps) {
  useEffect(() => {
    if (isOpen) onRefresh();
  }, [isOpen, onRefresh]);

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-0 inset-x-0 z-20 bg-zinc-950/90 backdrop-blur border-t border-zinc-800 transition-transform">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/50">
        <h2 className="text-sm font-bold text-zinc-300 tracking-wide uppercase">Wall History</h2>
        <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">
          Close
        </button>
      </div>

      <div className="h-48 overflow-x-auto overflow-y-hidden p-3 flex gap-3">
        {isLoading && index.length === 0 && (
          <div className="flex items-center justify-center w-full text-zinc-500 text-sm">Loading history...</div>
        )}
        {error && (
          <div className="flex items-center justify-center w-full text-red-400 text-sm">
            {error} —{" "}
            <button type="button" onClick={onRefresh} className="underline ml-1">
              try again
            </button>
          </div>
        )}
        {!isLoading && !error && index.length === 0 && (
          <div className="flex items-center justify-center w-full text-zinc-500 text-sm">
            No past walls yet. History appears after the first wall rotation.
          </div>
        )}
        {index.map((entry) => (
          <EpochCard key={entry.id} entry={entry} getSnapshot={getSnapshot} />
        ))}
      </div>
    </div>
  );
}
