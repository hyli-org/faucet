import { useState, useEffect } from "react";
import { nodeService } from "../services/NodeService";
import "./Leaderboard.css";

interface LeaderboardEntry {
    address: string;
    balance: number;
}

// interface OranjStateEntry {
//   address: string;
//   balance: number;
//   allowances: Record<string, unknown>;
// }

interface LeaderboardResponse {
    [key: string]: number;
}

interface IndexerResponse {
    leaderboard: LeaderboardResponse;
    rank: number | null;
}

export function Leaderboard({ account }: { account: string }) {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [rank, setRank] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshProgress, setRefreshProgress] = useState(0);

    useEffect(() => {
        const fetchLeaderboard = async () => {
            try {
                setError(null);
                const response = await nodeService.server.get<IndexerResponse>(
                    "v1/indexer/contract/faucet/leaderboard/" + account,
                    "get leaderboard",
                );

                // Filter out faucet addresses, sort by balance in descending order and take top 15
                const sortedEntries = Object.entries(response.leaderboard)
                    .sort((a, b) => b[1] - a[1])
                    .map(([address, balance]) => ({
                        address,
                        balance: Number(balance),
                    }))
                    .slice(0, 50);

                setEntries(sortedEntries);
                setRank(response.rank);
                setRefreshProgress(0);
            } catch (err) {
                setError("Failed to load leaderboard");
                console.error("Error fetching leaderboard:", err);
            }
        };

        fetchLeaderboard();
        const interval = setInterval(fetchLeaderboard, 10000);

        // Progress bar animation
        const progressInterval = setInterval(() => {
            setRefreshProgress((prev) => {
                return prev + 1;
            });
        }, 100);

        return () => {
            clearInterval(interval);
            clearInterval(progressInterval);
        };
    }, []);

    if (error) {
        return (
            <div className="leaderboard">
                <h3>🏆 Leaderboard</h3>
                <div className="error">{error}</div>
            </div>
        );
    }

    return (
        <div className="leaderboard">
            <h3>🏆 Leaderboard</h3>
            <div className="refresh-progress" style={{ width: `${refreshProgress}%` }} />
            {rank !== null && (
                <div className="rank-info">
                    <span>Your Rank: #{rank}</span>
                </div>
            )}
            <div className="leaderboard-list">
                {entries.map((entry, index) => (
                    <div key={entry.address} className="leaderboard-entry">
                        <span className="rank">#{index + 1}</span>
                        <span className="address">{entry.address}</span>
                        <span className="balance">{entry.balance.toLocaleString()} ORANJ</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
