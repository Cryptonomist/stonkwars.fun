import Link from "next/link";

import { LiveBoard } from "@/components/LiveBoard";
import { SampleFight } from "@/components/SampleFight";
import { BRAND } from "@/lib/brand";
import { ROSTER } from "@/lib/stocks";

const STEPS = [
  {
    n: "01",
    title: "Call it",
    body: `Pick your stock from all ${ROSTER.length} tokenized on Solana, and the one it beats. Stake real shares of yours, set the round: five minutes, an hour, or to Friday's bell.`,
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
    body: "Each boundary has exactly one price: Pyth's first update at or after it (every update records the time of the one before), or the close of the stock's first one-minute bar at or after it. The program takes that one and refuses the rest.",
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
      <section className="grid items-center gap-10 py-14 lg:grid-cols-[1.1fr_1fr] lg:py-20">
        <div>
          <p className="label">{ROSTER.length} tokenized stocks · on Solana</p>
          <h1 className="display mt-4 text-7xl sm:text-8xl lg:text-9xl">
            Win, and you
            <br />
            own their stock.
          </h1>
          <p className="display mt-3 text-5xl text-cooked sm:text-6xl">Loser gets cooked.</p>
          <p className="mt-6 max-w-xl text-lg text-dim">{BRAND.pitch}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/new" className="btn btn-p1 px-8 text-xl">
              Pick a fight
            </Link>
            <Link href="/fights" className="btn btn-ghost px-8 text-xl">
              Watch the fights
            </Link>
          </div>
        </div>
        <SampleFight />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="card p-6">
            <span className="display text-5xl text-p2">{s.n}</span>
            <h2 className="display mt-3 text-4xl">{s.title}</h2>
            <p className="mt-2 text-dim">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-16">
        <div className="flex items-end justify-between">
          <h2 className="display text-5xl">In the ring</h2>
          <Link href="/fights" className="label hover:text-ink">
            All fights
          </Link>
        </div>
        <div className="mt-4">
          <LiveBoard limit={6} />
        </div>
      </section>

      <section className="mt-20">
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
