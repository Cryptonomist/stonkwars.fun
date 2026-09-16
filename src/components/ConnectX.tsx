"use client";

/* Put a name, and a face, on your wins.
 *
 * Three steps, and the middle one is the point. X says who you are, the server
 * signs a transaction saying so as the oracle, and then your wallet signs the
 * same transaction. Neither signature is worth anything without the other, so
 * the server cannot name your wallet and you cannot claim a name X did not
 * give you. The picture X names for the account rides in the same transaction.
 *
 * Signing in can start anywhere: the Connect sheet, a board, a profile. X sends
 * the browser back to the page it left, and XLinkSheet (mounted once, in the
 * layout) asks for the wallet's signature there, picking a wallet first if
 * none is connected.
 *
 * The handle lands on chain in public, permanently. The page says so before
 * anyone starts, not after.
 *
 * Handles are ink and the buttons are neutral: a handle belongs to a person,
 * who is cyan in one fight and pink in the next, and linking X is not taking a
 * side. `compact` is the one-line version for a profile or under a board. */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";

import { XLogo } from "@/components/ui/BrandIcons";
import { cx } from "@/components/ui/cx";
import { requestConnect } from "@/components/ui/intents";
import { Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { buildUnlinkHandle, decodeProfile, isHandle, profilePda, readableProgramError } from "@/lib/duel";
import { useProfiles } from "@/lib/hooks";
import { sendAndConfirm } from "@/lib/send";
import { CLUSTER } from "@/lib/stocks";

/** Where "Connect X" goes, coming back to `path` afterwards. */
export const xStartHref = (path: string) => `/api/x/start?next=${encodeURIComponent(path)}`;

/* A brand-new guest wallet on devnet has no SOL, and linking pays a fee and the
 * rent on two small accounts. The faucet tops it up first, so the one button
 * still does the whole thing. */
const LINK_SOL_FLOOR = 0.01 * LAMPORTS_PER_SOL;

/** Sign the link: fetch the oracle-signed transaction, add the wallet's signature, send. */
export function useLinkX() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sign = useCallback(async (): Promise<boolean> => {
    if (!publicKey || !signTransaction) {
      setError("Connect a wallet first, then sign.");
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      if (CLUSTER !== "mainnet-beta" && (await connection.getBalance(publicKey, "confirmed")) < LINK_SOL_FLOOR) {
        await fetch("/api/faucet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: publicKey.toBase58() }),
        }).catch(() => undefined);
        for (let i = 0; i < 20 && (await connection.getBalance(publicKey, "confirmed")) < LINK_SOL_FLOOR; i++) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

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
      const me = publicKey.toBase58();
      toast.push({
        title: body.handle ? `Linked. @${body.handle} is on the board.` : "Linked.",
        check: true,
        href: `/u/${me}`,
        hrefLabel: "Your profile",
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link that account");
      return false;
    } finally {
      setBusy(false);
    }
  }, [connection, publicKey, signTransaction, qc]);

  return { sign, busy, error };
}

/* ─── The sheet that finishes a sign-in, on whatever page X returned to ───── */

export function XLinkSheet() {
  return (
    <Suspense fallback={null}>
      <XLinkSheetInner />
    </Suspense>
  );
}

function XLinkSheetInner() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { connected, connecting } = useWallet();
  const { sign, busy, error } = useLinkX();
  const [choosing, setChoosing] = useState(false);

  const waiting = params.get("x") === "sign" ? params.get("handle") : null;
  const failed = params.get("x") === "error" ? params.get("message") : null;

  // Once it is on chain, or abandoned, the query string has done its job.
  const clear = useCallback(() => {
    const rest = new URLSearchParams(params.toString());
    for (const key of ["x", "handle", "message"]) rest.delete(key);
    const q = rest.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  useEffect(() => {
    if (!failed) return;
    toast.push({ title: "X sign-in did not finish.", body: failed.slice(0, 160) });
    clear();
  }, [failed, clear]);

  /* Choosing a wallet opens the Connect sheet, so this one steps aside until a
   * wallet connects, or for a short while if the picker is closed without one. */
  useEffect(() => {
    if (!choosing) return;
    if (connected) {
      setChoosing(false);
      return;
    }
    if (connecting) return;
    const id = setTimeout(() => setChoosing(false), 15_000);
    return () => clearTimeout(id);
  }, [choosing, connected, connecting]);

  if (!waiting || !isHandle(waiting)) return null;

  return (
    <Sheet open={!choosing} onClose={clear} title={`Fight as @${waiting}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink">
          X says you are <span className="font-semibold">@{waiting}</span>.{" "}
          {connected
            ? "Sign with your wallet to show your handle and X picture beside your record."
            : "Pick the wallet that fights as you, then sign."}
        </p>
        <p className="text-meta text-dim">
          It is written on chain in public and stays in the chain&apos;s history. The oracle has signed to say X vouched
          for the handle; it takes your wallet&apos;s signature too. We never post, and we keep no token.{" "}
          <Link href="/privacy" className="link">
            Privacy
          </Link>
        </p>
        {error ? (
          <Notice tone="error" title="The X link did not go through.">
            {readableProgramError(error)}
          </Notice>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <button
              type="button"
              onClick={async () => {
                if (await sign()) clear();
              }}
              disabled={busy}
              className="btn btn-sm btn-light"
            >
              {busy ? "Signing..." : `Put @${waiting} on chain`}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setChoosing(true);
                requestConnect();
              }}
              className="btn btn-sm btn-light"
            >
              Choose a wallet
            </button>
          )}
          <button type="button" onClick={clear} disabled={busy} className="btn btn-sm btn-ghost">
            Not now
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ─── The panel on a board or a profile ──────────────────────────────────── */

export function ConnectX({ compact = false, className }: { compact?: boolean; className?: string }) {
  const pathname = usePathname();
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const profiles = useProfiles();
  const qc = useQueryClient();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = publicKey?.toBase58();
  const mine = me ? profiles.data?.[me] : undefined;
  const start = xStartHref(pathname || "/leaderboard");

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
   * ("You canceled in your wallet."), and nothing longer than a sentence. */
  const feedback = error ? (
    <Notice tone="error" title="That did not go through." className="mt-3">
      {readableProgramError(error)}
    </Notice>
  ) : null;

  const connectButton = (
    <a href={start} className="btn btn-sm btn-light ml-auto inline-flex shrink-0 items-center gap-2">
      <XLogo size={13} />
      Connect X
    </a>
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
          ) : (
            <>
              <p className="min-w-0 flex-1 text-sm text-dim">
                Show your X handle and picture instead of a wallet address. It is public and permanent on chain.{" "}
                <Link href="/privacy" className="link">
                  Privacy
                </Link>
              </p>
              {connectButton}
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
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="h-section">Fight under your own name</p>
            <p className="mt-2 text-sm text-dim">
              Connect X to show your handle and picture here instead of a wallet address. It is written on chain in public
              and stays in the chain&apos;s history for good, so read the{" "}
              <Link href="/privacy" className="link">
                privacy note
              </Link>{" "}
              first. We never post, and we keep no token.
            </p>
          </div>
          {connectButton}
        </div>
      )}
      {feedback}
    </section>
  );
}
