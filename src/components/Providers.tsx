"use client";

/* Every client-side provider, mounted once in the root layout.
 *
 * Carried over from Commish, including its two hard-won decisions:
 *
 * NO `@solana/wallet-adapter-react-ui`. Its modal and multi-button are built
 * for React 18 and fail silently under React 19: the button sticks on
 * "Connecting", nothing throws. `WalletButton` talks to `useWallet` directly.
 *
 * WALLETS ARE ALMOST EMPTY ON PURPOSE. Phantom, Solflare, Backpack and the
 * rest register through the Wallet Standard, so the adapter discovers them
 * without us importing adapters or deciding which wallets people may use. The
 * one explicit adapter is the guest wallet, which is not a Standard wallet and
 * is offered on test clusters only: it keeps its key in localStorage.
 *
 * NEXT_PUBLIC_RPC_URL ships in the bundle. It must never carry a credential.
 * Set it to "/api/rpc" to reach a paid node through this site, which keeps the
 * key on the server; see app/api/rpc/route.ts.
 */

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { clusterApiUrl } from "@solana/web3.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { GuestWalletAdapter } from "@/lib/guestWallet";
import { PrivySignIn } from "@/components/PrivySignIn";
import { CLUSTER } from "@/lib/stocks";

const FALLBACK = clusterApiUrl(CLUSTER === "mainnet-beta" ? "mainnet-beta" : "devnet");

export function Providers({ children }: { children: ReactNode }) {
  const configured = process.env.NEXT_PUBLIC_RPC_URL || FALLBACK;
  /* A relative endpoint is this site's own relay. web3.js needs an absolute
   * URL, and would derive a websocket address from it that no serverless route
   * can answer, so point subscriptions at the public node instead. Nothing in
   * the app subscribes (lib/confirm.ts polls), but a wallet might. */
  const relayed = configured.startsWith("/");
  const endpoint = useMemo(
    () => (relayed ? (typeof window === "undefined" ? FALLBACK : window.location.origin + configured) : configured),
    [configured, relayed],
  );
  const config = useMemo(
    () => ({ commitment: "confirmed" as const, ...(relayed ? { wsEndpoint: FALLBACK.replace(/^http/, "ws") } : {}) }),
    [relayed],
  );

  const wallets = useMemo(() => (CLUSTER === "mainnet-beta" ? [] : [new GuestWalletAdapter()]), []);

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
    [],
  );

  /* Privy sits outside, because its wallet announces itself to the page the
   * way an extension does, and WalletProvider has to be listening by then.
   * Without an app id it is not there at all. */
  return (
    <QueryClientProvider client={queryClient}>
      <PrivySignIn>
        <ConnectionProvider endpoint={endpoint} config={config}>
          <WalletProvider wallets={wallets} autoConnect>
            {children}
          </WalletProvider>
        </ConnectionProvider>
      </PrivySignIn>
    </QueryClientProvider>
  );
}
