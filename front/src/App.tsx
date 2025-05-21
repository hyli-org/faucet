import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { blob_click } from './types/faucet';
import { nodeService } from './services/NodeService';
import { BlobTransaction } from 'hyli';
import { useConfig } from './hooks/useConfig';
import { transfer } from './types/smt_token';

interface Orange {
  id: number;
  x: number;
  y: number;
  rotation: number;
  speed: number;
  sliced: boolean;
}

interface Achievement {
  id: string;
  title: string;
  description: string;
  threshold: number;
  unlocked: boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'noob', title: '🎮 Noob Clicker', description: 'Slice 10 oranges', threshold: 10, unlocked: false },
  { id: 'degen', title: '🚀 True Degen', description: 'Slice 100 oranges', threshold: 100, unlocked: false },
  { id: 'chad', title: '💪 Gigachad', description: 'Slice 500 oranges', threshold: 500, unlocked: false },
  { id: 'whale', title: '🐋 Whale Alert', description: 'Slice 1000 oranges', threshold: 1000, unlocked: false },
  { id: 'sigma', title: '🔥 Sigma Grindset', description: 'Slice 5000 oranges', threshold: 5000, unlocked: false },
];

const SPAWN_INTERVAL = 500;
const GRAVITY = 0.03;
const INITIAL_SPEED = 1;

