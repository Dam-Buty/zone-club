import type { StateCreator } from 'zustand'
import type { VideoClubState } from '../index'

// Tutorial + post-tutorial onboarding slice. One cross-slice write:
// startTutorial flips pointerLockRequested into the interactions slice.
// That field is part of the full VideoClubState so the supertype below
// admits it via the standard slice-creator pattern (circular type-only
// import is safe — types are erased at runtime).

// Camera positions for the 7-step guided tour. Exported from this slice so
// the rest of the codebase can `import { TUTORIAL_WAYPOINTS } from
// '../store/slices/tutorial'` (the original re-export from store/index keeps
// existing call sites working).
export const TUTORIAL_WAYPOINTS: { position: [number, number, number]; lookAt: [number, number, number] }[] = [
  { position: [-3.0, 1.52, 3.0],  lookAt: [0, 1.52, 0] },              // 0: BIENVENUE
  { position: [-2.25, 1.52, -2.5], lookAt: [-1.85, 1.52, -4.15] },     // 1: ALLEES
  { position: [-2.0, 1.52, -3.0], lookAt: [-1.6, 1.2, -4.5] },         // 2: K7
  { position: [-2.0, 1.52, -3.0], lookAt: [-1.6, 1.2, -4.5] },         // 3: ECONOMIE
  { position: [1.5, 1.52, 2.0],   lookAt: [2.4, 1.2, 3.0] },           // 4: COMPTOIR
  { position: [3.2, 1.52, 3.2],   lookAt: [3.8, 2.05, 3.95] },         // 5: LAZONE
  { position: [2.4, 1.52, 1.2],   lookAt: [3.7, 0.75, 1.2] },          // 6: CANAPE
]

export interface TutorialSlice {
  tutorialStep: number | null
  hasCompletedTutorial: boolean
  tutorialCameraTarget: { position: [number, number, number]; lookAt: [number, number, number] } | null
  showPostTutorialAuth: boolean
  showInstallPrompt: boolean
  startTutorial: () => void
  nextTutorialStep: () => void
  skipTutorial: () => void
  dismissPostTutorialAuth: () => void
  setShowInstallPrompt: (show: boolean) => void
  dismissInstallPrompt: () => void
}

export const createTutorialSlice: StateCreator<VideoClubState, [['zustand/persist', unknown]], [], TutorialSlice> = (set, get) => ({
  tutorialStep: null,
  hasCompletedTutorial: false,
  tutorialCameraTarget: null,
  showPostTutorialAuth: false,
  showInstallPrompt: false,
  setShowInstallPrompt: (show: boolean) => set({ showInstallPrompt: show }),
  dismissInstallPrompt: () => set({ showInstallPrompt: false }),
  startTutorial: () => {
    set({
      tutorialStep: 0,
      tutorialCameraTarget: TUTORIAL_WAYPOINTS[0],
      pointerLockRequested: 'unlock',
    })
  },
  nextTutorialStep: () => {
    const current = get().tutorialStep
    if (current === null) return
    const next = current + 1
    if (next >= TUTORIAL_WAYPOINTS.length) {
      // Teleport back to entrance, mark tutorial done.
      set({
        tutorialStep: null,
        tutorialCameraTarget: TUTORIAL_WAYPOINTS[0],
        hasCompletedTutorial: true,
      })
    } else {
      set({ tutorialStep: next, tutorialCameraTarget: TUTORIAL_WAYPOINTS[next] })
    }
  },
  skipTutorial: () => {
    set({
      tutorialStep: null,
      tutorialCameraTarget: TUTORIAL_WAYPOINTS[0],
      hasCompletedTutorial: true,
    })
  },
  dismissPostTutorialAuth: () => {
    set({ showPostTutorialAuth: false, tutorialCameraTarget: null })
  },
})
