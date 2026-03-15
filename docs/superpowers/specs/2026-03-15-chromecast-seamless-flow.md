# Chromecast Seamless Flow — Design Spec

**Date** : 2026-03-15
**Branche** : `design-V2` (merge dans `main` apres validation)
**Statut** : APPROVED

---

## Contexte

Le casting Google Cast fonctionne (lancer un film sur un Chromecast/TV) mais l'experience est fragmentee :

1. **Pas d'auto-switch** : quand le cast demarre, le player reste en mode lecture locale (video pausee sur le telephone) au lieu de basculer en mode remote
2. **Pas de reprise de session** : si l'utilisateur quitte l'app et revient, le film tourne toujours sur le receiver mais le player ne le sait pas
3. **Pas de blocage** : on peut lancer un nouveau film alors qu'un cast est en cours
4. **Pas de sync position** : si le film est arrete cote receiver (stop sur la TV), la position est perdue
5. **cast_sessions API inutilisee** : le backend (route + lib + DB) et le client frontend existent mais ne sont jamais appeles

## Objectif

Experience fluide et naturelle : le cast demarre, le player bascule en mode remote, on ne peut pas lancer un autre film, et quand le cast s'arrete la position est conservee.

## Contraintes

- Zero nouvelle dependance npm
- Zero nouvelle variable d'environnement
- Tout le code backend (cast_sessions) existe deja sur main
- Le client API frontend (`api.castSessions.create/updatePosition/end`) existe dans `src/api/index.ts:445-466`
- Le Cast SDK est charge dynamiquement depuis le CDN Google (deja en place)
- `autoJoinPolicy: ORIGIN_SCOPED` permet la reconnexion auto depuis la meme origine

## Architecture existante

### useGoogleCast.ts (hook)
- Charge le Cast SDK, cree RemotePlayer + RemotePlayerController
- Expose : `isConnected`, `remoteIsMediaLoaded`, `remotePlayerState`, `remoteCurrentTime`, `remoteDuration`, `castMedia()`, `remotePlayOrPause()`, `remoteStop()`, `getRemoteCurrentTime()`
- Detecte deja une session existante au mount (lignes 294-302) : si `player.isMediaLoaded`, synce l'etat remote
- Aucune modification necessaire

### VHSPlayer.tsx (composant)
- `playerState: 'paused' | 'playing' | 'fastforwarding' | 'rewinding' | 'casting'`
- `handleCastCurrentVideo()` : valide, appelle `castMedia()`, pause local, set `playerState='casting'`
- Intervalle 30s : reporte `watchProgress` via `api.rentals.updateProgress()` (local et remote)
- Disconnect recovery (lignes 870-887) : si `!isCastConnected && playerState === 'casting'`, reprend en local depuis `getRemoteCurrentTime()`
- Film termine sur receiver (lignes 850-868) : detecte `remoteCastPlayerState === 'IDLE'` (transition depuis PLAYING/PAUSED)

### Backend cast_sessions (main)
- `app/api/cast-sessions/route.ts` : POST (create), PATCH (updatePosition), DELETE (end)
- `lib/cast-sessions.ts` : CRUD + `getExpiredUnnotifiedSessions()`
- `lib/cast-session-checker.ts` : polling 60s, push notifications "film termine"
- Table SQLite `cast_sessions` : user_id, film_id, rental_id, duration_seconds, last_position, estimated_end_at, notified, ended

### Frontend API client (src/api/index.ts:445-466)
```typescript
castSessions.create(filmId, durationSeconds, currentPosition) // POST
castSessions.updatePosition(filmId, currentPosition)          // PATCH
castSessions.end(filmId)                                       // DELETE
```
Declare mais jamais appele — c'est le gap a combler.

## Design

### 1. Store Zustand — activeCastFilmId

Ajouter dans `src/store/index.ts` :

```typescript
// Interface
activeCastFilmId: number | null;
setActiveCastFilmId: (filmId: number | null) => void;

// Implementation
activeCastFilmId: null,
setActiveCastFilmId: (filmId) => set({ activeCastFilmId: filmId }),
```

Non persiste (ephemere). Ce champ sert a :
- Bloquer le lancement d'un nouveau film pendant un cast actif
- Identifier quel film est en cours de cast

Guard dans `openPlayer()` :
```typescript
openPlayer: (filmId) => {
  const { activeCastFilmId } = get();
  if (activeCastFilmId !== null && activeCastFilmId !== filmId) return;
  set({ isPlayerOpen: true, currentPlayingFilm: filmId, managerVisible: false, chatBackdropUrl: null });
},
```

### 2. Auto-detect cast session au mount (VHSPlayer.tsx)

Nouveau useEffect :

```typescript
useEffect(() => {
  if (!isPlayerOpen) return;
  if (isCastConnected && remoteCastMediaLoaded && playerState !== 'casting') {
    // Cast SDK auto-reconnected — switch to remote mode
    const video = videoRef.current;
    if (video && !video.paused) video.pause();
    setPlayerState('casting');
    castFilmIdRef.current = currentPlayingFilm ?? null;
    castDurationRef.current = remoteCastDuration || 0;
  }
}, [isPlayerOpen, isCastConnected, remoteCastMediaLoaded]);
```

