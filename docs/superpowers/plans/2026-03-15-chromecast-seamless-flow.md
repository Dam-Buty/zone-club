# Chromecast Seamless Flow — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the existing cast_sessions API, add auto-detect/resume, block concurrent films, and sync position on receiver stop — for a seamless Chromecast experience.

**Architecture:** Three files modified (store, VHSPlayer, VHSCaseOverlay). One new Zustand field `activeCastFilmId` gates concurrent film launch. VHSPlayer gets 4 surgical edits: auto-detect useEffect, cast_sessions API calls at 4 lifecycle points, IDLE split logic, and player-close cleanup. VHSCaseOverlay reads the store field to block the play button.

**Tech Stack:** Zustand 5, React 19, existing `api.castSessions` client, Google Cast SDK (already loaded).

**Spec:** `docs/superpowers/specs/2026-03-15-chromecast-seamless-flow.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/store/index.ts` | Modify | + `activeCastFilmId`, `setActiveCastFilmId`, guard in `openPlayer`, clear in `closePlayer` |
| `src/components/player/VHSPlayer.tsx` | Modify | Auto-detect cast session, cast_sessions API calls (create/update/end), IDLE split, cleanup |
| `src/components/videoclub/VHSCaseOverlay.tsx` | Modify | Block "Regarder" button when cast active on different film |

No new files. No new dependencies. No new env vars.

---

## Chunk 1: Store + VHSPlayer + VHSCaseOverlay

### Task 1: Add `activeCastFilmId` to Zustand store

**Files:**
- Modify: `src/store/index.ts:109-113` (interface — Player section)
- Modify: `src/store/index.ts:618-624` (implementation — Player section)

- [ ] **Step 1: Add interface fields**

In `src/store/index.ts`, inside the `VideoClubState` interface, after the existing Player block (line 113 `closePlayer: () => void;`), add:

```typescript
  // Cast tracking (ephemeral — not persisted)
  activeCastFilmId: number | null;
  setActiveCastFilmId: (filmId: number | null) => void;
```

- [ ] **Step 2: Add implementation + modify openPlayer guard + modify closePlayer cleanup**

In `src/store/index.ts`, replace the Player implementation block (lines 618-624):

**Before:**
```typescript
      // Player
      isPlayerOpen: false,
      currentPlayingFilm: null,
      openPlayer: (filmId) => {
        set({ isPlayerOpen: true, currentPlayingFilm: filmId, managerVisible: false, chatBackdropUrl: null });
      },
      closePlayer: () => set({ isPlayerOpen: false, currentPlayingFilm: null }),
```

**After:**
```typescript
      // Player
      isPlayerOpen: false,
      currentPlayingFilm: null,
      activeCastFilmId: null,
      setActiveCastFilmId: (filmId) => set({ activeCastFilmId: filmId }),
      openPlayer: (filmId) => {
        const { activeCastFilmId } = get();
        if (activeCastFilmId !== null && activeCastFilmId !== filmId) return;
        set({ isPlayerOpen: true, currentPlayingFilm: filmId, managerVisible: false, chatBackdropUrl: null });
      },
      closePlayer: () => set({ isPlayerOpen: false, currentPlayingFilm: null, activeCastFilmId: null }),
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/rusmirsadikovic/projetsperso/video-club-webgpu && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors related to `activeCastFilmId`.

- [ ] **Step 4: Commit**

```bash
git add src/store/index.ts
git commit -m "feat(cast): add activeCastFilmId to store with openPlayer guard and closePlayer cleanup"
```

---

### Task 2: Wire cast_sessions API + auto-detect in VHSPlayer

**Files:**
- Modify: `src/components/player/VHSPlayer.tsx`

This task has 5 sub-edits in VHSPlayer.tsx. Each targets a specific section.

- [ ] **Step 1: Add store selector for `setActiveCastFilmId`**

At the top of the `VHSPlayer` function, after the existing store selectors (around line 40), add:

```typescript
  const setActiveCastFilmId = useStore(state => state.setActiveCastFilmId);
  const activeCastFilmId = useStore(state => state.activeCastFilmId);
