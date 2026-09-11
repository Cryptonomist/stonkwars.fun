"use client";

/* Every client-side provider, mounted once in the root layout.
 *
 * Carried over from Commish, including its two hard-won decisions:
 *
 * NO `@solana/wallet-adapter-react-ui`. Its modal and multi-button are built
 * for React 18 and fail silently under React 19: the button sticks on
 * "Connecting", nothing throws. `WalletButton` talks to `useWallet` directly.
 *
 * WALLETS ARE EMPTY ON PURPOSE. Phantom, Solflare, Backpack and the rest
 * register through the Wallet Standard, so the adapter discovers them without
 * us importing adapters or deciding which wallets people may use.
 *
 * NEXT_PUBLIC_RPC_URL ships in the bundle. It must never carry a credential.
 */

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { clusterApiUrl } from "@solana/web3.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function Providers({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl("devnet"),
    [],
  );

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
        <WalletProvider wallets={[]} autoConnect>
          {children}
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
