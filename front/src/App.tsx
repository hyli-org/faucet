import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { blob_click } from './types/faucet';
import { nodeService } from './services/NodeService';
import { BlobTransaction, blob_builder } from 'hyle';
import { useConfig } from './hooks/useConfig';

interface FloatingNumber {
  id: number;
  value: number;
  x: number;
  y: number;
  opacity: number;
}

interface Achievement {
  id: string;
  title: string;
  description: string;
  threshold: number;
  unlocked: boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'noob', title: '🎮 Noob Clicker', description: 'Click 10 times', threshold: 10, unlocked: false },
  { id: 'degen', title: '🚀 True Degen', description: 'Click 100 times', threshold: 100, unlocked: false },
  { id: 'chad', title: '💪 Gigachad', description: 'Click 500 times', threshold: 500, unlocked: false },
  { id: 'whale', title: '🐋 Whale Alert', description: 'Click 1000 times', threshold: 1000, unlocked: false },
  { id: 'sigma', title: '🔥 Sigma Grindset', description: 'Click 5000 times', threshold: 5000, unlocked: false },
];

const POWERUP_COST = 1;
const AUTO_CLICK_INTERVAL = 100; // 100ms between auto-clicks

function App() {
  const { isLoading: isLoadingConfig, error: configError } = useConfig();
  const [count, setCount] = useState(() => Number(localStorage.getItem('count')) || 0);
  const [multiplier, setMultiplier] = useState(() => Number(localStorage.getItem('multiplier')) || 1);
  const [autoClickers, setAutoClickers] = useState(() => Number(localStorage.getItem('autoClickers')) || 0);
  const [floatingNumbers, setFloatingNumbers] = useState<FloatingNumber[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>(() => {
    const saved = localStorage.getItem('achievements');
    return saved ? JSON.parse(saved) : ACHIEVEMENTS;
  });
  const [lastAchievement, setLastAchievement] = useState<Achievement | null>(null);
  const [walletAddress, setWalletAddress] = useState(() => localStorage.getItem('walletAddress') || '');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const nextFloatingNumberId = useRef(0);

  const addFloatingNumber = useCallback((value: number, x: number, y: number) => {
    if (floatingNumbers.length >= 10) {
      return;
    }
    const id = nextFloatingNumberId.current++;
    setFloatingNumbers(numbers => [
      ...numbers,
      { id, value, x, y, opacity: 1 }
    ]);
  }, []);

  const processClick = useCallback(async (x: number, y: number) => {
    const increment = multiplier;
    setCount(c => c + increment);
    addFloatingNumber(increment, x, y);

    // Send blob tx 
    const blobTransfer = blob_builder.token.transfer(walletAddress, "hyllar", 1, 1);
    const blobClick = blob_click(0);

    const identity = `${walletAddress}@${blobClick.contract_name}`;
    const blobTx: BlobTransaction = {
      identity,
      blobs: [blobTransfer, blobClick],
    }
    nodeService.client.sendBlobTx(blobTx);

    // Add particle effect with a maximum of 20 particles
    if (buttonRef.current) {
      const existingParticles = buttonRef.current.getElementsByClassName('particles');
      if (existingParticles.length >= 10) {
        return;
      }

      const particles = document.createElement('div');
      particles.className = 'particles';
      particles.style.left = `${x}px`;
      particles.style.top = `${y}px`;
      buttonRef.current.appendChild(particles);
      setTimeout(() => particles.remove(), 1000);
    }
  }, [multiplier, addFloatingNumber, walletAddress]);

  const handleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const buttonRect = buttonRef.current?.getBoundingClientRect();
    if (buttonRect) {
      const x = event.clientX - buttonRect.left;
      const y = event.clientY - buttonRect.top;
      processClick(x, y);
    }
  }, [processClick]);

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem('count', count.toString());
    localStorage.setItem('multiplier', multiplier.toString());
    localStorage.setItem('autoClickers', autoClickers.toString());
    localStorage.setItem('achievements', JSON.stringify(achievements));
    localStorage.setItem('walletAddress', walletAddress);
  }, [count, multiplier, autoClickers, achievements]);

  // Auto clicker effect
  useEffect(() => {
    if (autoClickers > 0) {
      const interval = setInterval(() => {
        if (buttonRef.current) {
          const buttonRect = buttonRef.current.getBoundingClientRect();
          const x = Math.random() * buttonRect.width;
          const y = Math.random() * buttonRect.height;
          processClick(x, y);
        }
      }, AUTO_CLICK_INTERVAL / autoClickers);
      return () => clearInterval(interval);
    }
  }, [autoClickers, processClick]);

  // Achievement check effect
  useEffect(() => {
    achievements.forEach(achievement => {
      if (!achievement.unlocked && count >= achievement.threshold) {
        const updatedAchievements = achievements.map(a =>
          a.id === achievement.id ? { ...a, unlocked: true } : a
        );
        setAchievements(updatedAchievements);
        setLastAchievement(achievement);

        // Clear achievement notification after 3 seconds
        setTimeout(() => {
          setLastAchievement(null);
        }, 3000);
      }
    });
  }, [count, achievements]);

  // Floating numbers animation
  useEffect(() => {
    const animationFrame = requestAnimationFrame(function animate() {
      setFloatingNumbers(numbers =>
        numbers
          .map(num => ({
            ...num,
            y: num.y - 2,
            opacity: num.opacity - 0.02
          }))
          .filter(num => num.opacity > 0)
      );
      requestAnimationFrame(animate);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, []);


  const buyMultiplier = () => {
    if (count >= POWERUP_COST) {
      setCount(c => c - POWERUP_COST);
      setMultiplier(m => m * 2);
    }

  };

  const buyAutoClicker = () => {
    if (count >= POWERUP_COST) {
      setCount(c => c - POWERUP_COST);
      setAutoClickers(ac => ac + 1);
    }
  };
  const resetGame = useCallback(() => {
    setCount(0);
    setMultiplier(1);
    setAutoClickers(0);
    setAchievements(ACHIEVEMENTS);
    localStorage.clear();
    localStorage.setItem('walletAddress', walletAddress);
  }, []);

  if (isLoadingConfig) {
    return <div>Loading configuration...</div>;
  }

  return (
    <div className="App">
      <div className="wallet-input">
        <input
          type="text"
          value={walletAddress}
          onChange={(e) => {
            localStorage.setItem('walletAddress', e.target.value);
            setWalletAddress(e.target.value);
          }}
          placeholder="Entrez votre adresse de portefeuille"
          className="wallet-address"
        />
      </div>
      <div className="score">🚀 {count.toLocaleString()} POINTS</div>

      <div className="powerups">
        <button
          onClick={buyMultiplier}
          disabled={count < POWERUP_COST}
          className="powerup-button"
        >
          Buy 2x Multiplier ({POWERUP_COST} points)
          <div className="current">Current: {multiplier}x</div>
        </button>

        <button
          onClick={buyAutoClicker}
          disabled={count < POWERUP_COST}
          className="powerup-button"
        >
          Buy Auto Clicker ({POWERUP_COST} points)
          <div className="current">Current: {autoClickers}</div>
        </button>
      </div>

      <button
        ref={buttonRef}
        className="clicker-button"
        onClick={handleClick}
      >
        <span className="button-text">CLICK ME</span>
        {floatingNumbers.map(num => (
          <div
            key={num.id}
            className="floating-number"
            style={{
              left: `${num.x}px`,
              top: `${num.y}px`,
              opacity: num.opacity,
            }}
          >
            +{num.value}
          </div>
        ))}
      </button>

      {lastAchievement && (
        <div className="achievement-popup">
          <h3>🏆 Achievement Unlocked!</h3>
          <div className="achievement-title">{lastAchievement.title}</div>
          <div className="achievement-description">{lastAchievement.description}</div>
        </div>
      )}

      <button
        onClick={resetGame}
        className="reset-button"
      >
        🔄 Réinitialiser le jeu
      </button>

      <div className="achievements">
        <h3>🏆 Achievements</h3>
        <div className="achievement-list">
          {achievements.map(achievement => (
            <div
              key={achievement.id}
              className={`achievement ${achievement.unlocked ? 'unlocked' : 'locked'}`}
            >
              <div className="achievement-title">{achievement.title}</div>
              <div className="achievement-description">{achievement.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div >
  );
}

export default App;
