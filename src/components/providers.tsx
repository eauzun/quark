'use client';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { getDefaultConfig, RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { metaMaskWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import '@rainbow-me/rainbowkit/styles.css';
import { monad } from '@/lib/contracts';
// MetaMask is the primary wallet. With a WalletConnect project ID, MetaMask Mobile can also connect via QR/deep link.
const config = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
  ? getDefaultConfig({ appName: 'Quark', projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, chains: [monad], wallets: [{ groupName: 'Recommended', wallets: [metaMaskWallet, walletConnectWallet] }], transports: { [monad.id]: http() }, ssr: true })
  : createConfig({ chains: [monad], connectors: [injected({ target: 'metaMask' })], transports: { [monad.id]: http() }, ssr: true });
export default function Providers({ children }: { children: ReactNode }) {
  const [query] = useState(() => new QueryClient());
  return <WagmiProvider config={config}><QueryClientProvider client={query}><RainbowKitProvider modalSize="compact" theme={lightTheme({ accentColor: '#166d56', accentColorForeground: '#fff', borderRadius: 'small', fontStack: 'system' })}>{children}</RainbowKitProvider></QueryClientProvider></WagmiProvider>;
}
