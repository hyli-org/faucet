import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { blob_click } from "./types/faucet";
import { nodeService } from "./services/NodeService";
import { BlobTransaction } from "hyli";
import { useConfig } from "./hooks/useConfig";
import { Leaderboard } from "./components/Leaderboard";

import { TransactionList } from "./components/TransactionList";
import { HyliWallet, useWallet } from "hyli-wallet";
import slice1 from "./audio/slice1.mp3";
import slice2 from "./audio/slice2.mp3";
import slice3 from "./audio/slice3.mp3";
import bombSound from "./audio/bomb.mp3";
import { declareCustomElement } from "testnet-maintenance-widget";
declareCustomElement();

// Mutex implementation
class Mutex {
  private locked: boolean = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.locked = false;
    }
  }
}

// Add global mutexes
declare global {
  interface Window {
    orangeMutex: Mutex;
    bombMutex: Mutex;
    slicedOranges: Set<number>;
    slicedBombs: Set<number>;
  }
}

// Initialize global mutexes
if (!window.orangeMutex) {
  window.orangeMutex = new Mutex();
}
if (!window.bombMutex) {
  window.bombMutex = new Mutex();
}
if (!window.slicedOranges) {
  window.slicedOranges = new Set();
}
if (!window.slicedBombs) {
  window.slicedBombs = new Set();
}

interface Orange {
  id: number;
  x: number;
  y: number;
  rotation: number;
  speed: number;
  sliced: boolean;
}

interface Bomb {
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

interface JuiceParticle {
  id: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  time: number;
}

interface ExplosionParticle {
  id: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  size: number;
  color: string;
  time: number;
}

interface ButtonParticle {
  id: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  opacity: number;
  size: number;
  rotation: number;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: "noob", title: "🎮 Noob Clicker", description: "Slice 10 oranges", threshold: 10, unlocked: false },
  { id: "degen", title: "🚀 True Degen", description: "Slice 50 oranges", threshold: 50, unlocked: false },
  { id: "chad", title: "💪 Gigachad", description: "Slice 100 oranges", threshold: 100, unlocked: false },
  { id: "whale", title: "🐋 Whale Alert", description: "Slice 250 oranges", threshold: 250, unlocked: false },
  { id: "sigma", title: "🔥 Sigma Grindset", description: "Slice 500 oranges", threshold: 500, unlocked: false },
];

const SPAWN_INTERVAL = 500;
const GRAVITY = 0.01;
const INITIAL_SPEED = 1;

