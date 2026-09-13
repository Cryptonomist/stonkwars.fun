"use client";

/* A SPIKE, NOT A FEATURE. Delete this page once the question is answered.
 *
 * The whole embedded-wallet plan rests on one claim nobody has tested: that a
 * Privy wallet announces itself the way a browser extension does, so the
 * wallet-adapter this app already uses picks it up and nothing else has to
 * change. This page asks that question and nothing else. Sign in, and it shows
 * whether `useWallet()` can see the result. */

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets as usePrivySolanaWallets } from "@privy-io/react-auth/solana";

import { PRIVY_APP_ID } from "@/components/PrivySignIn";

/* usePrivy() throws outright when no provider is above it, and without an app
 * id there is no provider. That is not a runtime problem, it is a build one:
 * this page is prerendered, so on any deployment missing the variable the
 * throw happens during `next build` and takes the whole deploy down with it.
 * Hence the two components. The hooks live below the check, never beside it. */
export default function PrivyCheck() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!PRIVY_APP_ID) {
    return <p className="py-10 text-dim">NEXT_PUBLIC_PRIVY_APP_ID is not set on this deployment.</p>;
  }
  if (!mounted) return <p className="py-10 text-dim">Loading...</p>;
  return <Report />;
}

function Report() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets: privyWallets } = usePrivySolanaWallets();
  const { wallets, wallet, publicKey, connected } = useWallet();

  const seenByAdapter = wallets.map((w) => w.adapter.name);
  const privyVisible = seenByAdapter.some((n) => /privy/i.test(n));

  return (
    <div className="flex flex-col gap-6 py-10">
      <div className="max-w-2xl">
        <p className="label">Spike</p>
        <h1 className="display mt-2 text-5xl">Can the app use a Privy wallet?</h1>
        <p className="mt-3 text-dim">
          Eight files in this app ask a wallet to sign things, and all of them read one list. Phantom, Solflare and
          Backpack put themselves on that list by announcing to the page. The question is whether the wallet Privy
          makes for someone who signed in with an email does the same.
        </p>
        <p className="mt-2 text-dim">
          <strong className="text-ink">Sign in below, then read the green or red line.</strong> Green means every
          existing signing path works for a Privy wallet with no new code. Red means each one needs a second path
          written for it by hand.
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

      {/* The answer, in a sentence, before any of the detail behind it. */}
      <div
        className={`card border-2 p-5 ${
          !authenticated ? "border-line" : privyVisible ? "border-up text-up" : "border-down text-down"
        }`}
      >
        <p className="display text-3xl">
          {!authenticated
            ? "Not signed in yet"
            : privyVisible
              ? "Yes. The app can use it."
              : "No. The app cannot see it."}
        </p>
        <p className="mt-2 text-sm text-dim">
          {!authenticated
            ? "Sign in above and this line will answer the question."
            : privyVisible
              ? "Privy announced its wallet the way an extension does, so every place that already signs with Phantom will sign with this too. Nothing else has to change."
              : "Privy made a wallet, but it is not on the list the app reads. Each signing path would need a second version written for it."}
        </p>
      </div>

      <dl className="card grid grid-cols-[16rem_1fr] gap-x-4 gap-y-2 p-5 font-mono text-sm">
        <dt className="label col-span-2 text-dim">Who you are</dt>
        <dt className="text-dim">signed in</dt>
        <dd>{ready ? String(authenticated) : "still loading"}</dd>
        <dt className="text-dim">signed in as</dt>
        <dd className="truncate">{user?.google?.email ?? user?.twitter?.username ?? user?.email?.address ?? "nobody"}</dd>

        <dt className="label col-span-2 mt-4 text-dim">Wallets Privy knows about</dt>
        <dd className="col-span-2 truncate">
          {privyWallets.map((w: { address: string }) => w.address).join(", ") || "none yet"}
        </dd>

        <dt className="label col-span-2 mt-4 text-dim">Wallets the app can see</dt>
        <dd className="col-span-2 truncate">{seenByAdapter.join(", ") || "none"}</dd>
        <dt className={privyVisible ? "text-up" : "text-down"}>is Privy among them?</dt>
        <dd className={privyVisible ? "text-up" : "text-down"}>{privyVisible ? "yes" : "no"}</dd>

        <dt className="label col-span-2 mt-4 text-dim">Which one the app is using</dt>
        <dt className="text-dim">connected</dt>
        <dd>{String(connected)}</dd>
        <dt className="text-dim">wallet</dt>
        <dd>{wallet?.adapter.name ?? "none"}</dd>
        <dt className="text-dim">address</dt>
        <dd className="truncate">{publicKey?.toBase58() ?? "none"}</dd>
      </dl>

      <p className="max-w-2xl text-sm text-dim">
        Worth trying both ways in: sign in with an email, which makes a wallet from nothing, and separately connect
        Phantom through Privy rather than through the site&rsquo;s own Connect button. If the address under{" "}
        <em>wallets Privy knows about</em> matches the one under <em>which one the app is using</em>, the two routes to
        the same extension have converged and the Connect button can eventually go away.
      </p>
    </div>
  );
}
