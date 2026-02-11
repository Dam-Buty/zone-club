# Architecture Blueprint - Video Club WebGPU

## Module Structure

```
src/
├── components/
│   ├── interior/           # 3D scene components (inside Canvas)
│   │   ├── Aisle.tsx           # Main scene: shelves, cassettes, layout
│   │   ├── WallShelf.tsx       # Wall-mounted shelves with cassettes
│   │   ├── IslandShelf.tsx     # Central island (double-sided, NOUVEAUTÉS)
│   │   ├── CassetteInstances.tsx # InstancedMesh for all cassettes (1 draw call)
│   │   ├── Controls.tsx        # FPS controls + raycasting + collisions
│   │   ├── Manager3D.tsx       # Animated character (Quentin)
│   │   ├── InteractiveTVDisplay.tsx # TV screen triggering terminal
│   │   ├── GenreSectionPanel.tsx    # Genre label panels
│   │   ├── Lighting.tsx        # Optimized lighting (8 lights)
│   │   └── ServiceBell.tsx     # Interactive desk bell
│   ├── terminal/           # TV terminal UI (HTML overlay)
│   │   └── TVTerminal.tsx      # CRT-style terminal (auth, rentals, admin)
│   └── player/             # Video player
│       ├── VHSPlayer.tsx       # Player with VF/VO/subtitles
│       └── VHSControls.tsx     # VCR-style controls
├── services/
│   └── tmdb.ts             # TMDB API client (films, search, top rated)
├── store/
│   └── index.ts            # Zustand store (auth, rentals, UI, player)
├── utils/
│   ├── CassetteTextureArray.ts  # DataArrayTexture for poster atlas
│   ├── CassetteAnimationSystem.ts # Animation registry (legacy)
│   └── TextureCache.ts     # Ref-counted cache (legacy, replaced by DataArrayTexture)
├── api/
│   └── index.ts            # Backend API client
└── data/mock/
    └── films.json          # 140 TMDB IDs (personal videothèque)
```

---

## Scene Graph

```
<Canvas>
  <Aisle>                     # Main scene container
    <Lighting />              # 8 optimized lights
    <Floor />                 # PBR floor with textures
    <Walls />                 # PBR walls
    <WallShelf genre="action" />   # Multiple wall shelves by genre
    <WallShelf genre="comedy" />
    <IslandShelf />           # Central island (NOUVEAUTÉS)
    <CassetteInstances />     # ALL cassettes as 1 InstancedMesh
    <Manager3D />             # Animated character
    <InteractiveTVDisplay />  # TV screen
    <GenreSectionPanel />     # Genre labels
    <ServiceBell />           # Desk bell
  </Aisle>
  <Controls />                # FPS camera + raycasting
  <PostProcessing />          # GTAO + Bloom + Vignette + FXAA
</Canvas>
```

---

## R3F Patterns

### useFrame Consolidation
Instead of 500+ individual useFrame callbacks, use a registry pattern:

```typescript
// Single animation loop reads store once, iterates registry
const animationRegistry = new Map<string, AnimationCallback>();

function AnimationLoop() {
  useFrame((state, delta) => {
    const storeState = useStore.getState();
    animationRegistry.forEach(callback => callback(state, delta, storeState));
  });
}
```

### Zustand Store Rules (CRITICAL)

```typescript
// WRONG: re-renders on EVERY store mutation
const store = useStore(); // Never inside Canvas!

// CORRECT: individual selectors
const films = useStore(state => state.films);
const managerVisible = useStore(state => state.managerVisible);

// For event handlers: no subscription at all
const handleClick = () => {
  const { targetedFilmId } = useStore.getState();
};

// For high-frequency state: imperative subscription
useEffect(() => {
  const unsub = useStore.subscribe((state) => {
    if (state.targetedFilmId !== prevRef.current) {
      // Update without React re-render
      prevRef.current = state.targetedFilmId;
    }
  });
  return unsub;
}, []);
```

### React.memo for Canvas Content

All components inside `<Canvas>` should be wrapped in `React.memo()` with custom comparison when they receive complex props.

---

## State Management

### Zustand Store Shape
```typescript
interface Store {
  // Auth
  user: User | null;
  isAuthenticated: boolean;

  // Films
  films: Record<string, Film[]>;     // Films per aisle/genre
  localTopRated: Film[];             // TMDB top rated (pre-fetched)
  targetedCassetteKey: string | null; // Currently targeted cassette

  // UI
  isPointerLocked: boolean;
  managerVisible: boolean;
  terminalOpen: boolean;

  // Actions
  setFilmsForAisle: (aisle: string, films: Film[]) => void;
  setTargetedCassetteKey: (key: string | null) => void;
}
```

### Cassette Key Format
```
{shelf-type}-{position}-{row}-{col}
```
Based on position (not film ID) for unique identification of repeated geometry slots.
