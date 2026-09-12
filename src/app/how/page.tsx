import type { Metadata } from "next";
import Link from "next/link";

import { AROUND_THE_CLOCK, ROSTER } from "@/lib/stocks";

export const metadata: Metadata = { title: "How it works" };

const PYTH = ROSTER.filter((s) => s.source === "pyth").map((s) => s.ticker);

const RULES: { q: string; a: React.ReactNode }[] = [
  {
    q: "What am I actually staking?",
    a: "Tokenized shares of the stock you back. On mainnet that means an issuer's tokenized stock, such as an xStock; on devnet, test tokens that stand in for them, which the faucet hands out. The winner receives both stakes as shares, not as cash.",
  },
  {
    q: "Which stocks?",
    a: `Every tokenized stock and ETF on Solana: ${ROSTER.length} today, from Apple to Hong Kong listings. Lookalike tokens that borrow a real one's name are left out; only the issuer's own mints can be staked.`,
  },
  {
    q: "How is the winner decided?",
    a: "By percentage move. Each stock's end price is divided by its start price, and the larger ratio wins. The program compares the two by cross-multiplying the integer prices, so there is no rounding anywhere in the decision. A $900 stock that rises $18 (+2%) loses to a $100 stock that rises $3 (+3%).",
  },
  {
    q: "Which prices?",
    a: `For every boundary, exactly one per stock, from one of two sources. ${PYTH.join(" and ")} are priced by Pyth: the first Pyth update published at or after the boundary. Each update carries the publish time of the one before it, so the program demands previous < boundary <= this one, and only one update in existence satisfies that (the same rule as Pyth's own parsePriceFeedUpdatesUnique). Every other stock is priced by the Stonk Wars oracle: the close of its first one-minute bar at or after the boundary, signed by the oracle key and checked on chain by Solana's Ed25519 program. That is a fact about the past, so there is one answer and nothing to shop for.`,
  },
  {
    q: "Can I fight at three in the morning?",
    a: `Yes, on ${AROUND_THE_CLOCK.toLocaleString()} of them. A US stock's own market runs from 4am to 8pm New York time and the oracle reads it the whole way, pre-market and after-hours included. Outside even that, and at weekends, the price comes from the token itself, which never stops trading on Solana: the median of the last fifteen one-minute closes on its pinned pool, as of the boundary. That is the point of a share being on a chain, and it is why a fight does not have to wait for a bell.`,
  },
  {
    q: "Is a pool not easy to push?",
    a: "One minute of it would be. Off-hours a pool can trade thirty dollars in a minute, and a single swap would set that minute's close, so the oracle never reads one minute: it takes the median of fifteen. A median cannot be moved by one trade. Pushing it means holding the price away from fair value across eight separate minutes while every arbitrageur on Solana trades against you, which costs far more than any stake in this game is worth. On top of that, only stocks whose deepest pool clears a liquidity and volume floor are priced this way at all; the rest simply keep exchange hours.",
  },
  {
    q: "Why not Pyth for everything?",
    a: "This deployment's Pyth plan covers only a couple of equity feeds. Rather than lock out the rest of the market, the program takes a second source for the others and says so on every fight. When a stock gets a Pyth feed, one admin call switches it for new fights; fights already running keep the source they started with.",
  },
  {
    q: "Why not the token's price all the time?",
    a: "Because while the stock's own market is open it is the better number by a distance: far deeper, far harder to move, and the thing the token is a claim on. The pool is the answer to a shut exchange, not a replacement for an open one.",
  },
  {
    q: "When does a round start?",
    a: "At each stock's first price at least two seconds after the fight is taken, which is a price that did not exist when the taker signed. The two seconds cover the gap between the cluster's clock and wall time.",
  },
  {
    q: "Who settles it?",
    a: "Anyone. Our settler posts the prices within a minute of the bell, but any wallet can do the same from the fight page, and the result is identical whoever does it. Pyth prices need no key at all; the oracle's quotes are handed to anyone who asks, already signed.",
  },
  {
    q: "What if the market is closed?",
    a: "For a stock priced by its pool, nothing changes: the fight runs and settles on schedule. For the rest, and for listings outside the US, a fight taken while their market is shut starts at the first price when trading resumes. If that is more than five days away, or it lands inside the last minute of a fixed-end round, the fight is void and both stakes go home.",
  },
  {
    q: "What if nobody takes my fight?",
    a: "Call it off any time before someone accepts and your stake comes straight back. Once the challenge expires, anyone can send it home for you.",
  },
  {
    q: "What if it ties, or breaks?",
    a: "An exact tie refunds each side its own stake. A fight whose price never arrives (a halted feed, a delisting) can be refunded by anyone a week after it should have moved.",
  },
  {
    q: "Can anyone take the stakes?",
    a: "No. Stakes sit in token accounts owned by the fight's own address. The program has exactly three ways to move them: back to the challenger before the fight starts, to the winner, or home to both. There is no admin withdrawal. The admin can register stocks, pause new fights and name the oracle for new fights, and cannot touch a stake. A fight whose prices never come is refunded in full.",
  },
  {
    q: "Is this real money?",
    a: "The live demo runs on Solana devnet with test shares and real market prices. Tokenized stocks are generally offered only to non-US persons; know the rules where you live.",
  },
];

export default function HowPage() {
  return (
    <div className="mx-auto max-w-3xl py-10">
      <p className="label">The rules</p>
      <h1 className="display mt-2 text-6xl sm:text-7xl">How it works</h1>
      <dl className="mt-10 flex flex-col gap-8">
        {RULES.map((r) => (
          <div key={r.q}>
            <dt className="display text-3xl">{r.q}</dt>
            <dd className="mt-2 text-lg text-dim">{r.a}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-12">
        <Link href="/new" className="btn btn-p1 px-8 text-xl">
          Pick a fight
        </Link>
      </div>
    </div>
  );
}
