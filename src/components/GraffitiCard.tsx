import type { GraffitiPiece } from "../types";

export function GraffitiCard({ piece }: { piece: GraffitiPiece }) {
  if (piece.status === "generating") {
    return (
      <div className="graffiti-card break-inside-avoid mb-4 rounded-xl overflow-hidden bg-zinc-800/60 border border-zinc-700/50">
        <div className="aspect-square animate-pulse bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-700 flex items-center justify-center">
          <div className="text-center px-4">
            <div className="text-3xl mb-2">🎨</div>
            <p className="text-zinc-400 text-sm font-medium">Generating...</p>
          </div>
        </div>
        <div className="p-3">
          <p className="text-zinc-300 text-sm leading-relaxed">
            {piece.original_text}
          </p>
          <p className="text-zinc-500 text-xs mt-1">{piece.author_name}</p>
        </div>
      </div>
    );
  }

  if (piece.status === "failed") {
    return (
      <div className="graffiti-card break-inside-avoid mb-4 rounded-xl overflow-hidden bg-red-950/30 border border-red-900/40">
        <div className="aspect-square bg-red-950/20 flex items-center justify-center">
          <div className="text-center px-4">
            <div className="text-3xl mb-2">💥</div>
            <p className="text-red-400 text-sm">Art generation failed</p>
          </div>
        </div>
        <div className="p-3">
          <p className="text-zinc-300 text-sm leading-relaxed">
            {piece.original_text}
          </p>
          <p className="text-zinc-500 text-xs mt-1">{piece.author_name}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="graffiti-card break-inside-avoid mb-4 rounded-xl overflow-hidden bg-zinc-800/60 border border-zinc-700/50 shadow-lg shadow-black/20 animate-fade-in">
      <div className="relative">
        <img
          src={piece.image_data!}
          alt={piece.art_prompt || piece.original_text}
          className="w-full block"
          loading="lazy"
        />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
          <p className="text-white text-sm font-medium leading-snug drop-shadow-lg">
            {piece.original_text}
          </p>
        </div>
      </div>
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-zinc-400 text-xs">{piece.author_name}</span>
        <time className="text-zinc-600 text-xs">
          {new Date(piece.created_at + "Z").toLocaleDateString()}
        </time>
      </div>
    </div>
  );
}