Scenario : utilisateur ouvre le player, le Cast SDK detecte une session active (ORIGIN_SCOPED), `useGoogleCast` synce `isConnected=true` + `isMediaLoaded=true`, ce useEffect bascule automatiquement en mode casting.

### 3. Integrer cast_sessions API (VHSPlayer.tsx)

#### Au demarrage du cast (handleCastCurrentVideo, apres success)

```typescript
// Apres setPlayerState('casting')
setActiveCastFilmId(currentPlayingFilm);
if (currentPlayingFilm) {
  const duration = video?.duration || 0;
  const position = video?.currentTime || 0;
  api.castSessions.create(currentPlayingFilm, duration, position).catch(() => {});
}
```

#### Pendant le cast (intervalle 30s existant, lignes 749-772)

Ajouter l'appel `updatePosition` a cote de `updateProgress` :

```typescript
if (playerState === 'casting' && remoteCastMediaLoaded && remoteCastDuration > 0) {
  const remoteTime = getRemoteCurrentTime();
  const progress = Math.round((remoteTime / remoteCastDuration) * 100);
  api.rentals.updateProgress(currentPlayingFilm, progress, remoteTime).catch(() => {});
  api.castSessions.updatePosition(currentPlayingFilm, remoteTime).catch(() => {});
  return;
}
```

#### A la fin du cast

Trois endroits ou le cast se termine :

1. **Disconnect inattendu** (useEffect lignes 870-887) — ajouter :
```typescript
setActiveCastFilmId(null);
if (castFilmIdRef.current) {
  api.castSessions.end(castFilmIdRef.current).catch(() => {});
}
```

2. **Film termine sur receiver** (useEffect lignes 850-868, `remoteCastPlayerState === 'IDLE'`) — deja gere, ajouter :
```typescript
setActiveCastFilmId(null);
if (currentPlayingFilm) {
  api.castSessions.end(currentPlayingFilm).catch(() => {});
}
```

3. **Stop explicite** (handleStop quand `playerState === 'casting'`) — ajouter les memes appels.

#### Au close du player (useEffect lignes 963-1000)

Si le cast est actif quand le player se ferme :
```typescript
if (activeCastFilmId) {
  setActiveCastFilmId(null);
  api.castSessions.end(activeCastFilmId).catch(() => {});
}
```

### 4. Sync position a l'arret receiver (VHSPlayer.tsx)

Modifier le useEffect "Remote Film Ended Detection" (lignes 850-868). Actuellement, quand `remoteCastPlayerState === 'IDLE'` il traite ca comme "film termine" (progress 100%). Mais IDLE peut aussi signifier que le user a stoppe manuellement.

Distinction :
- Si `remoteCastPlayerState` passe de `PLAYING/PAUSED/BUFFERING` a `IDLE` et que `getRemoteCurrentTime()` est proche de `remoteCastDuration` (>95%) → film termine (flow existant)
- Sinon → arret manuel, conserver la position

```typescript
useEffect(() => {
  const prev = prevRemoteCastPlayerStateRef.current;
  prevRemoteCastPlayerStateRef.current = remoteCastPlayerState;

  if (playerState !== 'casting') return;
  if (remoteCastPlayerState === 'IDLE' && prev !== 'IDLE' && prev !== 'UNKNOWN') {
    const remoteTime = getRemoteCurrentTime();
    const isNearEnd = remoteCastDuration > 0 && remoteTime / remoteCastDuration >= 0.95;

    // End cast session
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
      // Resume local video at remote position, paused
      const video = videoRef.current;
      if (video) {
        video.currentTime = remoteTime > 0 ? remoteTime : video.currentTime;
      }
      setPlayerState('paused');
    }
  }
}, [remoteCastPlayerState, playerState, currentPlayingFilm, rental?.rewindClaimed, closePlayer, remoteCastDuration, getRemoteCurrentTime]);
```

### 5. Block UI dans VHSCaseOverlay

Dans `src/components/videoclub/VHSCaseOverlay.tsx`, lire `activeCastFilmId` du store. Si actif et different du film affiche :
- Desactiver le bouton "Regarder"
- Afficher "Arretez la diffusion en cours"

## Fichiers modifies

| Fichier | Modifications |
|---------|---------------|
| `src/store/index.ts` | + `activeCastFilmId`, `setActiveCastFilmId`, guard `openPlayer` |
| `src/components/player/VHSPlayer.tsx` | Auto-detect session, cast_sessions API (create/update/end), IDLE split (fin vs arret), cleanup |
| `src/components/videoclub/VHSCaseOverlay.tsx` | Block bouton "Regarder" si cast actif |

## Pas de nouveaux fichiers

Aucun nouveau fichier, aucune nouvelle dependance, aucune nouvelle variable d'environnement.

## Verification

1. Lancer un film → caster → player bascule en "Diffusion en cours"
2. Quitter l'app → revenir → player re-detecte le cast automatiquement
3. Pendant le cast, essayer de lancer un autre film → bloque
4. Stopper le film cote TV (pas fin naturelle) → position conservee, player en pause
5. Film termine naturellement sur TV → prompt rewind (flow existant)
6. Verifier `cast_sessions` en DB : session creee, position mise a jour, session terminee
