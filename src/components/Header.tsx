interface HeaderProps {
  totalPieces: number;
  authorName: string;
  historyCount: number;
  onHistoryToggle: () => void;
}

export function Header({ totalPieces, authorName, historyCount, onHistoryToggle }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 backdrop-blur-md bg-zinc-950/80 border-b border-zinc-800">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight text-white">VANDL</h1>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onHistoryToggle}
            className="relative bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-1 text-zinc-400 text-sm hover:text-white hover:border-purple-500/60 transition-colors"
          >
            History
            {historyCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-purple-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {historyCount > 9 ? "9+" : historyCount}
              </span>
            )}
          </button>
          <span className="bg-purple-600/20 border border-purple-500/40 rounded-full px-3 py-1 text-purple-300 text-sm font-medium truncate max-w-[150px]">
            {authorName}
          </span>
          <span className="text-sm text-zinc-400 font-mono">
            {totalPieces} piece{totalPieces !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </header>
  );
}
