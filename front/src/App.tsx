import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { blob_click } from './types/faucet';
import { nodeService } from './services/NodeService';
import { BlobTransaction } from 'hyle';
import { useConfig } from './hooks/useConfig';
import { transfer } from './types/smt_token';

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

const AUTO_CLICK_INTERVAL = 1500; // 100ms between auto-clicks

function App() {
  const { isLoading: isLoadingConfig, error: _configError } = useConfig();
  const [count, setCount] = useState(() => Number(localStorage.getItem('count')) || 0);
  const [autoClickers, setAutoClickers] = useState(() => Number(localStorage.getItem('autoClickers')) || 0);
  const [floatingNumbers, setFloatingNumbers] = useState<FloatingNumber[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>(() => {
    const saved = localStorage.getItem('achievements');
    return saved ? JSON.parse(saved) : ACHIEVEMENTS;
  });
  const [lastAchievement, setLastAchievement] = useState<Achievement | null>(null);
  const [walletAddress, setWalletAddress] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const walletFromUrl = params.get('wallet');
    if (walletFromUrl) {
      localStorage.setItem('walletAddress', walletFromUrl);
      return walletFromUrl;
    }
    return localStorage.getItem('walletAddress') || '';
  });
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
    setCount(c => c + 1);
    addFloatingNumber(1, x, y);

    // Send blob tx 
    const blobTransfer = transfer("faucet", walletAddress, "oranj", BigInt(1), 1);
    const blobClick = blob_click(0);

    const identity = `${walletAddress}@${blobClick.contract_name}`;
    const blobTx: BlobTransaction = {
      identity,
      blobs: [blobTransfer, blobClick],
    }
    nodeService.sendBlobTx(blobTx);
    // Random wallet address 
    const randomWallet = Math.random().toString(36).substring(2, 15);
    setWalletAddress(randomWallet);

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
  }, [addFloatingNumber, walletAddress]);

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
    localStorage.setItem('autoClickers', autoClickers.toString());
    localStorage.setItem('achievements', JSON.stringify(achievements));
    localStorage.setItem('walletAddress', walletAddress);
  }, [count, autoClickers, achievements]);

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

  useEffect(() => {
    nodeService.getBalance(walletAddress).then((balance) => {
      setCount(balance);
    }).catch((_) => {
      setCount(0);
    });
  }, [walletAddress]);


  const buyAutoClicker = () => {
    setAutoClickers(ac => ac + 1);
  };

  const resetGame = useCallback(() => {
    setAutoClickers(0);
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
            const newAddress = e.target.value;
            localStorage.setItem('walletAddress', newAddress);
            setWalletAddress(newAddress);

            // Update URL without reloading the page
            const url = new URL(window.location.href);
            if (newAddress) {
              url.searchParams.set('wallet', newAddress);
            } else {
              url.searchParams.delete('wallet');
            }
            window.history.replaceState({}, '', url);
          }}
          placeholder="Entrez votre adresse de portefeuille"
          className="wallet-address"
          style={{
            hyphens: 'auto',
            overflowWrap: 'break-word',
            width: '100%',
            maxWidth: '600px',
            padding: '8px',
          }}
        />
      </div>
      <div className="score">🚀 {count.toLocaleString()} ORANJ</div>

      {window.cheatMode && (
        <div className="powerups">
          <button
            onClick={buyAutoClicker}
            className="powerup-button"
          >
            Buy Auto Clicker
            <div className="current">Current: {autoClickers}</div>
          </button>
        </div>
      )}

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

      {window.cheatMode && (
        <button
          onClick={resetGame}
          className="reset-button"
        >
          🔄 Stop auto clickers
        </button>
      )}

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
