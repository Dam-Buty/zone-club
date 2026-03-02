import { useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { TUTORIAL_WAYPOINTS } from '../../store';
import { useIsMobile } from '../../hooks/useIsMobile';

const DIALOGUES = [
  // 0: BIENVENUE — Rick intro + lore
  "Salut ! Moi c'est Rick, le gerant. On est en 1995, mais... disons que je voyage un peu. Dans le temps, les dimensions... j'ai ramene quelques pepites du futur. Bienvenue dans mon videoclub !",
  // 1: ALLEES
  "Chaque allee est dediee a un genre : Action, Horreur, SF, Comedie, Classiques... Certaines K7 viennent d'autres epoques, d'autres dimensions. Explorez, y'a des trucs que personne n'a encore vus.",
  // 2: K7 SELECTION — floating panel at Rick's head level, VHS buttons visible with annotations
  "Approchez-vous d'une K7 et cliquez pour l'attraper. Glissez pour parcourir les cassettes. Voici les options a votre disposition :",
  // 3: ECONOMIE — rendered as structured list (see STEP3_REWARDS below)
  null,
  // 4: COMPTOIR / RICK
  "Passez me voir au comptoir, on discute cinema ! Je connais tous les films ici par coeur. Je peux vous conseiller, et si un film vous manque, commandez-le — j'irai le chercher lors de mon prochain voyage.",
  // 5: LAZONE TV
  "Ici c'est La Zone TV — notre petite tele au-dessus du comptoir. Zappez les chaines pour decouvrir des trucs. C'est un peu ma fenetre sur les autres dimensions...",
  // 6: TV SONY / CANAPE
  "Et la, le canape et la TV Sony Trinitron ! Installez-vous pour regarder vos films ici, sur place. C'est la meilleure facon de kiffer. Bon visionnage !",
];

// Per-step layout config
// dialoguePosition: 'floating' = K7 demo step (panel at Rick's head level, VHS buttons visible)
const STEP_LAYOUT: {
  portraitSide: 'left' | 'right';
  mirror: boolean;
  portraitOffset: { desktop: string; mobile: string };
  dialoguePosition: 'bottom' | 'floating';
}[] = [
  { portraitSide: 'left',  mirror: false, portraitOffset: { desktop: '0%', mobile: '0%' },    dialoguePosition: 'bottom' },   // 0: Bienvenue
  { portraitSide: 'left',  mirror: false, portraitOffset: { desktop: '0%', mobile: '-15%' },  dialoguePosition: 'bottom' },   // 1: Allees
  { portraitSide: 'left',  mirror: false, portraitOffset: { desktop: '0%', mobile: '-15%' },  dialoguePosition: 'bottom' }, // 2: K7 demo (mobile: bottom, desktop: overridden to floating below)
  { portraitSide: 'left',  mirror: false, portraitOffset: { desktop: '0%', mobile: '-15%' },  dialoguePosition: 'floating' }, // 3: Economie (K7 stays open)
  { portraitSide: 'left',  mirror: false, portraitOffset: { desktop: '0%', mobile: '-15%' },  dialoguePosition: 'bottom' },   // 4: Comptoir
  { portraitSide: 'right', mirror: true,  portraitOffset: { desktop: '0%', mobile: '-15%' },  dialoguePosition: 'bottom' },   // 5: LaZone
  { portraitSide: 'left',  mirror: false, portraitOffset: { desktop: '0%', mobile: '-15%' },  dialoguePosition: 'bottom' },   // 6: Canape
];

// Step 3 economy — structured reward list
const STEP3_INTRO = "La location coute 1 a 2 credits — vous demarrez avec 5. Voici comment en gagner :";
const STEP3_REWARDS = [
  { label: "Rembobiner la cassette", credit: "+1 cr" },
  { label: "Laisser une critique", credit: "+1 cr" },
  { label: "Retourner le film sous 24h", credit: "+1 cr" },
  { label: "Bonus hebdomadaire (fidelite)", credit: "+1 cr" },
];

const TOTAL_STEPS = TUTORIAL_WAYPOINTS.length;

export default function TutorialOverlay() {
  const isMobile = useIsMobile();
  const tutorialStep = useStore((s) => s.tutorialStep);
  const nextTutorialStep = useStore((s) => s.nextTutorialStep);
  const skipTutorial = useStore((s) => s.skipTutorial);
  const [imgErrors, setImgErrors] = useState<Set<number>>(new Set());
  const demoFilmRef = useRef<number | null>(null);

  const handleImgError = useCallback((step: number) => {
    setImgErrors((prev) => new Set(prev).add(step));
  }, []);

  // Step 2: open a random K7 to demo the interface; step 3: keep it open; other steps: close
  useEffect(() => {
    if (tutorialStep === null) {
      // Tutorial ended — close any open K7
      if (demoFilmRef.current !== null) {
        useStore.getState().selectFilm(null);
        demoFilmRef.current = null;
      }
      return;
    }

    if (tutorialStep === 2) {
      const { films, selectFilm } = useStore.getState();
      const allFilms = Object.values(films).flat();
      if (allFilms.length > 0) {
        const randomFilm = allFilms[Math.floor(Math.random() * allFilms.length)];
        demoFilmRef.current = randomFilm.id;
        selectFilm(randomFilm.id);
      }
    } else if (tutorialStep === 3) {
      // Keep K7 open — do nothing
    } else {
      if (demoFilmRef.current !== null) {
        useStore.getState().selectFilm(null);
        demoFilmRef.current = null;
      } else {
        const { selectedFilmId, selectFilm } = useStore.getState();
        if (selectedFilmId !== null) selectFilm(null);
      }
    }
  }, [tutorialStep]);

  if (tutorialStep === null) return null;

  const dialogue = DIALOGUES[tutorialStep] ?? '';
  const isLast = tutorialStep >= TOTAL_STEPS - 1;
  const hasImgError = imgErrors.has(tutorialStep);
  const layoutRaw = STEP_LAYOUT[tutorialStep] ?? { portraitSide: 'left', mirror: false, portraitOffset: { desktop: '0%', mobile: '0%' }, dialoguePosition: 'bottom' };
  const layout = {
    ...layoutRaw,
    portraitOffset: isMobile ? layoutRaw.portraitOffset.mobile : layoutRaw.portraitOffset.desktop,
    // Step 2 desktop: floating (right panel visible), mobile: bottom (K7-only view)
    dialoguePosition: (!isMobile && tutorialStep === 2) ? 'floating' as const : layoutRaw.dialoguePosition,
  };
  const portraitOnRight = layout.portraitSide === 'right';
  const isFloating = layout.dialoguePosition === 'floating';

  const dots = Array.from({ length: TOTAL_STEPS }, (_, i) => (
    <div key={i} style={{
      width: 12,
      height: 12,
      borderRadius: '50%',
      background: i === tutorialStep ? '#00e5ff' : i < tutorialStep ? 'rgba(0,229,255,0.4)' : 'rgba(255,255,255,0.2)',
      border: i === tutorialStep ? '2px solid #00e5ff' : '1px solid rgba(255,255,255,0.15)',
      boxShadow: i === tutorialStep ? '0 0 12px rgba(0,229,255,0.6)' : 'none',
      transition: 'all 0.3s',
    }} />
  ));

  const nextBtnStyle: React.CSSProperties = {
    padding: '12px 32px',
    background: 'rgba(255, 45, 149, 0.2)',
    border: '2px solid #ff2d95',
    borderRadius: 6,
    color: '#ffffff',
    fontFamily: "'Orbitron', monospace",
    fontSize: '0.85rem',
    cursor: 'pointer',
    letterSpacing: 2,
    boxShadow: '0 0 16px rgba(255,45,149,0.3)',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  };

  const skipBtnStyle: React.CSSProperties = {
    padding: '8px 20px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 4,
    color: 'rgba(255,255,255,0.35)',
    fontFamily: "'Orbitron', monospace",
    fontSize: '0.68rem',
    cursor: 'pointer',
    letterSpacing: 1,
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 250,
      pointerEvents: 'none',
    }}>
      {/* Step dots — always top center */}
      <div style={{
        position: 'absolute',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 10,
        pointerEvents: 'none',
      }}>
        {dots}
      </div>

      {/* Large transparent portrait — shown on all steps (except img errors) */}
      {!hasImgError && (
        <img
          src={`/manager-portrait-${tutorialStep}.png`}
          alt="Rick"
          style={{
            position: 'fixed',
            bottom: 0,
            [portraitOnRight ? 'right' : 'left']: layout.portraitOffset,
            height: '65vh',
            width: 'auto',
            objectFit: 'contain',
            objectPosition: 'bottom',
            transform: layout.mirror ? 'scaleX(-1)' : 'none',
            pointerEvents: 'none',
            filter: 'drop-shadow(0 0 20px rgba(0,229,255,0.15))',
            zIndex: 280,
            transition: 'left 0.4s ease, right 0.4s ease',
          }}
          onError={() => handleImgError(tutorialStep)}
        />
      )}

      {/* Swipe chevrons — step 2 mobile only (desktop uses blinking nav arrows in VHSCaseOverlay) */}
      {tutorialStep === 2 && isMobile && (
        <>
          <style>{`
            @keyframes tutorialChevronLeft {
              0%, 100% { transform: translateY(-50%); opacity: 0.3; }
              50% { transform: translateX(-12px) translateY(-50%); opacity: 1; }
            }
            @keyframes tutorialChevronRight {
              0%, 100% { transform: translateY(-50%); opacity: 0.3; }
              50% { transform: translateX(12px) translateY(-50%); opacity: 1; }
            }
          `}</style>
          {/* Left chevron — above Rick portrait (zIndex 290 > 280) */}
          <div style={{
            position: 'fixed',
            top: '25%',
            left: isMobile ? '4%' : '8%',
            zIndex: 290,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            animation: 'tutorialChevronLeft 1.4s ease-in-out infinite',
          }}>
            <span style={{
              fontFamily: "'Orbitron', monospace",
              fontSize: isMobile ? '4rem' : '5.6rem',
              color: 'rgba(255,215,0,0.9)',
              textShadow: '0 0 16px rgba(255,215,0,0.5), 0 0 32px rgba(255,215,0,0.2)',
            }}>‹</span>
            <span style={{
              fontFamily: "'Orbitron', monospace",
              fontSize: isMobile ? '0.7rem' : '0.55rem',
              color: 'rgba(255,215,0,0.7)',
              letterSpacing: 2,
              textShadow: '0 0 8px rgba(255,215,0,0.3)',
            }}>GLISSEZ</span>
          </div>
          {/* Right chevron — above Rick portrait (zIndex 290 > 280) */}
          <div style={{
            position: 'fixed',
            top: '25%',
            right: isMobile ? '4%' : '35%',
            zIndex: 290,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            animation: 'tutorialChevronRight 1.4s ease-in-out infinite',
          }}>
            <span style={{
              fontFamily: "'Orbitron', monospace",
              fontSize: isMobile ? '4rem' : '5.6rem',
              color: 'rgba(255,215,0,0.9)',
              textShadow: '0 0 16px rgba(255,215,0,0.5), 0 0 32px rgba(255,215,0,0.2)',
            }}>›</span>
            <span style={{
              fontFamily: "'Orbitron', monospace",
              fontSize: isMobile ? '0.7rem' : '0.55rem',
              color: 'rgba(255,215,0,0.7)',
              letterSpacing: 2,
              textShadow: '0 0 8px rgba(255,215,0,0.3)',
            }}>GLISSEZ</span>
          </div>
        </>
      )}

      {/* Dialogue panel — position varies by step */}
      {isFloating ? (
        /* ===== FLOATING PANEL — at Rick's head level, above the K7 ===== */
        <div style={{
          position: 'fixed',
          top: '7%',
          left: '3%',
          maxWidth: 450,
          zIndex: 300,
          pointerEvents: 'auto',
          background: 'rgba(0, 4, 12, 0.94)',
          border: '2px solid rgba(0,229,255,0.5)',
          borderRadius: 12,
          padding: '16px 20px',
          boxShadow: '0 0 30px rgba(0,229,255,0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          {/* Name tag */}
          <div style={{
            fontFamily: "'Orbitron', monospace",
            fontSize: '0.72rem',
            color: '#ffd700',
            letterSpacing: 3,
            textTransform: 'uppercase',
            textShadow: '0 0 8px rgba(255,215,0,0.4)',
          }}>
            RICK — LE GERANT
          </div>
          {/* Dialogue */}
          <div style={{
            fontFamily: "'Orbitron', monospace",
            fontSize: '0.82rem',
            color: 'rgba(255,255,255,0.92)',
            lineHeight: 1.7,
          }}>
            {tutorialStep === 3 ? (
              <>
                <div>{STEP3_INTRO}</div>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {STEP3_REWARDS.map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem' }}>• {r.label}</span>
                      <span style={{
                        fontSize: '0.72rem',
                        color: '#00e5ff',
                        fontWeight: 700,
                        marginLeft: 12,
                        textShadow: '0 0 6px rgba(0,229,255,0.4)',
                        whiteSpace: 'nowrap',
                      }}>{r.credit}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : dialogue}
          </div>
          {/* Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 2 }}>
            <button onClick={nextTutorialStep} style={nextBtnStyle}>SUIVANT</button>
            <button onClick={skipTutorial} style={skipBtnStyle}>PASSER</button>
          </div>
        </div>
      ) : (
        /* ===== BOTTOM PANEL — all other steps ===== */
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          pointerEvents: 'auto',
          zIndex: 300,
        }}>
          {/* Gradient fade above the panel */}
          <div style={{
            height: 40,
            background: 'linear-gradient(to bottom, transparent, rgba(0,4,12,0.6))',
          }} />

          {/* Panel */}
          <div style={{
            background: 'rgba(0, 4, 12, 0.88)',
            borderTop: '2px solid rgba(0,229,255,0.4)',
            padding: '20px 24px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            {/* Name tag */}
            <div style={{
              fontFamily: "'Orbitron', monospace",
              fontSize: '0.72rem',
              color: '#ffd700',
              letterSpacing: 3,
              textTransform: 'uppercase',
              textShadow: '0 0 8px rgba(255,215,0,0.4)',
            }}>
              RICK — LE GERANT
            </div>

            {/* Dialogue text */}
            <div style={{
              fontFamily: "'Orbitron', monospace",
              fontSize: '0.88rem',
              color: 'rgba(255,255,255,0.92)',
              lineHeight: 1.8,
              maxWidth: 700,
            }}>
              {tutorialStep === 3 ? (
                <>
                  <div>{STEP3_INTRO}</div>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {STEP3_REWARDS.map((r, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 400 }}>
                        <span>• {r.label}</span>
                        <span style={{
                          color: '#00e5ff',
                          fontWeight: 700,
                          marginLeft: 16,
                          textShadow: '0 0 6px rgba(0,229,255,0.4)',
                          whiteSpace: 'nowrap',
                        }}>{r.credit}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : dialogue}
            </div>

            {/* Buttons row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
              <button onClick={isLast ? skipTutorial : nextTutorialStep} style={nextBtnStyle}>
                {isLast ? 'COMMENCER' : 'SUIVANT'}
              </button>
              {!isLast && (
                <button onClick={skipTutorial} style={skipBtnStyle}>PASSER</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
