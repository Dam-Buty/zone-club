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

const MOBILE_STEPS: OnboardingStep[] = [
  {
    title: 'SE D\u00c9PLACER',
    description: 'Utilisez le joystick en bas \u00e0 gauche pour vous d\u00e9placer dans le vid\u00e9oclub.',
    icon: '\u{1F579}\uFE0F',
    animation: 'joystickHint',
  },
  {
    title: 'REGARDER',
    description: 'Glissez votre doigt sur l\'\u00e9cran pour tourner la cam\u00e9ra et explorer le magasin.',
    icon: '\u{1F440}',
    animation: 'swipeHint',
  },
  {
    title: 'INTERAGIR',
    description: 'Visez une cassette et tapez l\'\u00e9cran ou appuyez sur le bouton E pour la prendre.',
    icon: '\u{1F4FC}',
    animation: 'tapHint',
  },
]

const DESKTOP_STEPS: OnboardingStep[] = [
  {
    title: 'SE D\u00c9PLACER',
    description: 'Utilisez les touches WASD ou les fl\u00e8ches pour vous d\u00e9placer dans le vid\u00e9oclub.',
    icon: '\u{2328}\uFE0F',
    animation: 'joystickHint',
  },
  {
    title: 'REGARDER',
    description: 'Bougez la souris pour tourner la cam\u00e9ra. Cliquez pour prendre le contr\u00f4le.',
    icon: '\u{1F5B1}\uFE0F',
    animation: 'swipeHint',
  },
  {
    title: 'INTERAGIR',
    description: 'Visez une cassette avec le viseur et cliquez ou appuyez sur E pour l\'examiner.',
    icon: '\u{1F4FC}',
    animation: 'tapHint',
  },
]

export function MobileOnboarding({ isMobile }: MobileOnboardingProps) {
  const setHasSeenOnboarding = useStore(state => state.setHasSeenOnboarding)
  const [currentStep, setCurrentStep] = useState(0)

  const steps = isMobile ? MOBILE_STEPS : DESKTOP_STEPS
  const step = steps[currentStep]
  const isLast = currentStep === steps.length - 1

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

      {/* Animated icon */}
      <div style={{
        fontSize: '4rem',
        marginBottom: '24px',
        animation: `${step.animation} 2s ease-in-out infinite`,
      }}>
        {step.icon}
      </div>

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
