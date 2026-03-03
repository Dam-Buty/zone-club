import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../../store'
import api from '../../api'

const NOTE_COLORS: Record<string, string> = {
  yellow: '#fff9c4',
  pink: '#f8bbd0',
  blue: '#b3e5fc',
  green: '#c8e6c9',
}

const COLOR_OPTIONS = ['yellow', 'pink', 'blue', 'green'] as const
const MAX_CONTENT = 288

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function BoardOverlay() {
  const boardOverlayMode = useStore(s => s.boardOverlayMode)
  const closeBoard = useStore(s => s.closeBoard)
  const boardNotes = useStore(s => s.boardNotes)
  const boardCapacity = useStore(s => s.boardCapacity)
  const selectedBoardNoteId = useStore(s => s.selectedBoardNoteId)
  const fetchBoardNotes = useStore(s => s.fetchBoardNotes)
  const requestPointerLock = useStore(s => s.requestPointerLock)
  const isAuthenticated = useStore(s => s.isAuthenticated)
  const authUser = useStore(s => s.authUser)
  const [newContent, setNewContent] = useState('')
  const [newColor, setNewColor] = useState<string>('yellow')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openTimeRef = useRef(0)

  // Timing guard (300ms) for mobile touch propagation
  useEffect(() => {
    if (boardOverlayMode) {
      openTimeRef.current = Date.now()
      setError(null)
      setNewContent('')
      setNewColor('yellow')
    }
  }, [boardOverlayMode])

  // Keyboard: Escape to close
  useEffect(() => {
    if (!boardOverlayMode) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [boardOverlayMode])

  const handleClose = useCallback(() => {
    if (Date.now() - openTimeRef.current < 300) return
    closeBoard()
    requestPointerLock()
  }, [closeBoard, requestPointerLock])

  const handleCreate = useCallback(async () => {
    if (!newContent.trim() || isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    try {
      const cell = useStore.getState().boardCreateCell
      await api.board.create(newContent, newColor, cell?.row, cell?.col)
      await fetchBoardNotes()
      closeBoard()
      requestPointerLock()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setIsSubmitting(false)
    }
  }, [newContent, newColor, isSubmitting, fetchBoardNotes, closeBoard, requestPointerLock])

  const handleDelete = useCallback(async (noteId: number) => {
    try {
      await api.board.delete(noteId)
      await fetchBoardNotes()
      closeBoard()
      requestPointerLock()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    }
  }, [fetchBoardNotes, closeBoard, requestPointerLock])

  if (!boardOverlayMode) return null

  const selectedNote = selectedBoardNoteId !== null
    ? boardNotes.find(n => n.id === selectedBoardNoteId)
    : null

  const isFull = boardCapacity ? boardCapacity.used >= boardCapacity.total : false

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(3px)',
      }}
    >
      {/* ====== CREATE MODE — cork panel ====== */}
      {boardOverlayMode === 'create' && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'relative',
            width: 'min(90vw, 480px)',
            backgroundColor: '#c4956a',
            borderRadius: '6px',
            border: '6px solid #6b4226',
            boxShadow: '0 8px 40px rgba(0,0,0,0.5), inset 0 0 20px rgba(0,0,0,0.1)',
            padding: '1.5rem',
          }}
        >
          <button
            onClick={handleClose}
            style={{
              position: 'absolute', top: '0.4rem', right: '0.6rem',
              background: 'none', border: 'none', color: '#4a2a10',
              fontSize: '1.4rem', cursor: 'pointer', fontWeight: 'bold',
              lineHeight: 1, zIndex: 2,
            }}
          >
            ✕
          </button>

          {error && (
            <div style={{
              textAlign: 'center', color: '#b71c1c',
              fontFamily: "'Courier New', monospace", fontSize: '0.8rem',
              marginBottom: '0.75rem', padding: '0.4rem',
              backgroundColor: 'rgba(183,28,28,0.1)', borderRadius: '4px',
            }}>
              {error}
            </div>
          )}

          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: '0.8rem',
          }}>
            <h3 style={{
              fontFamily: "'Courier New', monospace", color: '#3e1f0a',
              fontSize: '1.1rem', margin: 0, letterSpacing: '1px',
            }}>
              Epingler un mot
            </h3>

            {!isAuthenticated && (
              <div style={{
                fontFamily: "'Courier New', monospace", color: '#5d3a1a',
                fontSize: '0.85rem', textAlign: 'center',
              }}>
                Connectez-vous pour epingler un mot.
              </div>
            )}

            {isAuthenticated && isFull && (
              <div style={{
                fontFamily: "'Courier New', monospace", color: '#5d3a1a',
                fontSize: '0.85rem', textAlign: 'center',
              }}>
                Le tableau est plein !
              </div>
            )}

            {isAuthenticated && !isFull && (
              <>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewColor(c)}
                      style={{
                        width: '32px', height: '32px',
                        backgroundColor: NOTE_COLORS[c],
                        border: newColor === c ? '3px solid #3e1f0a' : '2px solid rgba(62,31,10,0.3)',
                        borderRadius: '3px', cursor: 'pointer',
                        transform: newColor === c ? 'scale(1.15)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    />
                  ))}
                </div>

                <div style={{
                  backgroundColor: NOTE_COLORS[newColor], borderRadius: '3px',
                  padding: '0.8rem', width: '100%',
                  boxShadow: '2px 3px 8px rgba(0,0,0,0.15)', position: 'relative',
                }}>
                  <div style={{
                    position: 'absolute', top: 0, right: 0,
                    width: 0, height: 0, borderStyle: 'solid',
                    borderWidth: '0 14px 14px 0',
                    borderColor: 'transparent #c4956a transparent transparent',
                  }} />
                  <textarea
                    value={newContent}
                    onChange={(e) => {
                      if (e.target.value.length <= MAX_CONTENT) setNewContent(e.target.value)
                    }}
                    placeholder="Ecris ton message ici..."
                    autoFocus
                    style={{
                      width: '100%', minHeight: '120px', background: 'transparent',
                      border: 'none', outline: 'none', resize: 'vertical',
                      fontFamily: "'Courier New', monospace", fontSize: '0.9rem',
                      lineHeight: 1.5, color: '#1a1a1a',
                    }}
                  />
                  <div style={{
                    textAlign: 'right', fontSize: '0.65rem',
                    color: newContent.length > MAX_CONTENT * 0.9 ? '#b71c1c' : 'rgba(0,0,0,0.35)',
                    fontFamily: "'Courier New', monospace",
                  }}>
                    {newContent.length}/{MAX_CONTENT}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.8rem' }}>
                  <button
                    onClick={handleClose}
                    style={{
                      background: 'rgba(93, 58, 26, 0.5)', color: '#fff',
                      border: 'none', borderRadius: '4px', padding: '0.45rem 1rem',
                      fontFamily: "'Courier New', monospace", fontSize: '0.8rem', cursor: 'pointer',
                    }}
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newContent.trim() || isSubmitting}
                    style={{
                      background: !newContent.trim() || isSubmitting ? 'rgba(93, 58, 26, 0.3)' : '#5d3a1a',
                      color: '#fff9c4', border: 'none', borderRadius: '4px',
                      padding: '0.45rem 1rem', fontFamily: "'Courier New', monospace",
                      fontSize: '0.8rem',
                      cursor: !newContent.trim() || isSubmitting ? 'default' : 'pointer',
                      opacity: !newContent.trim() || isSubmitting ? 0.5 : 1,
                    }}
                  >
                    {isSubmitting ? '...' : 'Epingler'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ====== DETAIL MODE — floating post-it ====== */}
      {boardOverlayMode === 'detail' && selectedNote && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: '0.8rem',
            width: 'min(90vw, 380px)',
          }}
        >
          {error && (
            <div style={{
              textAlign: 'center', color: '#ff6b6b',
              fontFamily: "'Courier New', monospace", fontSize: '0.8rem',
              padding: '0.4rem', backgroundColor: 'rgba(183,28,28,0.2)',
              borderRadius: '4px', width: '100%',
            }}>
              {error}
            </div>
          )}

          {/* Realistic post-it */}
          <div style={{
            backgroundColor: NOTE_COLORS[selectedNote.color] || NOTE_COLORS.yellow,
            borderRadius: '2px', width: '100%',
            aspectRatio: '1 / 0.86',
            boxShadow: '3px 4px 14px rgba(0,0,0,0.35), 1px 1px 4px rgba(0,0,0,0.15)',
            position: 'relative', overflow: 'hidden',
          }}>
            {/* Edge shadows */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0,
              width: '100%', height: '4px', background: 'rgba(0,0,0,0.06)',
            }} />
            <div style={{
              position: 'absolute', top: 0, right: 0,
              width: '4px', height: '100%', background: 'rgba(0,0,0,0.06)',
            }} />

            {/* Folded corner */}
            <div style={{
              position: 'absolute', top: 0, right: 0,
              width: 0, height: 0, borderStyle: 'solid',
              borderWidth: '0 28px 28px 0',
              borderColor: 'transparent rgba(0,0,0,0.08) transparent transparent',
            }} />

            {/* Pin */}
            <div style={{
              position: 'absolute', top: '10px', left: '50%',
              transform: 'translateX(-50%)', width: '18px', height: '18px',
              borderRadius: '50%',
              background: 'radial-gradient(circle at 40% 35%, #ff5555 0%, #cc2222 70%)',
              boxShadow: '1px 2px 3px rgba(0,0,0,0.3)',
            }} />

            {/* Text */}
            <div style={{
              padding: '2.2rem 1.2rem 2rem',
              fontFamily: "'Courier New', monospace", fontSize: '1.05rem',
              fontWeight: 'bold', lineHeight: 1.6,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              color: '#1a1a1a',
            }}>
              {selectedNote.content}
            </div>

            {/* Author */}
            <div style={{
              position: 'absolute', bottom: '10px', right: '16px',
              fontFamily: "'Courier New', monospace", fontSize: '0.72rem',
              fontStyle: 'italic', color: 'rgba(0,0,0,0.45)',
            }}>
              — {selectedNote.username}
            </div>

            {/* Date */}
            <div style={{
              position: 'absolute', bottom: '10px', left: '16px',
              fontFamily: "'Courier New', monospace", fontSize: '0.65rem',
              color: 'rgba(0,0,0,0.35)',
            }}>
              {formatDate(selectedNote.created_at)}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.8rem' }}>
            <button
              onClick={handleClose}
              style={{
                background: 'rgba(255,255,255,0.15)', color: '#ddd',
                border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px',
                padding: '0.4rem 1rem', fontFamily: "'Courier New', monospace",
                fontSize: '0.8rem', cursor: 'pointer',
              }}
            >
              Fermer
            </button>

            {authUser && (selectedNote.user_id === authUser.id || authUser.is_admin) && (
              <button
                onClick={() => handleDelete(selectedNote.id)}
                style={{
                  background: 'rgba(183, 28, 28, 0.7)', color: '#fff',
                  border: 'none', borderRadius: '4px', padding: '0.4rem 1rem',
                  fontFamily: "'Courier New', monospace", fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                Supprimer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
