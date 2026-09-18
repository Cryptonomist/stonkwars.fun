/* A line at the top saying which of the two sites you are on, and where the
 * other half of the product lives.
 *
 * Both deployments are the same code with one environment variable different,
 * so without this a visitor has no way to tell that the fights they cannot find
 * on mainnet are running fine one link away, or that the trading they cannot do
 * on devnet is. It renders nothing at all when a deployment has no sibling
 * configured, which is the state every preview build is in. */

import Link from "next/link";

import { siblingSite } from "@/lib/deployment";

export function NetworkStrip() {
  const other = siblingSite();
  if (!other) return null;
  return (
    <div className="border-b border-line bg-panel-2">
      <p className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-meta text-dim">
        <span>{other.here}</span>
        <Link href={other.href} className="link shrink-0">
          {other.what} &rarr;
        </Link>
      </p>
    </div>
  );
}
