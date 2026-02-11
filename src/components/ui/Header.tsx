import { useStore } from '../../store';

export function Header() {
  const localUser = useStore(state => state.localUser);
  const getCredits = useStore(state => state.getCredits);
  const showManager = useStore(state => state.showManager);

  const credits = getCredits();
  const level = localUser.level;

  return (
    <header className="fixed top-0 left-0 right-0 h-[60px] flex justify-between items-center px-6 bg-gradient-to-b from-[rgba(10,10,15,0.95)] to-[rgba(10,10,15,0.8)] border-b border-neon-pink/30 z-[100]">
      <div className="font-display text-2xl font-black tracking-wider">
        <span className="text-neon-cyan text-glow-cyan">VIDEO</span>
        <span className="text-neon-pink text-glow-pink ml-1">CLUB</span>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex flex-col items-center">
          <span className="text-[0.6rem] text-white/50 tracking-wider">CREDITS</span>
          <span className="font-display text-xl text-neon-yellow drop-shadow-[0_0_10px_var(--color-neon-yellow)]">
            {credits}
          </span>
        </div>

        <div className="px-4 py-1 border border-neon-purple rounded">
          <span className="font-display text-xs text-neon-purple tracking-wider">
            {level.toUpperCase()}
          </span>
        </div>

        <button
          className="text-2xl cursor-pointer transition-transform hover:scale-110 hover:rotate-[15deg] active:scale-95 drop-shadow-[0_0_5px_var(--color-neon-yellow)]"
          onClick={showManager}
          aria-label="Appeler le gérant"
        >
          🔔
        </button>
      </div>
    </header>
  );
}
