import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works" };

const RULES: { q: string; a: React.ReactNode }[] = [
  {
    q: "What am I actually staking?",
    a: "Tokenized shares of the stock you back. On mainnet that means an issuer's tokenized stock, such as an xStock; on devnet, test tokens that stand in for them, which the faucet hands out. The winner receives both stakes as shares, not as cash.",
  },
  {
    q: "How is the winner decided?",
    a: "By percentage move. Each stock's end price is divided by its start price, and the larger ratio wins. The program compares the two by cross-multiplying the integer prices, so there is no rounding anywhere in the decision. A $900 stock that rises $18 (+2%) loses to a $100 stock that rises $3 (+3%).",
  },
  {
    q: "Which prices? Pyth prints several times a second.",
    a: "For every boundary, exactly one: the first Pyth price published at or after it. Each Pyth update carries the publish time of the update before it, so the program demands previous < boundary <= this one, and only one update in existence satisfies that. It is the same rule Pyth's own EVM contract enforces as parsePriceFeedUpdatesUnique. Nobody can shop for a better print.",
  },
  {
    q: "When does a round start?",
    a: "At the first Pyth price at least two seconds after the fight is taken, which is a price that did not exist when the taker signed. The two seconds cover the gap between the cluster's clock and wall time.",
  },
  {
    q: "Who settles it?",
    a: "Anyone. Our settler posts the prices within a minute of the bell, but any wallet can do the same from the fight page, and the result is identical whoever does it. No admin key and no oracle key exist in the program.",
  },
  {
    q: "What if the market is closed?",
    a: "A fight taken on a weekend starts at the first price when trading resumes. If that is more than five days away, or it lands inside the last minute of a fixed-end round, the fight is void and both stakes go home.",
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
    a: "No. Stakes sit in token accounts owned by the fight's own address. The program has exactly three ways to move them: back to the challenger before the fight starts, to the winner, or home to both. There is no admin withdrawal. The admin can register stocks and pause new fights, and cannot touch a stake.",
  },
  {
    q: "Is this real money?",
    a: "The live demo runs on Solana devnet with test shares and real Pyth prices. Tokenized stocks are generally offered only to non-US persons; know the rules where you live.",
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
