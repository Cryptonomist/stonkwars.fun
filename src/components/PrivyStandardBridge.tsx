"use client";

/* The one call Privy does not make for you.
 *
 * Privy builds a complete Wallet Standard wallet for its embedded wallets:
 * standard:connect, standard:events, solana:signTransaction,
 * solana:signAndSendTransaction, solana:signMessage, all three Solana chains,
 * and legacy plus v0 transactions. Everything wallet-adapter asks for. It then
 * never announces it, so nothing on the page can find it.
 *
 * That is deliberate rather than an oversight: Privy depends on
 * @wallet-standard/app, the half that READS the registry to discover Phantom,
 * and not on @wallet-standard/wallet, the half that writes to it. It is a
 * consumer of the registry and never a producer. Searching its bundle for
 * "wallet-standard:register-wallet" returns nothing at all.
 *
 * So we announce it. One call, and the wallet drops into the same list Phantom
 * and Solflare are already in, which is the list every useWallet() in this app
 * already reads. No signing code, no second path, no call site touched.
 *
 * This must stay mounted. Calling the hook is not incidental bookkeeping: its
 * effects are what install the signing implementation and push accounts into
 * Privy's module singleton, which ships inert with throwing stubs. Unmount it
 * and the wallet is announced but cannot sign. */

import { useEffect, useRef } from "react";
import { registerWallet } from "@wallet-standard/wallet";
import { useStandardWallets } from "@privy-io/react-auth/solana";

export function PrivyStandardBridge() {
  const { ready, wallets } = useStandardWallets();
  /* Announcing twice would put two identical entries in the picker, and the
   * registry has no way to take one back. */
  const announced = useRef(false);

  useEffect(() => {
    if (!ready || announced.current) return;
    /* Privy wraps the extensions it discovered as well as its own, and
     * re-announcing its copy of Phantom would show the visitor two Phantoms.
     * Only ours is missing from the registry, so only ours goes in. */
    const own = wallets.find((w) => (w as { isPrivyWallet?: boolean }).isPrivyWallet);
    if (!own) return;
    /* And not until it has an account. wallet-adapter calls standard:connect
     * only when the list is already empty, then takes accounts[0] and throws
     * WalletAccountError if it is still missing. Announcing early therefore
     * publishes a wallet that can never connect, and the registry has no way
     * to withdraw it. Privy fills these in after sign-in, so this effect just
     * waits: `wallets` is rebuilt as they arrive, and it runs again. */
    if (!own.accounts.length) return;
    registerWallet(own);
    announced.current = true;
  }, [ready, wallets]);

  return null;
}

/** What the bridge can see, for the spike page. Not for production use. */
export function usePrivyStandardDebug() {
  const { ready, wallets } = useStandardWallets();
  const own = wallets.find((w) => (w as { isPrivyWallet?: boolean }).isPrivyWallet);
  return {
    ready,
    count: wallets.length,
    names: wallets.map((w) => w.name),
    found: Boolean(own),
    accounts: own?.accounts.length ?? 0,
    addresses: own?.accounts.map((a) => a.address) ?? [],
    chains: own ? [...own.chains] : [],
    features: own ? Object.keys(own.features) : [],
  };
}
