export function Header({ totalPieces }: { totalPieces: number }) {
  return (
    <header className="sticky top-0 z-10 backdrop-blur-md bg-zinc-950/80 border-b border-zinc-800">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight text-white">
          VANDL
        </h1>
        <span className="text-sm text-zinc-400 font-mono">
          {totalPieces} piece{totalPieces !== 1 ? "s" : ""}
        </span>
      </div>
    </header>
  );
}
