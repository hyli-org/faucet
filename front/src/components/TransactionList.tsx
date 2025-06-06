import React, { useState, useEffect } from 'react';

interface Transaction {
  id: string;
  timestamp: number;
}

interface TransactionListProps {
  transactions: Transaction[];
  setTransactions: (callback: (prev: Transaction[]) => Transaction[]) => void;
}

export const TransactionList: React.FC<TransactionListProps> = ({ transactions, setTransactions }) => {
  useEffect(() => {
    const timeout = setTimeout(() => {
      setTransactions(prev => prev.filter(tx => Date.now() - tx.timestamp < 3000));
    }, 1000);

    return () => clearTimeout(timeout);
  }, [transactions, setTransactions]);

  if (transactions.length === 0) {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      top: '10px',
      right: '10px',
      padding: '6px',
      borderRadius: '6px',
      maxWidth: '250px',
      overflowY: 'hidden',
      zIndex: 1000,
      color: 'white',
      fontSize: '1em',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {transactions.map((tx) => (
          <div key={tx.id} style={{
            padding: '4px 6px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '3px',
            wordBreak: 'break-all',
          }}>
            <div style={{ fontFamily: 'monospace', fontSize: '0.75em' }}>
              Sent tx {tx.id.slice(0, 6)}...{tx.id.slice(-6)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}; 