import { useState, useCallback } from 'react'
import { useStore } from '../../store'

interface MobileOnboardingProps {
  isMobile: boolean
}

interface OnboardingStep {
  title: string
  description: string
  icon: string
  animation: string
}

const MOBILE_COMMANDS_TITLE = 'COMMANDES MOBILE'
const WEBGPU_WARNING_TITLE = 'AVERTISSEMENT WEBGPU'

const MOBILE_STEPS: OnboardingStep[] = [
  {
    title: WEBGPU_WARNING_TITLE,
    description: 'Ce vid\u00e9oclub est optimis\u00e9 pour les appareils compatibles WebGPU. Sur mobile, un mod\u00e8le r\u00e9cent est recommand\u00e9 pour garder une exp\u00e9rience fluide.',
    icon: '\u{26A0}\uFE0F',
    animation: 'swipeHint',
  },
  {
    title: 'COMMANDES MOBILE',
    description: 'D\u00e9placez-vous avec le joystick (bas gauche), regardez en glissant sur l\'\u00e9cran, puis touchez directement une cassette pour l\'inspecter.',
    icon: '\u{1F4F1}',
    animation: 'tapHint',
  },
]

const DESKTOP_STEPS: OnboardingStep[] = [
  {
    title: WEBGPU_WARNING_TITLE,
    description: 'Ce vid\u00e9oclub est optimis\u00e9 pour les appareils compatibles WebGPU. Pour de meilleures performances, utilisez un navigateur \u00e0 jour avec acc\u00e9l\u00e9ration mat\u00e9rielle activ\u00e9e.',
    icon: '\u{26A0}\uFE0F',
    animation: 'swipeHint',
  },
  {
    title: 'COMMANDES DESKTOP',
    description: 'Cliquez pour prendre le contr\u00f4le. D\u00e9placez-vous avec les fl\u00e8ches \u2191 \u2193 \u2190 \u2192, regardez avec la souris, interagissez avec clic ou E, et utilisez ESC pour lib\u00e9rer la souris.',
    icon: '\u{2328}\uFE0F',
    animation: 'tapHint',
  },
]

