"use client";

/* Put a name on your wins.
 *
 * Three steps, and the middle one is the point. X says who you are, the server
 * signs a transaction saying so as the oracle, and then your wallet signs the
 * same transaction. Neither signature is worth anything without the other, so
 * the server cannot name your wallet and you cannot claim a name X did not
 * give you.
 *
 * The handle lands on chain in public, permanently. The page says so before
 * anyone starts, not after.
 *
 * Handles are ink and the buttons are neutral: a handle belongs to a person,
 * who is cyan in one fight and pink in the next, and linking X is not taking a
 * side. `compact` is the one-line version for a profile or under a board. */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";

import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { buildUnlinkHandle, profilePda, decodeProfile, readableProgramError } from "@/lib/duel";
import { useProfiles } from "@/lib/hooks";
import { sendAndConfirm } from "@/lib/send";

/* Reading the query string opts a page out of being rendered ahead of time,
 * and Next wants that boundary drawn explicitly. The leaderboard around it
 * stays static; only this panel waits for the browser. */
export function ConnectX({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Suspense
      fallback={
        <div className={cx("card flex items-center gap-3 px-4", compact ? "h-14" : "h-24", className)} aria-busy="true">
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="ml-auto h-8 w-24 shrink-0" />
        </div>
      }
    >
      <ConnectPanel compact={compact} className={className} />
    </Suspense>
  );
}

function ConnectPanel({ compact, className }: { compact: boolean; className?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const profiles = useProfiles();
  const qc = useQueryClient();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const me = publicKey?.toBase58();
  const mine = me ? profiles.data?.[me] : undefined;
  const waiting = params.get("x") === "sign" ? params.get("handle") : null;
  const failed = params.get("x") === "error" ? params.get("message") : null;

  // Once it is on chain the query string has done its job.
  const clear = useCallback(() => router.replace("/leaderboard"), [router]);

  useEffect(() => {
    if (failed) setError(failed);
  }, [failed]);

  async function sign() {
    if (!publicKey || !signTransaction) {
      setError("Connect a wallet first, then sign.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/x/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });
      const body = (await res.json()) as { transaction?: string; handle?: string; error?: string };
      if (!res.ok || !body.transaction) throw new Error(body.error ?? "Could not prepare the link");

      /* The oracle has signed this already; adding the wallet's signature is
       * the whole of what the browser does. */
      const tx = Transaction.from(Buffer.from(body.transaction, "base64"));
      const signed = await signTransaction(tx);
      const latest = await connection.getLatestBlockhash("confirmed");
      await sendAndConfirm(connection, signed, latest);
      await qc.invalidateQueries({ queryKey: ["profiles"] });
      setDone(body.handle ?? null);
      toast.push({
        title: body.handle ? `Linked. @${body.handle} is on the board.` : "Linked.",
        check: true,
        href: me ? `/u/${me}` : undefined,
        hrefLabel: me ? "Your profile" : undefined,
      });
      clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link that account");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!publicKey || !signTransaction) return;
    setBusy(true);
    setError(null);
    try {
      const info = await connection.getAccountInfo(profilePda(publicKey), "confirmed");
      if (!info) throw new Error("Nothing linked to this wallet");
      const { xId } = decodeProfile(info.data);
      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, ...latest }).add(buildUnlinkHandle(publicKey, xId));
      await sendAndConfirm(connection, await signTransaction(tx), latest);
      await qc.invalidateQueries({ queryKey: ["profiles"] });
      setDone(null);
      toast.push({ title: "Unlinked. Your wallet address shows again.", check: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlink");
    } finally {
      setBusy(false);
    }
  }

  const handle = (h: string) => (
    <a href={`https://x.com/${h}`} target="_blank" rel="noreferrer" className="link font-semibold">
      @{h}
    </a>
  );

  /* The wallet's own words ("User rejected the request") become the site's
   * ("You cancelled in your wallet."), and nothing longer than a sentence. */
  const feedback = (
    <>
      {done && !compact ? (
        <Notice tone="info" title={`Linked. @${done} is on the board.`} className="mt-3">
          Your handle now shows beside your record instead of your wallet address.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" title="The X link did not go through." className="mt-3">
          {readableProgramError(error)}
        </Notice>
      ) : null}
    </>
  );

  if (compact) {
    return (
      <section className={cx("card px-4 py-3", className)} aria-label="X handle">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          {mine ? (
            <>
              <span className="label">Fighting as</span>
              <span className="min-w-0 truncate text-sm">{handle(mine)}</span>
              <button type="button" onClick={unlink} disabled={busy} className="btn btn-sm btn-ghost ml-auto">
                {busy ? "Signing..." : "Unlink"}
              </button>
            </>
          ) : waiting ? (
            <>
              <p className="min-w-0 text-sm text-ink">
                X says you are <span className="font-semibold">@{waiting}</span>. Sign to put it on chain.
              </p>
              <div className="ml-auto flex shrink-0 gap-2">
                <button type="button" onClick={clear} disabled={busy} className="btn btn-sm btn-ghost">
                  Not now
                </button>
                <button type="button" onClick={sign} disabled={busy} className="btn btn-sm btn-light">
                  {busy ? "Signing..." : "Sign"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="min-w-0 flex-1 text-sm text-dim">
                Show your X handle instead of a wallet address. It is public and permanent on chain.{" "}
                <Link href="/privacy" className="link">
                  Privacy
                </Link>
              </p>
              <a href="/api/x/start" className="btn btn-sm btn-light ml-auto shrink-0">
                Connect X
              </a>
            </>
          )}
        </div>
        {feedback}
      </section>
    );
  }

  return (
    <section className={cx("card p-4", className)} aria-label="X handle">
      {mine ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="label">Fighting as</span>
          <span className="min-w-0 truncate text-num-lg">{handle(mine)}</span>
          <button type="button" onClick={unlink} disabled={busy} className="btn btn-sm btn-ghost ml-auto">
            {busy ? "Signing..." : "Unlink"}
          </button>
        </div>
      ) : waiting ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">
            X says you are <span className="font-semibold">@{waiting}</span>. Sign to put it beside your record.
          </p>
          <p className="text-meta text-dim">
            Your wallet signs, and the oracle has already signed to say X vouched for the handle. It takes both.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={sign} disabled={busy} className="btn btn-sm btn-light">
              {busy ? "Signing..." : `Put @${waiting} on chain`}
            </button>
            <button type="button" onClick={clear} disabled={busy} className="btn btn-sm btn-ghost">
              Not now
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="h-section">Fight under your own name</p>
            <p className="mt-2 text-sm text-dim">
              Connect X to show your handle here instead of a wallet address. It is written on chain in public and
              stays in the chain&apos;s history for good, so read the{" "}
              <Link href="/privacy" className="link">
                privacy note
              </Link>{" "}
              first. We never post, and we keep no token.
            </p>
          </div>
          <a href="/api/x/start" className="btn btn-sm btn-light shrink-0">
            Connect X
          </a>
        </div>
      )}
      {feedback}
    </section>
  );
}
