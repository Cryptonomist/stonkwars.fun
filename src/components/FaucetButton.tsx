"use client";

/* Devnet only: test shares and a little SOL, so a judge with an empty wallet
 * can play in under a minute. The server holds the test mints' authority.
 *
 * The result arrives as a toast rather than a card pinned under the button:
 * the button lives in the nav, in the wallet menu and beside a fight's take
 * button, and a card positioned under any of those is clipped, covered, or
 * gone the moment the menu closes. Neither outcome is green or red. Green
 * means a price went up and red that one went down; a faucet did neither. */

import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";

import { requestConnect } from "@/components/ui/intents";
import { toast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";

/** Ask the faucet for test shares. `busy` while the request is out. */
export function useFaucet(tickers?: string[]) {
  const { publicKey } = useWallet();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const key = tickers?.join(",");

  const drip = useCallback(async () => {
    if (!publicKey) {
      toast.push({ title: "Connect a wallet first.", body: "Test shares go to the connected wallet." });
      requestConnect();
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58(), tickers: key ? key.split(",") : undefined }),
      });
      const body = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      if (!r.ok) {
        /* The route's refusals (wrong cluster, a bad request, too soon, not
         * set up) are written for people. A 502 carries whatever the RPC
         * threw, which is not, so that one gets words of its own. */
        const said = r.status === 502 ? undefined : body.error;
        toast.push({ title: said ?? "The faucet could not send just now. Try again in a minute." });
        return;
      }
      toast.push({ title: body.message ?? "Test shares sent.", check: true });
      void qc.invalidateQueries();
    } catch {
      toast.push({ title: "Could not reach the faucet. Try again in a minute." });
    } finally {
      setBusy(false);
    }
  }, [publicKey, key, qc]);

  return { drip, busy };
}

export function FaucetButton({
  className = "",
  compact = false,
  primary = false,
  light = false,
  tickers,
  label,
}: {
  className?: string;
  compact?: boolean;
  /** The next step on the page: a full-size light button instead of a small ghost one. */
  primary?: boolean;
  /** Small, but the light plate rather than the ghost: the first step on a card. */
  light?: boolean;
  /** The stocks to top up; the server's starter set when absent. */
  tickers?: string[];
  label?: string;
}) {
  const { drip, busy } = useFaucet(tickers);
  return (
    <button
      type="button"
      onClick={drip}
      disabled={busy}
      aria-busy={busy || undefined}
      className={cx("btn", primary ? "btn-light" : light ? "btn-sm btn-light" : "btn-sm btn-ghost", compact && "px-2", className)}
    >
      {busy ? "Minting..." : (label ?? (compact ? "Faucet" : "Get test shares"))}
    </button>
  );
}
