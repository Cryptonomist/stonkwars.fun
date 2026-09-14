"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { readableProgramError } from "@/lib/duel";
import { explorerTx } from "@/lib/hooks";
import { CLUSTER } from "@/lib/stocks";

import { cx } from "./cx";
import { ExplorerLink } from "./ExplorerLink";
import { Notice } from "./Notice";
import { toast } from "./Toast";

/* A button that sends a transaction and tells the truth about it.
 *
 *   idle        the label
 *   signing     waiting on the wallet, until the transaction is sent
 *   confirming  sent: the signature exists, so it is linked right away, and a
 *               phone that wanders off to its wallet app can check it later
 *   done        confirmed; a toast says so, then the button rests again
 *   error       the program's own sentence, not a hex code or a stack
 *
 * `run` receives `onSent` and must call it with the signature the moment the
 * transaction is sent (useSend takes it as its second argument). "Confirmed in
 * 1.4s" is measured from that call to `run` resolving, so it is the real time
 * the chain took. If `onSent` is never called there is no honest number, and
 * the toast leaves it out rather than inventing one. */

type Phase = "idle" | "signing" | "confirming" | "done" | "error";

const DONE_MS = 2_500;

export function TxButton({
  run,
  label,
  successTitle,
  className,
  containerClassName,
  disabled,
}: {
  run: (onSent: (sig: string) => void) => Promise<string | string[] | void>;
  label: ReactNode;
  successTitle: string;
  className?: string;
  containerClassName?: string;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sig, setSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rest = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (rest.current) clearTimeout(rest.current);
    };
  }, []);

  const pending = phase === "signing" || phase === "confirming";

  const go = async () => {
    if (pending) return;
    if (rest.current) clearTimeout(rest.current);
    setPhase("signing");
    setSig(null);
    setError(null);

    let sentAt: number | null = null;
    let lastSig: string | null = null;
    const onSent = (s: string) => {
      sentAt = performance.now();
      lastSig = s;
      if (!alive.current) return;
      setSig(s);
      setPhase("confirming");
    };

    try {
      const result = await run(onSent);
      const sigs = Array.isArray(result) ? result : result ? [result] : [];
      const final = sigs[sigs.length - 1] ?? lastSig;
      const took = sentAt === null ? null : (performance.now() - sentAt) / 1000;
      toast.push({
        title: successTitle,
        check: true,
        body: took === null ? undefined : `Confirmed in ${took.toFixed(1)}s`,
        href: final ? explorerTx(final, CLUSTER) : undefined,
        hrefLabel: final ? "View on explorer" : undefined,
      });
      if (!alive.current) return;
      setPhase("done");
      rest.current = setTimeout(() => {
        if (alive.current) setPhase("idle");
      }, DONE_MS);
    } catch (e) {
      if (!alive.current) return;
      setError(readableProgramError(e));
      setPhase("error");
    }
  };

  const face =
    phase === "signing" ? (
      "Approve in your wallet"
    ) : phase === "confirming" ? (
      "Confirming..."
    ) : phase === "done" ? (
      <>
        <span aria-hidden="true">&#10003;</span> Done
      </>
    ) : (
      label
    );

  return (
    <div className={cx("flex min-w-0 flex-col gap-2", containerClassName)}>
      <button
        type="button"
        onClick={go}
        disabled={disabled || pending}
        aria-busy={pending}
        className={cx("btn", className)}
      >
        {face}
      </button>
      {phase === "confirming" && sig ? (
        <p className="text-meta text-dim">
          Sent. <ExplorerLink kind="tx" value={sig} />
        </p>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {phase === "signing" ? "Waiting for your wallet" : phase === "confirming" ? "Sent, confirming" : ""}
      </span>
      {phase === "error" && error ? (
        <Notice tone="error" title="That did not go through.">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
