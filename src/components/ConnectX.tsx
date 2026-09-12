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
 * anyone starts, not after. */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";

import { buildUnlinkHandle, profilePda, decodeProfile } from "@/lib/duel";
import { useProfiles } from "@/lib/hooks";
import { sendAndConfirm } from "@/lib/send";

export function ConnectX() {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlink");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mt-6 p-5">
      {mine ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="label">Fighting as</span>
          <a
            href={`https://x.com/${mine}`}
            target="_blank"
            rel="noreferrer"
            className="display text-2xl text-p1 hover:underline"
          >
            @{mine}
          </a>
          <button type="button" onClick={unlink} disabled={busy} className="btn btn-sm btn-ghost ml-auto">
            {busy ? "Signing..." : "Unlink"}
          </button>
        </div>
      ) : waiting ? (
        <div className="flex flex-col gap-3">
          <p>
            X says you are <span className="display text-2xl text-p1">@{waiting}</span>. Sign to put it beside your
            record.
          </p>
          <p className="text-sm text-dim">
            Your wallet signs, and the oracle has already signed to say X vouched for the handle. It takes both.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={sign} disabled={busy} className="btn btn-p1">
              {busy ? "Signing..." : `Put @${waiting} on chain`}
            </button>
            <button type="button" onClick={clear} disabled={busy} className="btn btn-ghost">
              Not now
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0">
            <p className="display text-2xl">Fight under your own name</p>
            <p className="mt-1 text-sm text-dim">
              Connect X to show your handle here instead of a wallet address. It is written on chain in public and
              stays in the chain&apos;s history for good, so read the{" "}
              <Link href="/privacy" className="text-ink underline decoration-line underline-offset-4">
                privacy note
              </Link>{" "}
              first. We never post, and we keep no token.
            </p>
          </div>
          <a href="/api/x/start" className="btn btn-light ml-auto shrink-0">
            Connect X
          </a>
        </div>
      )}

      {done ? <p className="mt-3 text-sm text-up">Linked. @{done} is on the board.</p> : null}
      {error ? <p className="mt-3 text-sm text-down">{error}</p> : null}
    </section>
  );
}
