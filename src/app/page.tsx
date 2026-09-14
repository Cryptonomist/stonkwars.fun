import Link from "next/link";

import { LiveBoard } from "@/components/LiveBoard";
import { Movers } from "@/components/Movers";
import { SiteTally } from "@/components/SiteTally";
import { TickerTape } from "@/components/TickerTape";
import { TopFighters } from "@/components/TopFighters";
import { AROUND_THE_CLOCK, CLUSTER, ROSTER } from "@/lib/stocks";

/* THE FRONT PAGE IS A BOARD, NOT A PITCH.
 *
 * Everyone this is for has seen a hundred landing pages and reads none of
 * them. What they read is numbers: what is moving, who is fighting, who is
 * winning, what it paid. So the page opens on the tape and the board, says
 * what the game is in one line rather than one billboard, and keeps the
 * explaining for the people who scroll far enough to want it. */

const STEPS = [
  {
    n: "01",
    title: "Call it",
    body: `Pick your stock from all ${ROSTER.length.toLocaleString("en-US")} tokenized on Solana, and the one it beats. Stake shares of yours, set the round: five minutes, an hour, or to Friday's bell.`,
  },
  {
    n: "02",
    title: "They answer",
    body: "Send the link. Whoever takes it stakes the same dollar value of the other stock. No odds, no house, no order book.",
  },
  {
    n: "03",
    title: "The bell decides",
    body: "Signed prices at the start and at the bell. The bigger percentage move takes both stakes: your shares back, plus theirs. The other side is cooked.",
  },
];

const TRUST = [
  {
    title: "Signed prices",
    body: "Pyth-priced stocks settle on Pyth updates, checked against Wormhole guardian signatures on Solana. Every other stock settles on the oracle's signed quote, checked by Solana's Ed25519 program in the same transaction.",
  },
  {
    title: "One price counts",
    body: "Each boundary has exactly one price: Pyth's first update at or after it, or the close of the stock's first one-minute bar at or after it. Once the exchange shuts, the same rule reads whichever market is still open, which for most of them is the stock's perpetual future. For the few with only a Solana pool it is the token's last fifteen minutes there, extremes discarded and the rest averaged. The program takes that one and refuses the rest.",
  },
  {
    title: "Anyone can settle",
    body: "No admin, no judge. Any wallet can post the prices and settle, and the result is identical whoever does it. Every quote is public in the transaction that used it.",
  },
  {
    title: "Stakes go to players",
    body: "Shares sit in escrow owned by the fight itself. They can leave three ways: back to the challenger, to the winner, or home to both. Nowhere else.",
  },
];

export default function Home() {
  return (
    <div>
      {/* Out past the page's column, edge to edge, the way a tape should run. */}
      <div className="relative left-1/2 w-screen -translate-x-1/2 overflow-x-clip">
        <TickerTape />
      </div>

      <section className="flex flex-wrap items-baseline gap-x-6 gap-y-3 py-6">
        <h1 className="display text-3xl sm:text-4xl">
          Your stock vs theirs. <span className="text-cooked">Winner takes both.</span>
        </h1>
        <p className="max-w-xl text-sm text-dim">
          Stake tokenized shares against somebody else&apos;s. The bigger percentage move by the bell takes every share on
          the table, paid in stock. {AROUND_THE_CLOCK > 0 ? `${AROUND_THE_CLOCK} of them fight around the clock.` : ""}
        </p>
        <Link href="/new" className="btn btn-p1 ml-auto px-7 text-lg">
          Pick a fight
        </Link>
        {/* Said where the stake is first mentioned, so nobody reads the hero as
          * asking for their money. */}
        {CLUSTER !== "mainnet-beta" ? (
          <p className="w-full text-sm text-dim">
            Live on Solana devnet: real market prices, free test shares, nothing real at stake.
          </p>
        ) : null}
      </section>

      <SiteTally />

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="flex items-end justify-between">
            <h2 className="display text-3xl">In the ring</h2>
            <Link href="/fights" className="label hover:text-ink">
              All fights
            </Link>
          </div>
          <div className="mt-3">
            <LiveBoard limit={8} columns={1} />
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <div className="flex items-end justify-between">
              <h2 className="display text-3xl">Moving today</h2>
              <Link href="/new" className="label hover:text-ink">
                Pick one
              </Link>
            </div>
            <div className="card mt-3 px-4 py-2">
              <Movers rows={8} />
            </div>
          </div>

          <div>
            <h2 className="display text-3xl">Who cooks</h2>
            <div className="card mt-3 px-4 py-2">
              <TopFighters rows={7} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-16 grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="card p-6">
            <span className="display text-5xl text-p2">{s.n}</span>
            <h2 className="display mt-3 text-4xl">{s.title}</h2>
            <p className="mt-2 text-dim">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-16">
        <p className="label">Why nobody can rig it</p>
        <h2 className="display mt-2 text-5xl sm:text-6xl">No ref. Just the bell.</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {TRUST.map((t) => (
            <div key={t.title} className="card p-6">
              <h3 className="display text-3xl text-p1">{t.title}</h3>
              <p className="mt-2 text-dim">{t.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-dim">
          The details, and the edge cases, are on{" "}
          <Link href="/how" className="text-ink underline decoration-line underline-offset-4">
            how it works
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
