"use client";

/* A SPIKE, NOT A FEATURE. Delete this page once the question is answered.
 *
 * The whole embedded-wallet plan rests on one claim nobody has tested: that a
 * Privy wallet announces itself the way a browser extension does, so the
 * wallet-adapter this app already uses picks it up and nothing else has to
 * change. This page asks that question and nothing else. Sign in, and it shows
 * whether `useWallet()` can see the result. */

import { useWallet } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets as usePrivySolanaWallets } from "@privy-io/react-auth/solana";

import { PRIVY_APP_ID } from "@/components/PrivySignIn";

export default function PrivyCheck() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets: privyWallets } = usePrivySolanaWallets();
  const { wallets, wallet, publicKey, connected } = useWallet();

  if (!PRIVY_APP_ID) {
    return <p className="py-10 text-dim">NEXT_PUBLIC_PRIVY_APP_ID is not set on this deployment.</p>;
  }

  const seenByAdapter = wallets.map((w) => w.adapter.name);
  const privyVisible = seenByAdapter.some((n) => /privy/i.test(n));

  return (
    <div className="flex flex-col gap-6 py-10">
      <div>
        <p className="label">Spike</p>
        <h1 className="display mt-2 text-5xl">Does wallet-adapter see Privy?</h1>
        <p className="mt-2 text-dim">
          Sign in below. The question is whether the wallet Privy makes shows up in the list this app already reads.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {!authenticated ? (
          <button type="button" onClick={login} disabled={!ready} className="btn btn-p1 px-8 text-lg">
            {ready ? "Sign in with Privy" : "Loading..."}
          </button>
        ) : (
          <button type="button" onClick={logout} className="btn btn-ghost">
            Sign out
          </button>
        )}
      </div>

      <dl className="card grid grid-cols-[14rem_1fr] gap-x-4 gap-y-2 p-5 font-mono text-sm">
        <dt className="text-dim">privy ready</dt>
        <dd>{String(ready)}</dd>
        <dt className="text-dim">authenticated</dt>
        <dd>{String(authenticated)}</dd>
        <dt className="text-dim">signed in as</dt>
        <dd className="truncate">{user?.google?.email ?? user?.twitter?.username ?? user?.email?.address ?? "nobody"}</dd>
        <dt className="text-dim">privy solana wallets</dt>
        <dd className="truncate">{privyWallets.map((w: { address: string }) => w.address).join(", ") || "none yet"}</dd>

        <dt className="mt-3 text-dim">wallets adapter can see</dt>
        <dd className="mt-3 truncate">{seenByAdapter.join(", ") || "none"}</dd>
        <dt className={privyVisible ? "text-up" : "text-down"}>PRIVY VISIBLE TO ADAPTER</dt>
        <dd className={privyVisible ? "text-up" : "text-down"}>{privyVisible ? "YES" : "NO"}</dd>

        <dt className="mt-3 text-dim">adapter connected</dt>
        <dd className="mt-3">{String(connected)}</dd>
        <dt className="text-dim">adapter wallet</dt>
        <dd>{wallet?.adapter.name ?? "none"}</dd>
        <dt className="text-dim">adapter public key</dt>
        <dd className="truncate">{publicKey?.toBase58() ?? "none"}</dd>
      </dl>

      <p className="text-sm text-dim">
        If PRIVY VISIBLE TO ADAPTER says YES, the plan holds and nothing else in the app has to change. If it says NO
        after signing in, the wallet needs registering by hand and the job is bigger.
      </p>
    </div>
  );
}
