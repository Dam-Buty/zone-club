import { useCallback, useRef, useEffect } from 'react'
import { useStore } from '../../store'
import type { Film } from '../../types'

export function DeskFilmPicker() {
  const show = useStore(s => s.showDeskFilmPicker)
  const setShow = useStore(s => s.setShowDeskFilmPicker)
  const deskFilms = useStore(s => s.deskFilms)
  const selectFilm = useStore(s => s.selectFilm)
  const openTimeRef = useRef(0)

  // 300ms timing guard to prevent touch propagation from closing immediately
  useEffect(() => {
    if (show) openTimeRef.current = Date.now()
  }, [show])

  const handleSelect = useCallback((film: Film) => {
    setShow(false)
    selectFilm(film.id)
  }, [setShow, selectFilm])

  const handleClose = useCallback(() => {
    if (Date.now() - openTimeRef.current < 300) return
    setShow(false)
  }, [setShow])

  if (!show || deskFilms.length === 0) return null

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 40,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          padding: '1rem',
          maxWidth: '320px',
          width: '90vw',
        }}
      >
        <div style={{
          color: '#00fff7',
          fontFamily: "'Courier New', monospace",
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: 2,
          textAlign: 'center',
          marginBottom: '0.25rem',
          textShadow: '0 0 8px #00fff7',
        }}>
          Derniers retours
        </div>

        {deskFilms.slice(0, 3).map((film) => (
          <div
            key={film.id}
            onClick={() => handleSelect(film)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.6rem 0.8rem',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '8px',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {film.poster_path ? (
              <img
                src={`/api/poster/w92${film.poster_path}`}
                alt={film.title}
                style={{
                  width: '40px',
                  height: '60px',
                  objectFit: 'cover',
                  borderRadius: '4px',
                  flexShrink: 0,
                }}
              />
            ) : (
              <div style={{
                width: '40px',
                height: '60px',
                backgroundColor: '#333',
                borderRadius: '4px',
                flexShrink: 0,
              }} />
            )}
            <div style={{
              color: '#fff',
              fontFamily: "'Courier New', monospace",
              fontSize: '0.85rem',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            } as React.CSSProperties}>
              {film.title}
            </div>
          </div>
        ))}

        {/* Close button */}
        <div
          onClick={handleClose}
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
            right: '1rem',
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            backgroundColor: 'rgba(0,0,0,0.7)',
            border: '1px solid rgba(255,255,255,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: '1.4rem',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          ✕
        </div>
      </div>
    </div>
  )
}
