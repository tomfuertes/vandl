import { useWall } from "../hooks/useWall";
import { Header } from "./Header";
import { GraffitiCard } from "./GraffitiCard";
import { ContributeForm } from "./ContributeForm";

export function Wall() {
  const { pieces, contribute, isSubmitting, totalPieces, turnstileSiteKey } = useWall();

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Header totalPieces={totalPieces} />

      <main className="max-w-6xl mx-auto px-4 py-6 pb-40">
        {pieces.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-zinc-500 text-lg">The wall is empty.</p>
            <p className="text-zinc-600 text-sm mt-1">
              Be the first to leave your mark.
            </p>
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
            {pieces.map((piece) => (
              <GraffitiCard key={piece.id} piece={piece} />
            ))}
          </div>
        )}
      </main>

      <ContributeForm
        onSubmit={contribute}
        isSubmitting={isSubmitting}
        turnstileSiteKey={turnstileSiteKey}
      />
    </div>
  );
}
