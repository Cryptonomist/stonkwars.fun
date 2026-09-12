import Link from "next/link";

import { Mark } from "@/components/Logo";
import { PROGRAM_ID } from "@/lib/duel";
import { CLUSTER } from "@/lib/stocks";

export function SiteFooter() {
  const explorer = `https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}${
    CLUSTER === "devnet" ? "?cluster=devnet" : ""
  }`;
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-dim sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Mark size={20} />
          <span>
            Prices by <a className="text-ink underline decoration-line underline-offset-4" href="https://pyth.network" target="_blank" rel="noreferrer">Pyth</a>{" "}
            and the <Link href="/how" className="text-ink underline decoration-line underline-offset-4">Stonk Wars oracle</Link>.
            Settled on Solana. No one holds the stakes but the program.
          </span>
        </div>
        <div className="flex flex-wrap gap-4 sm:ml-auto">
          <Link href="/how" className="hover:text-ink">How it works</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <a href={explorer} target="_blank" rel="noreferrer" className="hover:text-ink">
            Program
          </a>
          <span className="label self-center">{CLUSTER}</span>
        </div>
      </div>
    </footer>
  );
}