export function MobileOnboarding({ isMobile }: MobileOnboardingProps) {
  const setHasSeenOnboarding = useStore(state => state.setHasSeenOnboarding)
  const [currentStep, setCurrentStep] = useState(0)

  const steps = isMobile ? MOBILE_STEPS : DESKTOP_STEPS
  const step = steps[currentStep]
  const isLast = currentStep === steps.length - 1
  const isMobileCommandsStep = isMobile && step.title === MOBILE_COMMANDS_TITLE
  const isWebgpuWarningStep = step.title === WEBGPU_WARNING_TITLE

  const handleNext = useCallback(() => {
    if (isLast) {
      setHasSeenOnboarding(true)
    } else {
      setCurrentStep(s => s + 1)
    }
  }, [isLast, setHasSeenOnboarding])

  const handleSkip = useCallback(() => {
    setHasSeenOnboarding(true)
  }, [setHasSeenOnboarding])

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(5, 5, 8, 0.92)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 300,
      padding: '24px',
      touchAction: 'none',
    }}>
      <style>{`
        @keyframes joystickKnobCycle {
          0%, 10% { transform: translate(-50%, -50%) translate(0, -14px); }
          25%, 35% { transform: translate(-50%, -50%) translate(0, 14px); }
          50%, 60% { transform: translate(-50%, -50%) translate(-14px, 0); }
          75%, 85% { transform: translate(-50%, -50%) translate(14px, 0); }
          100% { transform: translate(-50%, -50%) translate(0, -14px); }
        }
      `}</style>

      {/* Step indicator dots */}
      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '40px',
      }}>
        {steps.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === currentStep ? '24px' : '8px',
              height: '8px',
              borderRadius: '4px',
              background: i === currentStep ? '#ff2d95' : 'rgba(255, 255, 255, 0.2)',
              boxShadow: i === currentStep ? '0 0 10px #ff2d95' : 'none',
              transition: 'all 0.3s',
            }}
          />
        ))}
      </div>

      {/* Animated icon / logos / joystick demo */}
      {isWebgpuWarningStep ? (
        <div style={{
          width: '100%',
          maxWidth: isMobile ? '340px' : '420px',
          marginBottom: '24px',
          padding: isMobile ? '14px 12px' : '16px',
          borderRadius: '12px',
          border: 'none',
          background: 'transparent',
          boxShadow: 'none',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: '12px',
          }}>
            <img
              src="/webgpulogo.png"
              alt="WebGPU"
              style={{
                height: isMobile ? '36px' : '48px',
                objectFit: 'contain',
              }}
            />
          </div>

          <div style={{
            height: '1px',
            margin: isMobile ? '0 8px 10px' : '0 16px 12px',
            background: 'linear-gradient(90deg, rgba(0,255,247,0), rgba(0,255,247,0.65), rgba(0,255,247,0))',
          }} />

          <div style={{
            textAlign: 'center',
            fontFamily: 'Inter, sans-serif',
            fontSize: isMobile ? '0.68rem' : '0.72rem',
            color: 'rgba(0,255,247,0.78)',
            letterSpacing: '0.9px',
            marginBottom: '8px',
            textTransform: 'uppercase',
          }}>
            Backends GPU natifs
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: isMobile ? '8px' : '10px',
            alignItems: 'stretch',
          }}>
            <div style={{
              width: isMobile ? '88px' : '102px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              padding: isMobile ? '8px 6px' : '9px 7px',
              textAlign: 'center',
            }}>
              <div style={{
                height: isMobile ? '22px' : '25px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <img
                  src="/Metalogo.png"
                  alt="Metal backend"
                  style={{
                    width: isMobile ? '34px' : '38px',
                    objectFit: 'contain',
                  }}
                />
              </div>
            </div>

            <div style={{
              width: isMobile ? '88px' : '102px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              padding: isMobile ? '8px 6px' : '9px 7px',
              textAlign: 'center',
            }}>
              <div style={{
                height: isMobile ? '22px' : '25px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <img
                  src="/Vulkanlogo.jpeg"
                  alt="Vulkan backend"
                  style={{
                    width: isMobile ? '42px' : '50px',
                    objectFit: 'contain',
                  }}
                />
              </div>
            </div>

            <div style={{
              width: isMobile ? '88px' : '102px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              padding: isMobile ? '8px 6px' : '9px 7px',
              textAlign: 'center',
            }}>
              <div style={{
                height: isMobile ? '22px' : '25px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <img
                  src="/DirectX_12_logo.png"
                  alt="Direct3D 12 backend"
                  style={{
                    width: isMobile ? '50px' : '60px',
                    objectFit: 'contain',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : isMobileCommandsStep ? (
        <div style={{
          position: 'relative',
          width: '108px',
          height: '108px',
          marginBottom: '24px',
        }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid rgba(0, 255, 247, 0.5)',
            background: 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.12), rgba(0,0,0,0.12))',
            boxShadow: '0 0 20px rgba(0, 255, 247, 0.2)',
          }} />
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '34px',
            height: '34px',
            borderRadius: '50%',
            border: '2px solid rgba(255, 45, 149, 0.85)',
            background: 'rgba(255, 45, 149, 0.28)',
            boxShadow: '0 0 15px rgba(255, 45, 149, 0.45)',
            transform: 'translate(-50%, -50%)',
            animation: 'joystickKnobCycle 2.8s ease-in-out infinite',
          }} />
        </div>
      ) : (
        <div style={{
          fontSize: '4rem',
          marginBottom: '24px',
          animation: `${step.animation} 2s ease-in-out infinite`,
        }}>
          {step.icon}
        </div>
      )}

      {/* Title */}
      <div style={{
        fontFamily: 'Orbitron, sans-serif',
        fontSize: isMobile ? '1.3rem' : '1.8rem',
        color: '#00fff7',
        textShadow: '0 0 20px rgba(0, 255, 247, 0.5)',
        letterSpacing: '4px',
        marginBottom: '16px',
        textAlign: 'center',
      }}>
        {step.title}
      </div>

      {/* Description */}
      <div style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: isMobile ? '0.95rem' : '1.1rem',
        color: 'rgba(255, 255, 255, 0.75)',
        textAlign: 'center',
        maxWidth: '380px',
        lineHeight: 1.6,
        marginBottom: '48px',
      }}>
        {step.description}
      </div>

      {/* Buttons */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        width: '100%',
        maxWidth: '280px',
      }}>
        <button
          onClick={handleNext}
          style={{
            padding: '16px 32px',
            borderRadius: '8px',
            border: '2px solid #ff2d95',
            background: 'rgba(255, 45, 149, 0.2)',
            color: '#ffffff',
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '1rem',
            letterSpacing: '3px',
            cursor: 'pointer',
            boxShadow: '0 0 20px rgba(255, 45, 149, 0.3)',
            transition: 'all 0.2s',
          }}
        >
          {isLast ? 'C\'EST PARTI !' : 'SUIVANT'}
        </button>

        {!isLast && (
          <button
            onClick={handleSkip}
            style={{
              padding: '10px',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.35)',
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Passer le tutoriel
          </button>
        )}
      </div>
    </div>
  )
}