function App() {
  const { isLoading: isLoadingConfig, error: _configError } = useConfig();
  const [count, setCount] = useState(() => Number(localStorage.getItem("count")) || 0);
  const [oranges, setOranges] = useState<Orange[]>([]);
  const [bombs, setBombs] = useState<Bomb[]>([]);
  const [bombPenalty, setBombPenalty] = useState(() => Number(localStorage.getItem("bombPenalty")) || 0);
  const [isScoreShaking, setIsScoreShaking] = useState(false);
  const [isButtonPressed, setIsButtonPressed] = useState(false);
  const [showButtonModal, setShowButtonModal] = useState(false);
  const [clicksPerSecond, setClicksPerSecond] = useState(0);
  const clickTimestamps = useRef<number[]>([]);
  const smoothedClicksPerSecond = useRef(0);
  const [buttonParticles, setButtonParticles] = useState<ButtonParticle[]>([]);
  const nextButtonParticleId = useRef(0);
  const gameAreaRef = useRef<HTMLDivElement>(null);
  const nextOrangeId = useRef(0);
  const lastMousePosition = useRef({ x: 0, y: 0 });
  const isMouseDown = useRef(false);
  const slicePoints = useRef<{ x: number; y: number }[]>([]);
  const sliceStartTime = useRef<number>(0);
  const [juiceParticles, setJuiceParticles] = useState<JuiceParticle[]>([]);
  const nextJuiceId = useRef(0);
  const [explosionParticles, setExplosionParticles] = useState<ExplosionParticle[]>([]);
  const nextExplosionId = useRef(0);
  const [achievements, setAchievements] = useState<Achievement[]>(() => {
    const saved = localStorage.getItem("achievements");
    return saved ? JSON.parse(saved) : ACHIEVEMENTS;
  });
  const [lastAchievement, setLastAchievement] = useState<Achievement | null>(null);
  const { wallet, logout } = useWallet();
  const [transactions, setTransactions] = useState<Array<{ id: string; timestamp: number }>>([]);

  const [moreInfoModalOpacity, setMoreInfoModalOpacity] = useState(0);
  const MODAL_ID = "boundless";
  const [hideModal, setHideModal] = useState(localStorage.getItem("hideMoreInfoModal") === MODAL_ID);
  useEffect(() => {
    // After a couple second, turn on the modal
    const timer = setTimeout(() => {
      setMoreInfoModalOpacity(1);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    // Save hide modal state to localStorage
    if (!hideModal) {
      localStorage.removeItem("hideMoreInfoModal");
    } else {
      localStorage.setItem("hideMoreInfoModal", MODAL_ID);
    }
  }, [hideModal]);

  const createJuiceEffect = useCallback((x: number, y: number) => {
    const particles: JuiceParticle[] = [];
    const particleCount = 12; // Nombre de particules de jus
    const initialSpeed = 3; // Vitesse initiale

    for (let i = 0; i < particleCount; i++) {
      const angle = (i * 360) / particleCount + Math.random() * 30 - 15; // Angle avec un peu de variation
      const speed = initialSpeed + Math.random() * 5; // Plus de variation dans la vitesse
      const radian = (angle * Math.PI) / 180;

      // Calcul des composantes de la vitesse initiale
      const velocityX = Math.cos(radian) * speed;
      const velocityY = Math.sin(radian) * speed;

      particles.push({
        id: nextJuiceId.current++,
        x,
        y,
        velocityX,
        velocityY,
        time: 0,
      });
    }

    setJuiceParticles((prev) => [...prev, ...particles]);

    // Nettoyer les particules après l'animation
    setTimeout(() => {
      setJuiceParticles((prev) => prev.filter((p) => !particles.some((newP) => newP.id === p.id)));
    }, 1500);
  }, []);

  const createExplosionEffect = useCallback((x: number, y: number) => {
    const particles: ExplosionParticle[] = [];
    const particleCount = 20;
    const colors = ["#ff4444", "#ff8800", "#ffcc00", "#ff0000"];

    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      const size = 3 + Math.random() * 5;
      const color = colors[Math.floor(Math.random() * colors.length)];

      particles.push({
        id: nextExplosionId.current++,
        x,
        y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        size,
        color,
        time: 0,
      });
    }

    setExplosionParticles((prev) => [...prev, ...particles]);

    setTimeout(() => {
      setExplosionParticles((prev) => prev.filter((p) => !particles.some((newP) => newP.id === p.id)));
    }, 1000);
  }, []);

  const sliceBomb = async (bombId: number) => {
    if (!wallet || !wallet.address) return;
    try {
      await window.bombMutex.acquire();
      const bomb = bombs.find((b) => b.id === bombId);
      if (!bomb || bomb.sliced || window.slicedBombs.has(bombId)) return;

      // Vibrate for 200ms when slicing a bomb (longer vibration for bombs)
      if ("vibrate" in navigator) {
        navigator.vibrate([1000]);
      }

      // Play bomb sound
      const bombAudio = new Audio(bombSound);
      bombAudio.play();

      // Create explosion effect instead of juice effect
      createExplosionEffect(bomb.x, bomb.y);

      // Apply cumulative penalty
      const newPenalty = bombPenalty + 10;
      setBombPenalty(newPenalty);
      localStorage.setItem("bombPenalty", newPenalty.toString());

      // Trigger score shake animation
      setIsScoreShaking(true);
      setTimeout(() => setIsScoreShaking(false), 500);

      setBombs((prev) => prev.map((b) => (b.id === bombId ? { ...b, sliced: true } : b)));

      window.slicedBombs.add(bombId);
    } finally {
      window.bombMutex.release();
    }
  };

  const sliceOrange = async (orangeId: number) => {
    if (!wallet || !wallet.address) return;
    try {
      await window.orangeMutex.acquire();
      const orange = oranges.find((o) => o.id === orangeId);
      if (!orange || orange.sliced || window.slicedOranges.has(orangeId)) return;

      // Vibrate for 50ms when slicing an orange
      if ("vibrate" in navigator) {
        navigator.vibrate(150);
      }

      // Play random slice sound
      const sliceSound = [slice1, slice2, slice3];
      const audio = new Audio(sliceSound[Math.floor(Math.random() * sliceSound.length)]);
      // Reset audio if already playing
      audio.currentTime = 0;
      audio.play();

      // Créer l'effet de jus
      createJuiceEffect(orange.x, orange.y);

      // Only send blob tx if no bomb penalty is active
      if (bombPenalty === 0) {
        // Send blob tx
        // const blobTransfer = transfer("faucet", wallet.address, "oranj", BigInt(1), 1);
        const blobClick = blob_click(0);

        const identity = `${wallet.address}@${blobClick.contract_name}`;
        const blobTx: BlobTransaction = {
          identity,
          blobs: [blobClick],
        };
        nodeService.sendBlobTx(blobTx).then((txHash) => {
          // Add transaction to the list
          setTransactions((prev) =>
            [
              {
                id: txHash,
                timestamp: Date.now(),
              },
              ...prev,
            ].slice(0, 10),
          ); // Keep only the last 10 transactions
        });

        setCount((c) => c + 1);
      } else {
        // Reduce bomb penalty
        const newPenalty = bombPenalty - 1;
        setBombPenalty(newPenalty);
        localStorage.setItem("bombPenalty", newPenalty.toString());
      }

      setOranges((prev) => prev.map((o) => (o.id === orangeId ? { ...o, sliced: true } : o)));

      window.slicedOranges.add(orangeId);
    } finally {
      window.orangeMutex.release();
    }
  };

  const createButtonParticles = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const particleCount = 5 + Math.floor(Math.random() * 3); // 5-7 particles
    const newParticles: ButtonParticle[] = [];
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
      const speed = 3 + Math.random() * 4;
      
      newParticles.push({
        id: nextButtonParticleId.current++,
        x: centerX + (Math.random() - 0.5) * 50,
        y: centerY + (Math.random() - 0.5) * 50,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2, // Slight upward bias
        opacity: 1,
        size: 20 + Math.random() * 15,
        rotation: Math.random() * 360,
      });
    }
    
    setButtonParticles(prev => [...prev, ...newParticles]);
  };

  const handleBigRedButton = async (e?: React.MouseEvent<HTMLDivElement>) => {
    if (!wallet || !wallet.address) return;
    
    // Create particles if event is provided
    if (e) {
      createButtonParticles(e);
    }
    
    // Track click timestamp
    const now = Date.now();
    clickTimestamps.current.push(now);
    
    // Remove clicks older than 1 second
    clickTimestamps.current = clickTimestamps.current.filter(timestamp => now - timestamp < 1000);
    
    // Set button pressed state
    setIsButtonPressed(true);
    
    // Play sound effect
    const sliceSound = [slice1, slice2, slice3];
    const audio = new Audio(sliceSound[Math.floor(Math.random() * sliceSound.length)]);
    audio.currentTime = 0;
    audio.play();
    
    // Vibrate if available
    if ("vibrate" in navigator) {
      navigator.vibrate(150);
    }
    
    // Calculate boost multiplier based on click speed
    const currentSpeed = smoothedClicksPerSecond.current;
    let multiplier = 1;
    if (currentSpeed >= 9) {
      multiplier = 3;
    } else if (currentSpeed >= 5) {
      multiplier = 2;
    }
    
    // Only send blob tx if no bomb penalty is active
    if (bombPenalty === 0) {
      // Send multiple transactions based on multiplier
      const sendTransactions = async () => {
        for (let i = 0; i < multiplier; i++) {
          const blobClick = blob_click(0);
          const identity = `${wallet.address}@${blobClick.contract_name}`;
          const blobTx: BlobTransaction = {
            identity,
            blobs: [blobClick],
          };
          
          nodeService.sendBlobTx(blobTx).then((txHash) => {
            setTransactions((prev) =>
              [
                {
                  id: txHash,
                  timestamp: Date.now(),
                },
                ...prev,
              ].slice(0, 10)
            );
          });
          
          // Wait 1ms between transactions if there are more to send
          if (i < multiplier - 1) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
      };
      
      sendTransactions();
      setCount((c) => c + multiplier);
    } else {
      // Reduce bomb penalty by multiplier
      const newPenalty = Math.max(0, bombPenalty - multiplier);
      setBombPenalty(newPenalty);
    }
    
    // Reset button after a short delay
    setTimeout(() => {
      setIsButtonPressed(false);
    }, 100);
  };

  const createSliceEffect = useCallback((points: { x: number; y: number }[]) => {
    if (!gameAreaRef.current || points.length < 2) return;

    const slice = document.createElement("div");
    slice.className = "slice-effect";

    // Créer un SVG pour la ligne
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";

    // Créer le chemin
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = points.reduce((acc, point, i) => {
      return acc + (i === 0 ? `M ${point.x} ${point.y}` : ` L ${point.x} ${point.y}`);
    }, "");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "white");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("fill", "none");
    path.style.filter = "drop-shadow(0 0 2px rgba(255,255,255,0.8))";

    svg.appendChild(path);
    slice.appendChild(svg);
    gameAreaRef.current.appendChild(slice);

    setTimeout(() => slice.remove(), 300);
  }, []);

  const checkSlice = useCallback(
    (startX: number, startY: number, endX: number, endY: number) => {
      const dx = endX - startX;
      const dy = endY - startY;

      // Create slice effect
      createSliceEffect([
        { x: startX, y: startY },
        { x: endX, y: endY },
      ]);

      // Check for oranges and bombs in the slice path
      setOranges((prev) =>
        prev.map((orange) => {
          if (orange.sliced) return orange;

          // Calculate distance from orange to line segment
          const lineLength = Math.sqrt(dx * dx + dy * dy);
          if (lineLength === 0) return orange;

          // Calculate projection of orange position onto the line
          const t = Math.max(
            0,
            Math.min(1, ((orange.x - startX) * dx + (orange.y - startY) * dy) / (lineLength * lineLength)),
          );

          // Calculate closest point on the line segment
          const closestX = startX + t * dx;
          const closestY = startY + t * dy;

          // Calculate actual distance from orange to closest point
          const distance = Math.sqrt(Math.pow(orange.x - closestX, 2) + Math.pow(orange.y - closestY, 2));

          // If orange is close enough to the slice line
          if (distance < 25) {
            sliceOrange(orange.id);
            return orange;
          }
          return orange;
        }),
      );

      // Check for bombs
      setBombs((prev) =>
        prev.map((bomb) => {
          if (bomb.sliced) return bomb;

          const lineLength = Math.sqrt(dx * dx + dy * dy);
          if (lineLength === 0) return bomb;

          const t = Math.max(
            0,
            Math.min(1, ((bomb.x - startX) * dx + (bomb.y - startY) * dy) / (lineLength * lineLength)),
          );

          const closestX = startX + t * dx;
          const closestY = startY + t * dy;

          const distance = Math.sqrt(Math.pow(bomb.x - closestX, 2) + Math.pow(bomb.y - closestY, 2));

          if (distance < 25) {
            sliceBomb(bomb.id);
            return bomb;
          }
          return bomb;
        }),
      );
    },
    [createSliceEffect, sliceOrange, sliceBomb],
  );

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!gameAreaRef.current) return;
    const rect = gameAreaRef.current.getBoundingClientRect();
    isMouseDown.current = true;
    sliceStartTime.current = Date.now();
    const position = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    lastMousePosition.current = position;
    slicePoints.current = [position];
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!gameAreaRef.current) return;
    event.preventDefault(); // Prevent scrolling while slicing
    const rect = gameAreaRef.current.getBoundingClientRect();
    isMouseDown.current = true;
    sliceStartTime.current = Date.now();
    const touch = event.touches[0];
    const position = {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
    lastMousePosition.current = position;
    slicePoints.current = [position];
  }, []);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
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
        checkSlice(lastMousePosition.current.x, lastMousePosition.current.y, currentX, currentY);
        lastMousePosition.current = { x: currentX, y: currentY };
      }
    },
    [checkSlice, createSliceEffect],
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!isMouseDown.current || !gameAreaRef.current) return;
      event.preventDefault(); // Prevent scrolling while slicing

      // Check if slice duration exceeds 200ms
      if (Date.now() - sliceStartTime.current > 200) {
        isMouseDown.current = false;
        createSliceEffect(slicePoints.current);
        slicePoints.current = [];
        return;
      }

      const rect = gameAreaRef.current.getBoundingClientRect();
      const touch = event.touches[0];
      const currentX = touch.clientX - rect.left;
      const currentY = touch.clientY - rect.top;

      // Ajouter le point au chemin
      slicePoints.current.push({ x: currentX, y: currentY });

      // Vérifier les oranges sur le chemin
      const dx = currentX - lastMousePosition.current.x;
      const dy = currentY - lastMousePosition.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 10) {
        checkSlice(lastMousePosition.current.x, lastMousePosition.current.y, currentX, currentY);
        lastMousePosition.current = { x: currentX, y: currentY };
      }
    },
    [checkSlice, createSliceEffect],
  );

  const handleMouseUp = useCallback(() => {
    if (isMouseDown.current) {
      createSliceEffect(slicePoints.current);
      slicePoints.current = [];
    }
    isMouseDown.current = false;
  }, [createSliceEffect]);

  const handleTouchEnd = useCallback(() => {
    if (isMouseDown.current) {
      createSliceEffect(slicePoints.current);
      slicePoints.current = [];
    }
    isMouseDown.current = false;
  }, [createSliceEffect]);

  let lastSpawnTime = performance.now();
  const spawnOrange = (currentTime: number) => {
    if (!gameAreaRef.current) return;

    const gameArea = gameAreaRef.current;

    const timeSinceLastSpawn = currentTime - lastSpawnTime;
    const clampedWidth = (Math.max(Math.min(gameArea.clientWidth, 1800), 400) - 400) / 1400;
    const widthMult = 1.2 - 0.6 * clampedWidth;
    if (timeSinceLastSpawn < SPAWN_INTERVAL * widthMult) {
      return; // Skip spawning if not enough time has passed
    }
    lastSpawnTime = currentTime + Math.random() * SPAWN_INTERVAL * 0.4 - SPAWN_INTERVAL * 0.2;

    const x = Math.random() * (gameArea.clientWidth - 50);

    // 20% chance to spawn a bomb instead of an orange
    if (Math.random() < 0.2) {
      const bomb: Bomb = {
        id: nextOrangeId.current++,
        x,
        y: -50,
        rotation: Math.random() * 360,
        speed: INITIAL_SPEED,
        sliced: false,
      };
      setBombs((prev) => [...prev, bomb]);
    } else {
      const orange: Orange = {
        id: nextOrangeId.current++,
        x,
        y: -50,
        rotation: Math.random() * 360,
        speed: INITIAL_SPEED,
        sliced: false,
      };
      setOranges((prev) => [...prev, orange]);
    }
  };

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem("count", count.toString());
    localStorage.setItem("achievements", JSON.stringify(achievements));
    localStorage.setItem("bombPenalty", bombPenalty.toString());
  }, [count, achievements, bombPenalty]);

  // Update orange and bomb positions
  useEffect(() => {
    let currentTime = performance.now();
    const animationFrame = requestAnimationFrame(function animate(time) {
      const elapsed = time - currentTime;
      currentTime = time;
      if (!document.hidden) {
        spawnOrange(currentTime);
      }

      setOranges((prev) =>
        prev
          .map((orange) => ({
            ...orange,
            y: orange.y + orange.speed * (elapsed / 10),
            speed: orange.speed + GRAVITY * (elapsed / 10),
            rotation: orange.rotation + 2 * (elapsed / 10),
          }))
          .filter((orange) => orange.y < window.innerHeight + 100),
      );

      setBombs((prev) =>
        prev
          .map((bomb) => ({
            ...bomb,
            y: bomb.y + bomb.speed * (elapsed / 10),
            speed: bomb.speed + GRAVITY * (elapsed / 10),
            rotation: bomb.rotation + 2 * (elapsed / 10),
          }))
          .filter((bomb) => bomb.y < window.innerHeight + 100),
      );

      requestAnimationFrame(animate);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, []);

  // Achievement check effect
  useEffect(() => {
    [...achievements].reverse().forEach((achievement) => {
      if (!achievement.unlocked && count >= achievement.threshold) {
        const updatedAchievements = achievements.map((a) =>
          a.id === achievement.id ? { ...a, unlocked: true } : a,
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
    if (!wallet?.address) {
      setCount(0);
      return;
    }
    nodeService
      .getBalance(wallet.address)
      .then((balance) => {
        setCount(balance);
      })
      .catch((_) => {
        setCount(0);
      });
  }, [wallet?.address]);

  // Mettre à jour la position des particules avec la balistique
  useEffect(() => {
    const animationFrame = requestAnimationFrame(function animate() {
      setJuiceParticles((prev) =>
        prev.map((particle) => {
          const time = particle.time + 0.016; // ~60fps
          // Mise à jour de la vitesse verticale avec la gravité (augmentée)
          const currentVelocityY = particle.velocityY + GRAVITY * 3;

          // Mise à jour de la position
          const newX = particle.x + particle.velocityX;
          const newY = particle.y + currentVelocityY;

          return {
            ...particle,
            x: newX,
            y: newY,
            velocityY: currentVelocityY,
            time,
          };
        }),
      );
      requestAnimationFrame(animate);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, []);

  // Decay click speed over time with smoothing
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      clickTimestamps.current = clickTimestamps.current.filter(timestamp => now - timestamp < 1000);
      
      // Calculate raw clicks per second
      const rawCPS = clickTimestamps.current.length;
      
      // Apply exponential smoothing for smoother transitions
      const smoothingFactor = 0.3; // Higher = more responsive, lower = smoother
      smoothedClicksPerSecond.current = smoothingFactor * rawCPS + (1 - smoothingFactor) * smoothedClicksPerSecond.current;
      
      setClicksPerSecond(smoothedClicksPerSecond.current);
    }, 16); // Update every frame (~60fps) for maximum smoothness
    
    return () => clearInterval(interval);
  }, []);
  
  // Update button particles
  useEffect(() => {
    const animationFrame = requestAnimationFrame(function animate() {
      setButtonParticles((prev) => 
        prev
          .map((particle) => ({
            ...particle,
            x: particle.x + particle.velocityX,
            y: particle.y + particle.velocityY,
            velocityY: particle.velocityY + 0.3, // Gravity
            opacity: particle.opacity - 0.02,
            rotation: particle.rotation + 5,
          }))
          .filter((particle) => particle.opacity > 0)
      );
      requestAnimationFrame(animate);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, []);
  
  // Update explosion particles
  useEffect(() => {
    const animationFrame = requestAnimationFrame(function animate() {
      setExplosionParticles((prev) =>
        prev.map((particle) => {
          const time = particle.time + 0.016;
          const currentVelocityY = particle.velocityY + GRAVITY * 2;

          return {
            ...particle,
            x: particle.x + particle.velocityX,
            y: particle.y + currentVelocityY,
            velocityY: currentVelocityY,
            time,
          };
        }),
      );
      requestAnimationFrame(animate);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, []);

  if (isLoadingConfig) {
    return <div>Loading configuration...</div>;
  }

  const renderCustomWalletButton = ({ onClick }: { onClick: () => void }) => (
    <button className="wallet-address" onClick={onClick} style={{ padding: "10px 20px", fontSize: "1rem" }}>
      {wallet ? "Log Out from Custom" : "Login or Signup"}
    </button>
  );

  return (
    <div className="App">
      {/* Logo */}
      <img
        src="/wordart.png"
        alt="Logo"
        style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          height: "80px",
          width: "auto",
          zIndex: 100,
          filter: "drop-shadow(2px 2px 4px rgba(0,0,0,0.5))",
        }}
        className="logo-responsive"
      />
      
      {/* Big Red Button Modal */}
      {showButtonModal && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              zIndex: 999,
            }}
            onClick={() => setShowButtonModal(false)}
          />
          
          {/* Modal */}
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              backgroundColor: "#2c3e50",
              border: "3px solid #ff9500",
              borderRadius: "20px",
              padding: "40px",
              zIndex: 1000,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              boxShadow: "0 0 50px rgba(255, 149, 0, 0.6)",
              background: "linear-gradient(135deg, #2c3e50 0%, #1a252f 100%)",
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setShowButtonModal(false)}
              style={{
                position: "absolute",
                top: "10px",
                right: "10px",
                background: "transparent",
                border: "none",
                color: "#ff9500",
                fontSize: "24px",
                cursor: "pointer",
                padding: "5px",
              }}
            >
              ✕
            </button>
            
            <h2 style={{ 
              color: "#ff9500", 
              marginBottom: "20px", 
              textAlign: "center",
              fontSize: "2.5rem",
              textShadow: "2px 2px 4px rgba(0,0,0,0.5)",
              fontWeight: "bold",
            }}>
              {wallet?.address ? "🍊 FREE ORANJ! 🍊" : "Connect Wallet First"}
            </h2>
            
            {/* Click Speed Gauge */}
            <div style={{
              width: "400px",
              marginBottom: "20px",
            }}>
              <div style={{
                fontSize: "1.2rem",
                color: "#fff",
                marginBottom: "10px",
                textAlign: "center",
                position: "relative",
              }}>
                Click Speed: {clicksPerSecond.toFixed(1)} clicks/sec
                {/* Boost Indicator */}
                {clicksPerSecond >= 5 && (
                  <span style={{
                    marginLeft: "10px",
                    fontSize: "1.4rem",
                    fontWeight: "bold",
                    color: clicksPerSecond >= 9 ? "#e74c3c" : "#f39c12",
                    textShadow: "0 0 10px rgba(255, 255, 255, 0.5)",
                    animation: "bounce 0.5s ease-in-out infinite",
                  }}>
                    {clicksPerSecond >= 9 ? "3X BOOST! 🚀" : "2X BOOST! 🔥"}
                  </span>
                )}
              </div>
              
              {/* Gauge Background */}
              <div style={{
                width: "100%",
                height: "40px",
                backgroundColor: "rgba(255, 255, 255, 0.1)",
                borderRadius: "20px",
                position: "relative",
                overflow: "hidden",
                border: "2px solid rgba(255, 255, 255, 0.3)",
              }}>
                {/* Gauge Fill */}
                <div style={{
                  width: `${Math.min((clicksPerSecond / 10) * 100, 100)}%`,
                  height: "100%",
                  background: `linear-gradient(90deg, 
                    #2ecc71 0%, 
                    #f1c40f 33%, 
                    #e67e22 66%, 
                    #e74c3c 100%)`,
                  borderRadius: "18px",
                  transition: "width 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  position: "relative",
                }}>
                  {/* Glow effect */}
                  <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "rgba(255, 255, 255, 0.3)",
                    filter: "blur(10px)",
                    animation: clicksPerSecond > 5 ? "pulse 0.5s ease-in-out infinite" : "none",
                  }} />
                </div>
                
                {/* Boost Zone Indicators */}
                <div style={{
                  position: "absolute",
                  left: "50%", // 5 clicks/sec = 50% of 10
                  top: 0,
                  bottom: 0,
                  width: "2px",
                  backgroundColor: "#f39c12",
                  opacity: 0.5,
                }} />
                <div style={{
                  position: "absolute",
                  left: "90%", // 9 clicks/sec = 90% of 10
                  top: 0,
                  bottom: 0,
                  width: "2px",
                  backgroundColor: "#e74c3c",
                  opacity: 0.5,
                }} />
                
                {/* Gauge Markers */}
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 10px",
                  pointerEvents: "none",
                }}>
                  <span style={{ 
                    position: "absolute",
                    left: "10px",
                    color: "#fff", 
                    fontSize: "0.8rem", 
                    opacity: 0.7 
                  }}>0</span>
                  <span style={{ 
                    position: "absolute",
                    left: "calc(50% - 20px)",
                    color: clicksPerSecond >= 5 ? "#f39c12" : "#fff", 
                    fontSize: clicksPerSecond >= 5 ? "0.9rem" : "0.8rem", 
                    fontWeight: clicksPerSecond >= 5 ? "bold" : "normal",
                    opacity: clicksPerSecond >= 5 ? 1 : 0.7 
                  }}>5 (2X)</span>
                  <span style={{ 
                    position: "absolute",
                    left: "calc(90% - 20px)",
                    color: clicksPerSecond >= 9 ? "#e74c3c" : "#fff", 
                    fontSize: clicksPerSecond >= 9 ? "0.9rem" : "0.8rem", 
                    fontWeight: clicksPerSecond >= 9 ? "bold" : "normal",
                    opacity: clicksPerSecond >= 9 ? 1 : 0.7 
                  }}>9 (3X)</span>
                  <span style={{ 
                    position: "absolute",
                    right: "10px",
                    color: "#fff", 
                    fontSize: "0.8rem", 
                    opacity: 0.7 
                  }}>10</span>
                </div>
              </div>
              
              {/* Speed indicator text */}
              <div style={{
                textAlign: "center",
                marginTop: "5px",
                fontSize: "0.9rem",
                color: clicksPerSecond < 3 ? "#2ecc71" :
                       clicksPerSecond < 6 ? "#f1c40f" :
                       clicksPerSecond < 8 ? "#e67e22" : "#e74c3c",
                fontWeight: "bold",
              }}>
                {clicksPerSecond < 3 ? "Slow & Steady" :
                 clicksPerSecond < 6 ? "Getting Warmer!" :
                 clicksPerSecond < 8 ? "On Fire! 🔥" : "INSANE SPEED! 🚀"}
              </div>
            </div>
            
            <div
              style={{
                cursor: wallet?.address ? "pointer" : "not-allowed",
                opacity: wallet?.address ? 1 : 0.5,
                transition: "transform 0.1s ease",
                transform: isButtonPressed ? "scale(0.95)" : "scale(1)",
              }}
              onClick={(e) => handleBigRedButton(e)}
              onMouseDown={() => setIsButtonPressed(true)}
              onMouseUp={() => setIsButtonPressed(false)}
              onMouseLeave={() => setIsButtonPressed(false)}
            >
              <img
                src={isButtonPressed ? "/button-pressed.png" : "/button.png"}
                alt="Big Red Button"
                style={{
                  width: "450px",
                  height: "450px",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  filter: wallet?.address ? "none" : "grayscale(50%)",
                }}
                draggable={false}
              />
            </div>
            
            {bombPenalty > 0 && (
              <p style={{ 
                color: "#ff4444", 
                marginTop: "20px",
                fontSize: "1.2rem",
                textAlign: "center",
              }}>
                💣 Bomb penalty active: {bombPenalty} clicks remaining
              </p>
            )}
            
            <p style={{
              color: "#95a5a6",
              marginTop: "15px",
              fontSize: "0.9rem",
              textAlign: "center",
            }}>
              Each click = {clicksPerSecond >= 9 ? "3" : clicksPerSecond >= 5 ? "2" : "1"} ORANJ token{clicksPerSecond >= 5 ? "s" : ""}!
            </p>
          </div>
          
          {/* Render button particles */}
          {buttonParticles.map((particle) => (
            <div
              key={particle.id}
              style={{
                position: "fixed",
                left: particle.x,
                top: particle.y,
                width: particle.size,
                height: particle.size,
                backgroundImage: "url('/orange.png')",
                backgroundSize: "contain",
                backgroundRepeat: "no-repeat",
                opacity: particle.opacity,
                transform: `translate(-50%, -50%) rotate(${particle.rotation}deg)`,
                pointerEvents: "none",
                zIndex: 1001,
                filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
              }}
            />
          ))}
        </>
      )}
      
      <TransactionList transactions={transactions} setTransactions={setTransactions} />
      <div className="wallet-input">
        {(!wallet?.address && (
          <HyliWallet providers={["password", "google", "github", "x"]} button={renderCustomWalletButton} />
        )) || (
            <span
              className="wallet-address"
              style={{
                hyphens: "auto",
                overflowWrap: "break-word",
                width: "100%",
                maxWidth: "600px",
                padding: "8px",
              }}
            >
              {wallet?.address}
              <div onClick={logout} style={{ cursor: "pointer", textDecoration: "underline" }}>
                (Log Out)
              </div>
            </span>
          )}
      </div>
      <div className={`score ${isScoreShaking ? "shake" : ""}`}>
        {/* Progress Bar Container */}
        <div style={{ 
          width: "100%", 
          maxWidth: "600px", 
          margin: "0 auto 20px",
          textAlign: "center"
        }}>
          <div style={{
            fontSize: "2rem",
            fontWeight: "bold",
            marginBottom: "10px",
            color: "#ff9500",
            textShadow: "2px 2px 4px rgba(0,0,0,0.3)"
          }}>
            🚀 {count.toLocaleString()} ORANJ
          </div>
          
          {/* Calculate current tier and progress */}
          {(() => {
            const tiers = [
              { min: 0, max: 100, label: "100" },
              { min: 100, max: 250, label: "250" },
              { min: 250, max: 500, label: "500" },
              { min: 500, max: 1000, label: "1K" },
              { min: 1000, max: 10000, label: "10K" },
              { min: 10000, max: 25000, label: "25K" },
              { min: 25000, max: 50000, label: "50K" },
              { min: 50000, max: 75000, label: "75K" },
              { min: 75000, max: 100000, label: "100K" },
              { min: 100000, max: 250000, label: "250K" },
              { min: 250000, max: 500000, label: "500K" },
              { min: 500000, max: 750000, label: "750K" },
              { min: 750000, max: 1000000, label: "1M" },
            ];
            
            const currentTier = tiers.find(tier => count >= tier.min && count < tier.max) || tiers[tiers.length - 1];
            const tierProgress = ((count - currentTier.min) / (currentTier.max - currentTier.min)) * 100;
            const currentTierIndex = tiers.indexOf(currentTier);
            
            return (
              <>
                {/* Current tier info */}
                <div style={{
                  fontSize: "1.2rem",
                  marginBottom: "10px",
                  color: "#95a5a6"
                }}>
                  Progress to {currentTier.label}: {count >= 1000000 ? "🎉 COMPLETED! 🎉" : `${Math.floor(tierProgress)}%`}
                </div>
                
                {/* Progress Bar Background */}
                <div style={{
                  width: "100%",
                  height: "30px",
                  backgroundColor: "rgba(255, 149, 0, 0.2)",
                  borderRadius: "15px",
                  position: "relative",
                  overflow: "hidden",
                  border: "2px solid #ff9500",
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.2)"
                }}>
                  {/* Progress Bar Fill */}
                  <div style={{
                    width: count >= 1000000 ? "100%" : `${Math.min(tierProgress, 100)}%`,
                    height: "100%",
                    background: count >= 1000000 
                      ? "linear-gradient(90deg, #2ecc71 0%, #27ae60 100%)"
                      : "linear-gradient(90deg, #ff6b00 0%, #ff9500 50%, #ffb347 100%)",
                    borderRadius: "13px",
                    position: "relative",
                    transition: "width 0.3s ease",
                    boxShadow: "0 2px 8px rgba(255, 149, 0, 0.4)",
                    animation: count > 0 ? "pulse 2s ease-in-out infinite" : "none"
                  }}>
                    {/* Glow effect on the end */}
                    {count < 1000000 && (
                      <div style={{
                        position: "absolute",
                        right: "-5px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: "10px",
                        height: "140%",
                        background: "radial-gradient(ellipse at center, rgba(255,255,255,0.8) 0%, transparent 70%)",
                        filter: "blur(3px)"
                      }} />
                    )}
                  </div>
                  
                  {/* Current vs Next milestone */}
                  <div style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    fontSize: "0.9rem",
                    fontWeight: "bold",
                    color: tierProgress > 50 || count >= 1000000 ? "#fff" : "#ff9500",
                    textShadow: "1px 1px 2px rgba(0,0,0,0.5)"
                  }}>
                    {count >= 1000000 ? "🏆 1M ACHIEVED!" : `${count.toLocaleString()} / ${currentTier.max.toLocaleString()}`}
                  </div>
                </div>
                
                {/* Tier indicators */}
                <div style={{
                  display: "flex",
                  justifyContent: "center",
                  marginTop: "15px",
                  gap: "8px",
                  flexWrap: "wrap"
                }}>
                  {tiers.map((tier, index) => (
                    <div
                      key={tier.label}
                      style={{
                        padding: "4px 8px",
                        borderRadius: "12px",
                        fontSize: "0.8rem",
                        fontWeight: index <= currentTierIndex ? "bold" : "normal",
                        backgroundColor: index < currentTierIndex 
                          ? "#2ecc71" 
                          : index === currentTierIndex 
                            ? "#ff9500" 
                            : "rgba(149, 165, 166, 0.2)",
                        color: index <= currentTierIndex ? "#fff" : "#95a5a6",
                        border: index === currentTierIndex ? "2px solid #ff9500" : "none",
                        transition: "all 0.3s ease"
                      }}
                    >
                      {tier.label} {index < currentTierIndex && "✓"}
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
          
          {/* T-shirt incentive text */}
          <div style={{
            marginTop: "20px",
            fontSize: "1rem",
            color: "#2ecc71",
            fontWeight: "bold",
            textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
            animation: "glow 2s ease-in-out infinite"
          }}>
            👕 First 10 to achieve 1M oranges get a FREE T-SHIRT! 👕
          </div>
        </div>
        
        {bombPenalty > 0 && (
          <span style={{ color: "#ff4444", marginLeft: "10px" }}>💣 Penalty: {bombPenalty} oranges</span>
        )}
        
        <style>{`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.8; }
            100% { opacity: 1; }
          }
          @keyframes glow {
            0% { 
              text-shadow: 1px 1px 2px rgba(0,0,0,0.5), 0 0 10px rgba(46, 204, 113, 0.5);
            }
            50% { 
              text-shadow: 1px 1px 2px rgba(0,0,0,0.5), 0 0 20px rgba(46, 204, 113, 0.8);
            }
            100% { 
              text-shadow: 1px 1px 2px rgba(0,0,0,0.5), 0 0 10px rgba(46, 204, 113, 0.5);
            }
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
          }
        `}</style>
      </div>
      
      {/* Want a challenge button */}
      <button
        onClick={() => setShowButtonModal(true)}
        style={{
          marginTop: "20px",
          padding: "15px 30px",
          backgroundColor: "#ff9500",
          color: "white",
          border: "none",
          borderRadius: "10px",
          cursor: "pointer",
          fontSize: "1.2rem",
          fontWeight: "bold",
          transition: "all 0.3s ease",
          boxShadow: "0 4px 15px rgba(255, 149, 0, 0.3)",
          transform: "translateY(0)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#ff7700";
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "0 6px 20px rgba(255, 149, 0, 0.4)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "#ff9500";
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 4px 15px rgba(255, 149, 0, 0.3)";
        }}
      >
        Wanna go faster?
      </button>

      <div
        className="wallet-address desktopOnly"
        style={{
          display: "none",
          width: "auto",
          position: "absolute",
          top: "20px",
          right: "20px",
          padding: "4px 10px",
          fontSize: "1.0em",
          maxWidth: "300px",
          height: "60px",
        }}
      >
        Want to know the secret sauce?
        <br />
        <a
          href="https://x.com/hyli_org/status/1935058978813395030"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#fff", textDecoration: "underline" }}
        >
          Read more here
        </a>
      </div>

      <div
        ref={gameAreaRef}
        className="game-area"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: "none" }} // Prevent default touch actions
      >
        <maintenance-widget />

        {!wallet?.address && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              padding: "20px",
              borderRadius: "10px",
              textAlign: "center",
              zIndex: 1000,
              color: "#ff6b6b",
              maxWidth: "80%",
              boxShadow: "0 0 20px rgba(0, 0, 0, 0.5)",
            }}
          >
            <h2 style={{ margin: "0 0 10px 0" }}>🎮 Ready to Play?</h2>
            <p style={{ margin: "0", fontSize: "1.1em" }}>
              Please enter your wallet address above to start slicing oranges and earning ORANJ tokens!
            </p>
          </div>
        )}
        {oranges.map((orange) => (
          <div key={orange.id}>
            <div
              className={`orange ${orange.sliced ? "sliced" : ""}`}
              style={
                {
                  "--rotation": `${orange.rotation}deg`,
                  transform: `translateX(${orange.x}px) translateY(${orange.y}px) translate(-50%, -50%) rotate(${orange.rotation}deg)`,
                } as React.CSSProperties
              }
            />
            {orange.sliced && (
              <>
                <div
                  className={`orange half top`}
                  style={
                    {
                      "--x-offset": `${orange.x}px`,
                      "--y-offset": `${orange.y}px`,
                      "--rotation": `${orange.rotation}deg`,
                      "--fly-distance": "-50px",
                      transform: `translate(-50%, -50%) rotate(${orange.rotation}deg)`,
                    } as React.CSSProperties
                  }
                />
                <div
                  className={`orange half bottom`}
                  style={
                    {
                      "--x-offset": `${orange.x}px`,
                      "--y-offset": `${orange.y}px`,
                      "--rotation": `${orange.rotation}deg`,
                      "--fly-distance": "50px",
                      transform: `translate(-50%, -50%) rotate(${orange.rotation}deg)`,
                    } as React.CSSProperties
                  }
                />
              </>
            )}
          </div>
        ))}
        {bombs.map((bomb) => (
          <div key={bomb.id}>
            <div
              className={`bomb ${bomb.sliced ? "sliced" : ""}`}
              style={
                {
                  "--rotation": `${bomb.rotation}deg`,
                  transform: `translateX(${bomb.x}px) translateY(${bomb.y}px) translate(-50%, -50%) rotate(${bomb.rotation}deg)`,
                } as React.CSSProperties
              }
            />
            {bomb.sliced && (
              <>
                <div
                  className="bomb-half top"
                  style={
                    {
                      "--x-offset": `${bomb.x}px`,
                      "--y-offset": `${bomb.y}px`,
                      "--rotation": `${bomb.rotation}deg`,
                      "--fly-distance": "-50px",
                      transform: `translateX(${bomb.x}px) translateY(${bomb.y}px) translate(-50%, -50%) rotate(${bomb.rotation}deg)`,
                    } as React.CSSProperties
                  }
                />
                <div
                  className="bomb-half bottom"
                  style={
                    {
                      "--x-offset": `${bomb.x}px`,
                      "--y-offset": `${bomb.y}px`,
                      "--rotation": `${bomb.rotation}deg`,
                      "--fly-distance": "50px",
                      transform: `translateX(${bomb.x}px) translateY(${bomb.y}px) translate(-50%, -50%) rotate(${bomb.rotation}deg)`,
                    } as React.CSSProperties
                  }
                />
              </>
            )}
          </div>
        ))}
        {juiceParticles.map((particle) => (
          <div
            key={particle.id}
            className="orange-juice"
            style={
              {
                /*left: `${particle.x}px`,
top: `${particle.y}px`,*/
                transform: `translateX(${particle.x}px) translateY(${particle.y}px)`,
                opacity: Math.max(0, 1 - particle.time / 1.5),
              } as React.CSSProperties
            }
          />
        ))}
        {explosionParticles.map((particle) => (
          <div
            key={particle.id}
            style={{
              position: "absolute",
              left: `${particle.x}px`,
              top: `${particle.y}px`,
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              backgroundColor: particle.color,
              borderRadius: "50%",
              transform: "translate(-50%, -50%)",
              opacity: Math.max(0, 1 - particle.time / 1),
              boxShadow: `0 0 ${particle.size * 2}px ${particle.color}`,
              transition: "opacity 0.1s ease-out",
            }}
          />
        ))}

        {false && (
          <div
            className={hideModal ? "" : "desktopOnly"}
            style={{
              display: "none",
              position: "absolute",
              bottom: "20px",
              right: "20px",
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              padding: "8px 16px",
              borderRadius: "10px",
              textAlign: "center",
              zIndex: 1000,
              color: "#ff6b6b",
              boxShadow: "0 0 20px rgba(0, 0, 0, 0.5)",
              maxWidth: "260px",
              opacity: moreInfoModalOpacity,
              transition: "opacity 0.5s ease-in-out",
            }}
          >
            <button
              onClick={() => setHideModal(true)}
              style={{
                position: "absolute",
                top: 0,
                right: 4,
                background: "transparent",
                border: "none",
                color: "#ffffff",
                fontSize: 20,
                cursor: "pointer",
                zIndex: 1001,
              }}
              aria-label="Close"
            >
              &times;
            </button>
            <h3
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "10px",
                alignItems: "center",
                margin: "0 0 10px 0",
              }}
            >
              Hyli x Boundless <img src="/berry.png" alt="Berrified" style={{ width: "24px" }}></img>{" "}
            </h3>
            <p style={{ textAlign: "left", fontSize: "0.9em" }}>
              Hyli is partnering with Boundless for our Risc0 Proofs!
              <br />
              Read more on{" "}
              <a style={{ color: "#ff9b6b" }} href="https://x.com/hyli_org/status/1938586176740598170">
                X
              </a>
            </p>
          </div>
        )}
      </div>

      {lastAchievement && (
        <div className="achievement-popup">
          <h3>🏆 Achievement Unlocked!</h3>
          <div className="achievement-title">{lastAchievement.title}</div>
          <div className="achievement-description">{lastAchievement.description}</div>
        </div>
      )}

      <div className="achievements-container">
        {wallet && (<Leaderboard account={wallet?.address} />
        )}
        <div className="achievements">
          <h3>🏆 Achievements</h3>
          <div className="achievement-list">
            {achievements.map((achievement) => (
              <div
                key={achievement.id}
                className={`achievement ${achievement.unlocked ? "unlocked" : "locked"}`}
              >
                <div className="achievement-title">{achievement.title}</div>
                <div className="achievement-description">{achievement.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
