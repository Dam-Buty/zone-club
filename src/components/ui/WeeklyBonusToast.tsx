import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';

export default function WeeklyBonusToast() {
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const weeklyBonusStatus = useStore((s) => s.weeklyBonusStatus);
  const claimWeeklyBonus = useStore((s) => s.claimWeeklyBonus);
  const [visible, setVisible] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimedAmount, setClaimedAmount] = useState<number | null>(null);

  const canClaim = isAuthenticated && weeklyBonusStatus?.canClaim;
  const amount = weeklyBonusStatus?.amount ?? 0;

  useEffect(() => {
    if (canClaim && amount > 0) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [canClaim, amount]);

  const handleClaim = useCallback(async () => {
    if (claiming) return;
    setClaiming(true);
    const ok = await claimWeeklyBonus();
    if (ok) {
      setClaimedAmount(amount);
      setTimeout(() => {
        setVisible(false);
        setClaimedAmount(null);
      }, 2000);
    }
    setClaiming(false);
  }, [claimWeeklyBonus, amount, claiming]);

  if (!visible || !canClaim || amount <= 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 180,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      pointerEvents: 'auto',
    }}>
      <div style={{
        background: 'rgba(0, 0, 0, 0.9)',
        border: '2px solid #00e5ff',
        borderRadius: 8,
        padding: '16px 28px',
        fontFamily: "'Orbitron', monospace",
        textAlign: 'center',
        boxShadow: '0 0 20px rgba(0, 229, 255, 0.3)',
      }}>
        <div style={{ color: '#00e5ff', fontSize: 12, marginBottom: 8, letterSpacing: 2 }}>
          BONUS HEBDOMADAIRE
        </div>
        {claimedAmount !== null ? (
          <div style={{
            color: '#4caf50',
            fontSize: 24,
            fontWeight: 'bold',
            animation: 'fadeUp 0.5s ease-out',
          }}>
            +{claimedAmount} CREDITS
          </div>
        ) : (
          <button
            onClick={handleClaim}
            disabled={claiming}
            style={{
              background: claiming ? '#666' : '#4caf50',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '10px 20px',
              fontFamily: "'Orbitron', monospace",
              fontSize: 14,
              cursor: claiming ? 'default' : 'pointer',
              letterSpacing: 1,
              transition: 'background 0.2s',
            }}
          >
            {claiming ? '...' : `RECEVOIR +${amount} CREDITS`}
          </button>
        )}
      </div>
    </div>
  );
}
