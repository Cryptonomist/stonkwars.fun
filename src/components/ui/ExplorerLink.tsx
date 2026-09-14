"use client";

import { shortAddress } from "@/lib/format";
import { explorerAddress, explorerTx } from "@/lib/hooks";
import { CLUSTER } from "@/lib/stocks";

import { cx } from "./cx";

/* The way out to the proof: an address or a transaction on Solana Explorer,
 * on the cluster this build talks to. Shortened in mono with an arrow that
 * says it leaves the site; the full value is in the title and the accessible
 * name. A client component because the URL helpers live beside the hooks. */

export function ExplorerLink({
  kind,
  value,
  label,
  className,
}: {
  kind: "tx" | "address";
  value: string;
  label?: string;
  className?: string;
}) {
  const href = kind === "tx" ? explorerTx(value, CLUSTER) : explorerAddress(value, CLUSTER);
  const what = kind === "tx" ? "transaction" : "address";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={value}
      aria-label={`${label ?? shortAddress(value)}: view ${what} on Solana Explorer, opens in a new tab`}
      className={cx("link num inline-flex max-w-full min-w-0 items-baseline gap-1 whitespace-nowrap", className)}
    >
      <span className="min-w-0 truncate">{label ?? shortAddress(value)}</span>
      <span aria-hidden="true" className="shrink-0 text-dim">
        &#8599;
      </span>
    </a>
  );
}
