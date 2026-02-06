interface HeaderProps {
  totalPieces: number;
  authorName: string;
  onAuthorNameChange: (name: string) => void;
}

export function Header({ totalPieces, authorName, onAuthorNameChange }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 backdrop-blur-md bg-zinc-950/80 border-b border-zinc-800">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight text-white">
          VANDL
        </h1>
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={authorName}
            onChange={(e) => onAuthorNameChange(e.target.value)}
            placeholder="Your name"
            maxLength={50}
            className="bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-1 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-colors w-32"
          />
          <span className="text-sm text-zinc-400 font-mono">
            {totalPieces} piece{totalPieces !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </header>
  );
}