```

- [ ] **Step 2: Add auto-detect cast session useEffect**

Insert a new useEffect after the "Resume from saved position" effect (after line 198), before the FF/RW section:

```typescript
  // ===== Auto-detect existing cast session (ORIGIN_SCOPED reconnect) =====
  useEffect(() => {
    if (!isPlayerOpen) return;
    if (isCastConnected && remoteCastMediaLoaded && playerState !== 'casting') {
      const video = videoRef.current;
      if (video && !video.paused) video.pause();
      setPlayerState('casting');
      setActiveCastFilmId(currentPlayingFilm);
      castFilmIdRef.current = currentPlayingFilm ?? null;
      castDurationRef.current = remoteCastDuration || 0;
      if (currentPlayingFilm) {
        api.castSessions.create(currentPlayingFilm, remoteCastDuration || 0, getRemoteCurrentTime()).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally triggers only on reconnect signals, not playerState changes
  }, [isPlayerOpen, isCastConnected, remoteCastMediaLoaded]);
```

Note: The reduced dependency array is intentional — this effect should only fire when the Cast SDK reconnects (connection + media loaded), not on every playerState or currentPlayingFilm change.

- [ ] **Step 3: Add `setActiveCastFilmId` + `castSessions.create` to `handleCastCurrentVideo`**

In `handleCastCurrentVideo` (around line 681), after `setPlayerState('casting');`, add the store + API calls:

**Before (lines 681-683):**
```typescript
    setPlayerState('casting');
    castFilmIdRef.current = currentPlayingFilm ?? null;
    castDurationRef.current = video?.duration || 0;
```

**After:**
```typescript
    setPlayerState('casting');
    setActiveCastFilmId(currentPlayingFilm);
    castFilmIdRef.current = currentPlayingFilm ?? null;
    castDurationRef.current = video?.duration || 0;
    if (currentPlayingFilm) {
      api.castSessions.create(currentPlayingFilm, video?.duration || 0, video?.currentTime || 0).catch(() => {});
    }
```

Also add `setActiveCastFilmId` to the `useCallback` dependency array of `handleCastCurrentVideo`.

- [ ] **Step 4: Add `castSessions.updatePosition` to 30s progress interval**

In the watch progress reporting effect (around line 753-759), add one line after `updateProgress`:

**Before:**
```typescript
        api.rentals.updateProgress(currentPlayingFilm, progress, remoteTime).catch(() => {});
        return;
```

**After:**
```typescript
        api.rentals.updateProgress(currentPlayingFilm, progress, remoteTime).catch(() => {});
        api.castSessions.updatePosition(currentPlayingFilm, remoteTime).catch(() => {});
        return;
```

- [ ] **Step 5: Add `setActiveCastFilmId(null)` + `castSessions.end` to `handleStop` casting branch**

In `handleStop` (around line 341-357), after `remoteStop();` (line 349), insert:

**Before:**
```typescript
      remoteStop();
      if (hasReachedMilestone() && !rental?.rewindClaimed) {
```

**After:**
```typescript
      remoteStop();
      setActiveCastFilmId(null);
      if (currentPlayingFilm) {
        api.castSessions.end(currentPlayingFilm).catch(() => {});
      }
      if (hasReachedMilestone() && !rental?.rewindClaimed) {
```

Also add `setActiveCastFilmId` to `handleStop`'s dependency array.

- [ ] **Step 6: Replace "Remote Film Ended Detection" useEffect with IDLE split logic**

Replace the entire useEffect at lines 850-868 with the new version that distinguishes film-finished (>95%) from manual-stop:

Replace the entire block from the comment `// ===== Remote Film Ended Detection =====` (line 847) through the closing `]);` (line 868), including the `prevRemoteCastPlayerStateRef` ref declaration at line 849.

**Before (lines 847-868, inclusive — comment + ref + useEffect):**
```typescript
  // ===== Remote Film Ended Detection =====
  // When remote player goes IDLE while we're in casting mode → film finished
  const prevRemoteCastPlayerStateRef = useRef(remoteCastPlayerState);
  useEffect(() => {
    const prev = prevRemoteCastPlayerStateRef.current;
    prevRemoteCastPlayerStateRef.current = remoteCastPlayerState;

    if (playerState !== 'casting') return;
    // Only trigger on transition to IDLE (not initial IDLE)
    if (remoteCastPlayerState === 'IDLE' && prev !== 'IDLE' && prev !== 'UNKNOWN') {
      // Film ended on receiver — same flow as handleEnded
      if (currentPlayingFilm) {
        api.rentals.updateProgress(currentPlayingFilm, 100, 0).catch(() => {});
      }
      if (!rental?.rewindClaimed) {
        setPendingEject(true);
        setRewindPhase('prompt');
      } else {
        closePlayer();
      }
    }
  }, [remoteCastPlayerState, playerState, currentPlayingFilm, rental?.rewindClaimed, closePlayer]);
```

**After:**
```typescript
  // ===== Remote Film Ended / Stopped Detection =====
  // IDLE can mean film finished OR manual stop on receiver — distinguish by position
  const prevRemoteCastPlayerStateRef = useRef(remoteCastPlayerState);
  useEffect(() => {
    const prev = prevRemoteCastPlayerStateRef.current;
    prevRemoteCastPlayerStateRef.current = remoteCastPlayerState;

    if (playerState !== 'casting') return;
    if (remoteCastPlayerState === 'IDLE' && prev !== 'IDLE' && prev !== 'UNKNOWN') {
      const remoteTime = getRemoteCurrentTime();
      const isNearEnd = remoteCastDuration > 0 && remoteTime / remoteCastDuration >= 0.95;

      // End cast session tracking
      setActiveCastFilmId(null);
      if (currentPlayingFilm) {
        api.castSessions.end(currentPlayingFilm).catch(() => {});
      }

      if (isNearEnd) {
        // Film finished — existing rewind prompt flow
        if (currentPlayingFilm) {
          api.rentals.updateProgress(currentPlayingFilm, 100, 0).catch(() => {});
        }
        if (!rental?.rewindClaimed) {
          setPendingEject(true);
          setRewindPhase('prompt');
        } else {
          closePlayer();
        }
      } else {
        // Manual stop on receiver — save position, stay paused
        if (currentPlayingFilm && remoteCastDuration > 0) {
          const progress = Math.round((remoteTime / remoteCastDuration) * 100);
          api.rentals.updateProgress(currentPlayingFilm, progress, remoteTime).catch(() => {});
        }
        const video = videoRef.current;
        if (video) {
          video.currentTime = remoteTime > 0 ? remoteTime : video.currentTime;
        }
        setPlayerState('paused');
      }
    }
  }, [remoteCastPlayerState, playerState, currentPlayingFilm, rental?.rewindClaimed, closePlayer, remoteCastDuration, getRemoteCurrentTime, setActiveCastFilmId]);
```

- [ ] **Step 7: Add `setActiveCastFilmId(null)` + `castSessions.end` to disconnect recovery**

In the "Unexpected Cast Disconnect" useEffect (around line 870-887), add cleanup at the top of the condition body:

**Before:**
```typescript
    if (!isCastConnected && playerState === 'casting') {
      // Cast disconnected unexpectedly — resume local playback from remote position
      const remoteTime = getRemoteCurrentTime();
```

**After:**
```typescript
    if (!isCastConnected && playerState === 'casting') {
      // Cast disconnected unexpectedly — end session, resume local playback
      setActiveCastFilmId(null);
      if (castFilmIdRef.current) {
        api.castSessions.end(castFilmIdRef.current).catch(() => {});
      }
      const remoteTime = getRemoteCurrentTime();
```

Add `setActiveCastFilmId` to this effect's dependency array.

- [ ] **Step 8: Add cast session cleanup to player-close reset**

In the player-close reset effect (around line 963-1000), after the existing `castDurationRef.current = 0;` line (around line 982), add:

```typescript
      // End cast session if active
      if (get().activeCastFilmId) {
        api.castSessions.end(get().activeCastFilmId!).catch(() => {});
      }
```

Note: Use `useStore.getState()` here since this runs during cleanup. Replace `get()` with `useStore.getState()` in this context.

Actually, since we have `activeCastFilmId` from the store selector and `setActiveCastFilmId`, use those directly:

```typescript
      // End cast session if active
      if (activeCastFilmId) {
        api.castSessions.end(activeCastFilmId).catch(() => {});
      }
```

**Important**: use `useStore.getState().activeCastFilmId` (not the selector value) to avoid stale closure — this effect's dep array is `[isPlayerOpen, stopRW]` and must NOT include `activeCastFilmId`:

```typescript
      // End cast session if active (use getState to avoid stale closure)
      const castFilmId = useStore.getState().activeCastFilmId;
      if (castFilmId) {
        api.castSessions.end(castFilmId).catch(() => {});
      }
```

Note: `activeCastFilmId` is already cleared by `closePlayer()` in the store (which sets it to null). The useEffect cleanup here just sends the API call to end the backend session.

- [ ] **Step 9: Verify build**

Run: `cd /Users/rusmirsadikovic/projetsperso/video-club-webgpu && npx tsc --noEmit 2>&1 | head -30`
Expected: No new TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/player/VHSPlayer.tsx
git commit -m "feat(cast): auto-detect session, wire cast_sessions API, IDLE split, disconnect cleanup"
```

---

### Task 3: Block "Regarder" button in VHSCaseOverlay during active cast

**Files:**
- Modify: `src/components/videoclub/VHSCaseOverlay.tsx`

- [ ] **Step 1: Add store selector**

At the top of the VHSCaseOverlay component, alongside existing selectors (around line 352), add:

```typescript
  const activeCastFilmId = useStore((state) => state.activeCastFilmId);
```

- [ ] **Step 2: Add computed blocked state**

After the store selectors, add:

```typescript
  const isCastBlocked = activeCastFilmId !== null && activeCastFilmId !== film?.id;
```

- [ ] **Step 3: Disable desktop play button when cast blocked**

Find the desktop "S'INSTALLER ET REGARDER" button (around line 1084-1095). The button calls `handleSitDown`. Wrap or modify it:

If `isCastBlocked`, show a disabled message instead. Replace the button's `onClick` and add `disabled`:

**Before (the button):**
```tsx
<button ... onClick={handleSitDown}>
  🛋️ S'INSTALLER ET REGARDER
</button>
```

**After:**
```tsx
{isCastBlocked ? (
  <div style={{ color: '#ff6b6b', fontSize: '0.75rem', fontFamily: "'Orbitron', monospace", textAlign: 'center', padding: '8px 0' }}>
    DIFFUSION EN COURS — ARRÊTEZ D'ABORD
  </div>
) : (
  <button ... onClick={handleSitDown}>
    🛋️ S'INSTALLER ET REGARDER
  </button>
)}
```

- [ ] **Step 4: Disable mobile play button when cast blocked**

Apply the same pattern to the mobile "S'INSTALLER" button (around line 1219-1227).

- [ ] **Step 5: Verify build**

Run: `cd /Users/rusmirsadikovic/projetsperso/video-club-webgpu && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/videoclub/VHSCaseOverlay.tsx
git commit -m "feat(cast): block film launch in VHSCaseOverlay when cast is active"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Start dev server**

Run: `PORT=3001 npm run dev`

- [ ] **Step 2: Verify cast flow**

Open `http://localhost:3001` in Chrome. Test sequence:

1. Open a film → click Cast button → verify player switches to "Diffusion en cours"
2. Close the player → reopen → verify auto-detect reconnects to casting mode
3. While casting, try to open a different film → verify it's blocked
4. Stop on receiver (not natural end) → verify position is saved and player shows paused state
5. Let film finish on receiver → verify rewind prompt appears

- [ ] **Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors.

- [ ] **Step 4: Final commit (if any tweaks needed)**

```bash
git add -u
git commit -m "fix(cast): address manual verification findings"
```