function App() {
  const { isLoading: isLoadingConfig, error: _configError } = useConfig();
  const [debugMode, setDebugMode] = useState(false);
  const [count, setCount] = useState(() => Number(localStorage.getItem('count')) || 0);
  const [oranges, setOranges] = useState<Orange[]>([]);
  const processingOranges = useRef<Set<number>>(new Set());
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
  const gameAreaRef = useRef<HTMLDivElement>(null);
  const nextOrangeId = useRef(0);
  const lastMousePosition = useRef({ x: 0, y: 0 });
  const isMouseDown = useRef(false);
  const slicePoints = useRef<{ x: number; y: number }[]>([]);
  const sliceStartTime = useRef<number>(0);

  const sliceOrange = useCallback(async (orangeId: number) => {
    const orange = oranges.find(o => o.id === orangeId);
    if (!orange || orange.sliced || processingOranges.current.has(orangeId)) return;
    console.log('sliceOrange', orangeId);

    processingOranges.current.add(orangeId);

    // Send blob tx 
    const blobTransfer = transfer("faucet", walletAddress, "oranj", BigInt(1), 1);
    const blobClick = blob_click(0);

    const identity = `${walletAddress}@${blobClick.contract_name}`;
    const blobTx: BlobTransaction = {
      identity,
      blobs: [blobTransfer, blobClick],
    }
    await nodeService.sendBlobTx(blobTx);

    setCount(c => c + 1);
    setOranges(prev => prev.map(o => 
      o.id === orangeId ? { ...o, sliced: true } : o
    ));
    
    processingOranges.current.delete(orangeId);
  }, [oranges, walletAddress]);

  const createSliceEffect = useCallback((points: { x: number; y: number }[]) => {
    if (!gameAreaRef.current || points.length < 2) return;
    
    const slice = document.createElement('div');
    slice.className = 'slice-effect';
    
    // Créer un SVG pour la ligne
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    
    // Créer le chemin
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = points.reduce((acc, point, i) => {
      return acc + (i === 0 ? `M ${point.x} ${point.y}` : ` L ${point.x} ${point.y}`);
    }, '');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'white');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.style.filter = 'drop-shadow(0 0 2px rgba(255,255,255,0.8))';
    
    svg.appendChild(path);
    slice.appendChild(svg);
    gameAreaRef.current.appendChild(slice);
    
    setTimeout(() => slice.remove(), 300);
  }, []);

  const checkSlice = useCallback((startX: number, startY: number, endX: number, endY: number) => {
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    
    // Create slice effect
    createSliceEffect([{ x: startX, y: startY }, { x: endX, y: endY }]);

    // Check for oranges in the slice path
    setOranges(prev => prev.map(orange => {
      if (orange.sliced || processingOranges.current.has(orange.id)) return orange;

      // Calculate distance from orange to line segment
      const lineLength = Math.sqrt(dx * dx + dy * dy);
      if (lineLength === 0) return orange;

      // Calculate projection of orange position onto the line
      const t = Math.max(0, Math.min(1, (
        (orange.x - startX) * dx + (orange.y - startY) * dy
      ) / (lineLength * lineLength)));

      // Calculate closest point on the line segment
      const closestX = startX + t * dx;
      const closestY = startY + t * dy;

      // Calculate actual distance from orange to closest point
      const distance = Math.sqrt(
        Math.pow(orange.x - closestX, 2) + Math.pow(orange.y - closestY, 2)
      );

      // If orange is close enough to the slice line (reduced threshold)
      if (distance < 25) {
        sliceOrange(orange.id);
        return orange;
      }
      return orange;
    }));
  }, [createSliceEffect, sliceOrange]);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!gameAreaRef.current) return;
    const rect = gameAreaRef.current.getBoundingClientRect();
    isMouseDown.current = true;
    sliceStartTime.current = Date.now();
    const position = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    lastMousePosition.current = position;
    slicePoints.current = [position];
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !gameAreaRef.current) return;
    
    // Check if slice duration exceeds 200ms
    if (Date.now() - sliceStartTime.current > 200) {
      isMouseDown.current = false;
      createSliceEffect(slicePoints.current);
      slicePoints.current = [];
      return;
    }
    
    const rect = gameAreaRef.current.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    // Ajouter le point au chemin
    slicePoints.current.push({ x: currentX, y: currentY });

    // Vérifier les oranges sur le chemin
    const dx = currentX - lastMousePosition.current.x;
    const dy = currentY - lastMousePosition.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 10) {
      checkSlice(
        lastMousePosition.current.x,
        lastMousePosition.current.y,
        currentX,
        currentY
      );
      lastMousePosition.current = { x: currentX, y: currentY };
    }
  }, [checkSlice, createSliceEffect]);

  const handleMouseUp = useCallback(() => {
    if (isMouseDown.current) {
      createSliceEffect(slicePoints.current);
      slicePoints.current = [];
    }
    isMouseDown.current = false;
  }, [createSliceEffect]);

  const spawnOrange = useCallback(() => {
    console.log('spawnOrange', walletAddress);
    if (!gameAreaRef.current) return;
    
    // Don't spawn if no wallet address is set
    if (!walletAddress) return;
    
    // In debug mode, only spawn if there are no oranges
    if (debugMode && oranges.length > 0) return;
    
    const gameArea = gameAreaRef.current;
    const x = Math.random() * (gameArea.clientWidth - 50);
    const orange: Orange = {
      id: nextOrangeId.current++,
      x,
      y: -50,
      rotation: Math.random() * 360,
      speed: INITIAL_SPEED,
      sliced: false
    };
    
    setOranges(prev => [...prev, orange]);
  }, [debugMode, oranges.length, walletAddress]);

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem('count', count.toString());
    localStorage.setItem('achievements', JSON.stringify(achievements));
    localStorage.setItem('walletAddress', walletAddress);
  }, [count, achievements]);

  // Spawn oranges
  useEffect(() => {
    // This effect is now handled in the animation frame
  }, [spawnOrange]);

  // Update orange positions
  useEffect(() => {
    let lastSpawnTime = performance.now();
    const animationFrame = requestAnimationFrame(function animate() {
      const currentTime = performance.now();
      const timeSinceLastSpawn = currentTime - lastSpawnTime;

      if (timeSinceLastSpawn >= SPAWN_INTERVAL && !document.hidden) {
        spawnOrange();
        lastSpawnTime = currentTime;
      }

      setOranges(prev => 
        prev
          .map(orange => ({
            ...orange,
            y: orange.y + orange.speed,
            speed: orange.speed + GRAVITY,
            rotation: orange.rotation + 2
          }))
          .filter(orange => orange.y < window.innerHeight + 100)
      );
      requestAnimationFrame(animate);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, []);

  // Achievement check effect
  useEffect(() => {
    [...achievements].reverse().forEach(achievement => {
      if (!achievement.unlocked && count >= achievement.threshold) {
        const updatedAchievements = achievements.map(a =>
          a.id === achievement.id ? { ...a, unlocked: true } : a
        );
        setAchievements(updatedAchievements);
        setLastAchievement(achievement);

        setTimeout(() => {
          setLastAchievement(null);
        }, 3000);
      }
    });
  }, [count, achievements]);

  useEffect(() => {
    nodeService.getBalance(walletAddress).then((balance) => {
      setCount(balance);
    }).catch((_) => {
      setCount(0);
    });
  }, [walletAddress]);

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

            const url = new URL(window.location.href);
            if (newAddress) {
              url.searchParams.set('wallet', newAddress);
            } else {
              url.searchParams.delete('wallet');
            }
            window.history.replaceState({}, '', url);
          }}
          placeholder="Enter wallet address"
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

      <div 
        ref={gameAreaRef}
        className="game-area"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {!walletAddress && (
          <div 
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              padding: '20px',
              borderRadius: '10px',
              textAlign: 'center',
              zIndex: 1000,
              color: '#ff6b6b',
              maxWidth: '80%',
              boxShadow: '0 0 20px rgba(0, 0, 0, 0.5)'
            }}
          >
            <h2 style={{ margin: '0 0 10px 0' }}>🎮 Ready to Play?</h2>
            <p style={{ margin: '0', fontSize: '1.1em' }}>
              Please enter your wallet address above to start slicing oranges and earning ORANJ tokens!
            </p>
          </div>
        )}
        {oranges.map(orange => (
          <div
            key={orange.id}
            className={`orange ${orange.sliced ? 'sliced' : ''}`}
            style={{
              left: `${orange.x}px`,
              top: `${orange.y}px`,
              transform: `translate(-50%, -50%) rotate(${orange.rotation}deg)`,
              backgroundImage: 'url(/orange.svg)',
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
              width: '50px',
              height: '50px',
              position: 'absolute',
              pointerEvents: 'none'
            }}
          />
        ))}
      </div>

      {lastAchievement && (
        <div className="achievement-popup">
          <h3>🏆 Achievement Unlocked!</h3>
          <div className="achievement-title">{lastAchievement.title}</div>
          <div className="achievement-description">{lastAchievement.description}</div>
        </div>
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
    </div>
  );
}

export default App;
