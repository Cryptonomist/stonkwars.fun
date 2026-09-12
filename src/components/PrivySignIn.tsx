"use client";

/* Signing in without a wallet, and getting one anyway.
 *
 * The guest wallet puts somebody in a fight in one click, and then keeps their
 * key in localStorage with no way back if they clear it. That is fine for test
 * shares and indefensible for real ones, which is why it is refused on
 * mainnet. This is the replacement: sign in with Google, X or an email, and
 * Privy makes a Solana wallet split three ways, so neither we nor Privy can
 * sign alone and the user can always recover it.
 *
 * It is inert without NEXT_PUBLIC_PRIVY_APP_ID. No variable, no provider, and
 * the app behaves exactly as it did before. */

import { useMemo, type ReactNode } from "react";
import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function PrivySignIn({ children }: { children: ReactNode }) {
  const config = useMemo<PrivyClientConfig>(
    () =>
      ({
        // The three that suit this audience. X especially: the leaderboard
        // already knows how to show a handle.
        loginMethods: ["google", "twitter", "email"],
        // A Solana wallet, made on the way in, for anyone who arrives without
        // one. Ethereum is Privy's default and is no use to us.
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          ethereum: { createOnLogin: "off" },
          showWalletUIs: true,
        },
        /* Phantom, Solflare and the rest already reach us through
         * wallet-adapter. Two systems competing to connect the same extension
         * is a bug waiting to happen, so Privy is told to stay out of it. */
        externalWallets: { disableAllExternalWallets: true },
        /* The same cyan as the "Pick a fight" button, so the sign-in reads as
         * part of the app. Pink belongs to player two and orange means cooked;
         * borrowing either here would blunt what they mean everywhere else. */
        appearance: {
          theme: "dark",
          accentColor: "#2fe0ff",
          walletChainType: "solana-only",
          logo: "/icon.png",
        },
      }) satisfies PrivyClientConfig,
    [],
  );

  if (!PRIVY_APP_ID) return <>{children}</>;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={config}>
      {children}
    </PrivyProvider>
  );
}
