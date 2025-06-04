import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { WalletProvider } from "hyli-wallet";
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider
      forceSessionKey={false}
      config={{
        nodeBaseUrl: import.meta.env.VITE_NODE_BASE_URL,
        walletServerBaseUrl: import.meta.env.VITE_WALLET_SERVER_BASE_URL,
        applicationWsUrl: import.meta.env.VITE_WALLET_WS_URL
      }}
    >
      <App />
    </WalletProvider>
  </StrictMode >,
)
