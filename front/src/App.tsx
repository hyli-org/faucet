import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { blob_click } from "./types/faucet";
import { nodeService } from "./services/NodeService";
import { BlobTransaction } from "hyli";
import { useConfig } from "./hooks/useConfig";
import { transfer } from "./types/smt_token";
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
                🚀 {count.toLocaleString()} ORANJ
                {bombPenalty > 0 && (
                    <span style={{ color: "#ff4444", marginLeft: "10px" }}>💣 Penalty: {bombPenalty} oranges</span>
                )}
            </div>

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
                {
                    // Off for now to avoid incentiving TX spam
                    <Leaderboard account={wallet?.address} />
                }
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
