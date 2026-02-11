import { useState, useEffect } from 'react'

const mqlCoarse = typeof window !== 'undefined'
  ? window.matchMedia('(pointer: coarse)')
  : null

const mqlWidth = typeof window !== 'undefined'
  ? window.matchMedia('(max-width: 768px)')
  : null

function check(): boolean {
  return (mqlCoarse?.matches ?? false) || (mqlWidth?.matches ?? false)
}

/** Non-reactive getter for use outside React (event handlers, refs). */
export function getIsMobile(): boolean {
  return check()
}

/** Reactive hook — re-renders when device class changes. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(check)

  useEffect(() => {
    const update = () => setIsMobile(check())

    mqlCoarse?.addEventListener('change', update)
    mqlWidth?.addEventListener('change', update)
    return () => {
      mqlCoarse?.removeEventListener('change', update)
      mqlWidth?.removeEventListener('change', update)
    }
  }, [])

  return isMobile
}
