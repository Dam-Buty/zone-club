import type { StateCreator } from 'zustand'
import type { VideoClubState } from '../index'

// Manager / chat slice — fully self-contained, no cross-slice reads or
// writes (the `managerVisible: false` writes performed by openPlayer in the
// player slice are cross-slice but go FROM player INTO manager).

export interface ManagerSlice {
  managerVisible: boolean
  chatBackdropUrl: string | null
  eventQueue: string[]
  showManager: () => void
  hideManager: () => void
  setChatBackdrop: (url: string | null) => void
  pushEvent: (event: string) => void
  drainEvents: () => string[]
}

// Slice creator typed against the full VideoClubState so the persist-wrapped
// StoreApi passed by the main store is type-compatible. Circular type-only
// import of VideoClubState is fine (types are erased at runtime).
export const createManagerSlice: StateCreator<VideoClubState, [['zustand/persist', unknown]], [], ManagerSlice> = (set, get) => ({
  managerVisible: false,
  chatBackdropUrl: null,
  eventQueue: [],
  showManager: () => set({ managerVisible: true }),
  hideManager: () => set({ managerVisible: false, chatBackdropUrl: null }),
  setChatBackdrop: (url) => set({ chatBackdropUrl: url }),
  pushEvent: (event) => set((state) => ({ eventQueue: [...state.eventQueue, event] })),
  drainEvents: () => {
    const events = get().eventQueue
    set({ eventQueue: [] })
    return events
  },
})
