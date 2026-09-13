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
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

import { PrivyStandardBridge } from "@/components/PrivyStandardBridge";
import { SITE_URL } from "@/lib/brand";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/* Whichever host this actually is, rather than whichever one we hope it will
 * be. SITE_URL falls back to the apex, which does not resolve until the domain
 * goes live, and a dead link in the consent footer is worse than no branding.
 * Reading the origin means localhost, the preview and the apex are all correct
 * with nothing to remember to change on the day. */
const origin = () => (typeof window === "undefined" ? SITE_URL : window.location.origin);

/* Every Solana chain pointed at the one cluster this deployment runs on.
 *
 * Not laziness. wallet-adapter names a chain when it SENDS a transaction, and
 * names none when it merely signs one, which is all this app ever asks for.
 * Privy then falls back to its own default, mainnet, and refuses to sign at all
 * with "No RPC configuration found for chain solana:mainnet".
 *
 * There is no setting for Privy's default chain, so the only way through is to
 * answer for whichever chain it decides to ask about. Since the app talks to
 * exactly one cluster at a time, answering with that cluster is right whatever
 * it asks: on devnet Privy previews a devnet transaction against devnet, and
 * the day CLUSTER becomes mainnet the same code previews mainnet against
 * mainnet. The alternative, naming each chain honestly, would have Privy
 * simulate our devnet transactions against the real mainnet and show the user
 * nonsense. */
function rpcsFor(endpoint: string) {
  const ws = endpoint.replace(/^http/, "ws");
  const one = () => ({ rpc: createSolanaRpc(endpoint), rpcSubscriptions: createSolanaRpcSubscriptions(ws) });
  return { "solana:mainnet": one(), "solana:devnet": one(), "solana:testnet": one() };
}

export function PrivySignIn({ children, endpoint }: { children: ReactNode; endpoint: string }) {
  const config = useMemo<PrivyClientConfig>(() => {
    const here = origin();
    return {
      solana: { rpcs: rpcsFor(endpoint) },
      /* Wallet first, then the ways in for people who have never held one.
       * One door, both kinds of arrival, which is what Fomo does. */
      loginMethods: ["wallet", "twitter", "google", "email"],
      // A Solana wallet, made on the way in, for anyone who arrives without
      // one. Ethereum is Privy's default and is no use to us.
      embeddedWallets: {
        solana: { createOnLogin: "users-without-wallets" },
        ethereum: { createOnLogin: "off" },
        showWalletUIs: true,
      },
      /* Without this Privy does no Solana wallet detection whatsoever, so it
       * never sees an installed Phantom and offers the download page instead
       * of opening the extension. Its own docstring is the giveaway: the
       * factory "wraps the wallet detection logic" from the Wallet Standard
       * packages. Naming wallets in walletList only decides what is drawn;
       * this is what makes them connectable. */
      externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
      /* The same cyan as the "Pick a fight" button, so the sign-in reads as
       * part of the app. Pink belongs to player two and orange means cooked;
       * borrowing either here would blunt what they mean everywhere else. */
      appearance: {
        theme: "dark",
        accentColor: "#2fe0ff",
        walletChainType: "solana-only",
        logo: "/icon.png",
        showWalletLoginFirst: true,
        /* Named so they keep their own icons and order, plus a catch-all so a
         * wallet we have not listed still appears if the visitor has it. */
        walletList: ["phantom", "solflare", "backpack", "jupiter", "detected_solana_wallets"],
      },
      /* Overrides the dashboard, which points at the apex and so currently
       * asks people to accept terms behind two links that do not resolve. */
      legal: {
        termsAndConditionsUrl: `${here}/terms`,
        privacyPolicyUrl: `${here}/privacy`,
      },
    } satisfies PrivyClientConfig;
  }, [endpoint]);

  if (!PRIVY_APP_ID) return <>{children}</>;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={config}>
      {/* Inside the provider because it needs Privy's hooks, but outside
       * WalletProvider is fine: registration is a window event, and
       * wallet-adapter listens for late arrivals. */}
      <PrivyStandardBridge />
      {children}
    </PrivyProvider>
  );
}
