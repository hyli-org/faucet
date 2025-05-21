import { useState, useEffect } from 'react';
import { nodeService } from '../services/NodeService';

interface LeaderboardEntry {
  address: string;
  balance: number;
}

interface OranjStateEntry {
  address: string;
  balance: number;
  allowances: Record<string, unknown>;
}

interface IndexerResponse {
  [key: string]: OranjStateEntry;
}

export function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await nodeService.indexer.get<IndexerResponse>(
          'v1/indexer/contract/oranj/state',
          'get leaderboard'
        );
        
        // Filter out faucet addresses, sort by balance in descending order and take top 15
        const sortedEntries = Object.values(response)
          .filter(entry => !entry.address.toLowerCase().includes('faucet'))
          .map(({ address, balance }) => ({
            address,
            balance: Number(balance)
          }))
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 15);

        setEntries(sortedEntries);
      } catch (err) {
        setError('Failed to load leaderboard');
        console.error('Error fetching leaderboard:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 10000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="leaderboard">
        <h3>🏆 Leaderboard</h3>
        <div className="loading">Loading...</div>
      </div>
    );
  }

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