import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/PageHeader";
import { AROUND_THE_CLOCK, ROSTER } from "@/lib/stocks";

import { ContentsDetails, ContentsRail, type Contents } from "./OnThisPage";
import { WhySolana } from "./WhySolana";
import { WorkedExample } from "./WorkedExample";

export const metadata: Metadata = { title: "How it works" };

/* THE RULES, IN THE ORDER A NEWCOMER NEEDS THEM.
 *
 * This page used to be fifteen blocks of prose, 3,370px tall, with the names
 * of functions in the copy. Nobody learns a game that way. So it opens on the
 * whole game in three cells, then the same rules done on a real settled fight
 * (WorkedExample), and only then the questions, each with its own address so
 * an answer can be linked to.
 *
 * The questions keep every rule exactly as it was. What moved is detail only a
 * developer checking the program needs: the ordering test on Pyth updates, the
 * name of Pyth's own function for it, and how a bar's close is chosen. Each
 * sits under "For developers" beneath its answer, so the answer reads as
 * sentences and the proof is still one tap away.
 *
 * Every count comes from the roster, so none of them can go stale: how many
 * stocks, which are priced by Pyth, and how many fight around the clock. */

const PYTH = ROSTER.filter((s) => s.source === "pyth").map((s) => s.ticker);

/** "TSLA, QQQ and VOO". */
const listWords = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

const STEPS: { title: string; lines: [string, string] }[] = [
  {
    title: "Call it",
    lines: [
      `Pick your stock from all ${ROSTER.length.toLocaleString("en-US")} tokenized on Solana, and the one it beats.`,
      "Stake shares of yours and set the round.",
    ],
  },
  {
    title: "They answer",
    lines: [
      "Whoever takes it stakes the same dollar value of the other stock.",
      "No odds, no house, no order book.",
    ],
  },
  {
    title: "The bell decides",
    lines: [
      "Signed prices at the start and at the bell.",
      "The bigger percentage move takes both stakes, paid in shares.",
    ],
  },
];

type Rule = {
  id: string;
  /** The rail's name for it: short enough for one line in a narrow column. */
  label: string;
  q: string;
  a: React.ReactNode;
  /** Detail for someone checking the program, folded under the answer. */
  dev?: React.ReactNode;
};

const Code = ({ children }: { children: React.ReactNode }) => <code className="num text-ink">{children}</code>;

const RULES: Rule[] = [
  {
    id: "what-you-stake",
    label: "What you stake",
    q: "What am I actually staking?",
    a: "Tokenized shares of the stock you back. On mainnet that means an issuer's tokenized stock, such as an xStock; on devnet, test tokens that stand in for them, which the faucet hands out. The winner receives both stakes as shares, not as cash.",
  },
  {
    id: "which-stocks",
    label: "Which stocks",
    q: "Which stocks?",
    a: `Every tokenized stock and ETF on Solana: ${ROSTER.length.toLocaleString("en-US")} today, from Apple to Hong Kong listings. Lookalike tokens that borrow a real one's name are left out; only the issuer's own mints can be staked.`,
  },
  {
    id: "who-wins",
    label: "Who wins",
    q: "How is the winner decided?",
    a: "By percentage move. Each stock's end price is divided by its start price, and the larger ratio wins, with no rounding anywhere in the decision. A $900 stock that rises $18 (+2%) loses to a $100 stock that rises $3 (+3%).",
    dev: (
      <p>
        The program compares the two ratios by cross-multiplying the integer prices:{" "}
        <Code>challenger end × answerer start</Code> against <Code>answerer end × challenger start</Code>. There is no
        division, so nothing in the decision is rounded or truncated.
      </p>
    ),
  },
  {
    id: "which-prices",
    label: "Which prices",
    q: "Which prices?",
    a: `For every boundary, exactly one per stock, from one of two sources. ${listWords(PYTH)} are priced by Pyth: the first Pyth update published at or after the boundary, and only one update in existence qualifies. Every other stock is priced by the Stonk Wars oracle from the market's one-minute bars, signed by the oracle key and checked on chain. That is a fact about the past, so there is one answer and nothing to shop for.`,
    dev: (
      <>
        <p>
          Each Pyth update carries the publish time of the one before it, so the program demands{" "}
          <Code>previous &lt; boundary &lt;= this one</Code>, and only one update satisfies that. It is the same rule as
          Pyth&apos;s own <Code>parsePriceFeedUpdatesUnique</Code>.
        </p>
        <p>
          An oracle price is the close of the stock&apos;s first one-minute bar at or after the boundary. The signed
          quote is verified by Solana&apos;s Ed25519 program in the same transaction, and it stays public in that
          transaction, so anyone can hold it against the market&apos;s record.
        </p>
      </>
    ),
  },
  {
    id: "three-in-the-morning",
    label: "Fighting at 3am",
    q: "Can I fight at three in the morning?",
    a: `Yes, on ${AROUND_THE_CLOCK.toLocaleString("en-US")} of them. A US stock's own market runs from 4am to 8pm New York time and the oracle reads it the whole way, pre-market and after-hours included. Outside even that, and at weekends, the price comes from a market that never closes: the stock's perpetual future on Hyperliquid, which trades every minute of every day. The rule is the same one the exchange gets, so a round measures exactly the interval it says it does.${
      PYTH.length
        ? ` The stocks priced by Pyth (${listWords(PYTH)}) fight while Pyth's equity feeds print, from 8pm Sunday to 8pm Friday New York time, except on market holidays and after 1pm on a half day. A fight that would start or end while Pyth is dark is refused, because nothing could ever price it.`
        : ""
    }`,
    dev: "Off-hours, a perpetual future is read exactly as the exchange is: the close of its first one-minute bar at or after the moment in question.",
  },
  {
    id: "perpetual-futures",
    label: "Why perps are fair",
    q: "A perpetual future is not a share. Why is that fair?",
    a: "Because a fight compares two moves, not two price tags, and the alternative was worse. We priced weekends from each token's own Solana pool first, and measured it: those pools traded a median of three minutes an hour, and a fifteen-minute reading of them moved five times as much as the market actually had. The perps print every minute, carry real size, and track the underlying share closely; each market is checked against the stock's own last price before it is used at all, which is how we caught that the venue's CL is crude oil while our CL is Colgate-Palmolive. A stock with no perpetual market falls back to its pool, and one with neither keeps exchange hours.",
    dev: "A pool price is the average of the middle 60% of up to 15 one-minute closes in the hour before the boundary, so one trade cannot set it.",
  },
  {
    id: "why-not-pyth",
    label: "Why not all Pyth",
    q: "Why not Pyth for everything?",
    a: `This deployment's Pyth plan covers only three equity feeds, and Pyth's equity feeds are dark from 8pm Friday to 8pm Sunday New York time. So TSLA and QQQ, which markets trade all weekend, are priced by the Stonk Wars oracle for new fights, and ${listWords(PYTH)}, which no weekend market trades well enough, ${PYTH.length === 1 ? "stays" : "stay"} on Pyth. Rather than lock out the rest of the market, the program takes a second source for the others and says so on every fight. One admin call switches a stock's source for new fights; fights already running keep the source they started with.`,
  },
  {
    id: "why-not-the-token",
    label: "Why not the token price",
    q: "Why not the token's price all the time?",
    a: "Because while the stock's own market is open it is the better number by a distance: far deeper, far harder to move, and the thing the token is a claim on. The stock's perpetual future, or for the few without one its Solana pool, is the answer to a shut exchange, not a replacement for an open one.",
  },
  {
    id: "round-start",
    label: "When a round starts",
    q: "When does a round start?",
    a: "At each stock's first price at least two seconds after the fight is taken, which is a price that did not exist when the taker signed. The two seconds cover the gap between the cluster's clock and wall time.",
  },
  {
    id: "who-settles",
    label: "Who settles",
    q: "Who settles it?",
    a: "Anyone. Our settler posts the prices as soon as they exist, usually within a couple of minutes of the bell. When it is late, the fight is marked Late on every board and any wallet can do the same from the fight page, and the result is identical whoever does it. Pyth prices need no key at all; the oracle's quotes are handed to anyone who asks, already signed.",
  },
  {
    id: "market-closed",
    label: "Market closed",
    q: "What if the market is closed?",
    a: `For the ${AROUND_THE_CLOCK.toLocaleString("en-US")} that fight around the clock, nothing changes: the fight runs and settles on schedule, priced by the stock's perpetual future or, for a few with none, by its own Solana pool. For the rest, and for listings outside the US, a fight taken while their market is shut starts at the first price when trading resumes. If that is more than five days away, or it lands inside the last minute of a fixed-end round, the fight is void and both stakes go home.`,
  },
  {
    id: "no-taker",
    label: "Nobody takes it",
    q: "What if nobody takes my fight?",
    a: "Call it off any time before someone accepts and your stake comes straight back. Once the challenge expires, anyone can send it home for you.",
  },
  {
    id: "ties",
    label: "Ties and breaks",
    q: "What if it ties, or breaks?",
    a: "An exact tie refunds each side its own stake. A fight whose price never arrives (a halted feed, a delisting) can be refunded by anyone a week after it should have moved.",
  },
  {
    id: "stake-safety",
    label: "Stake safety",
    q: "Can anyone take the stakes?",
    a: "No. Stakes sit in token accounts owned by the fight's own address. The program has exactly three ways to move them: back to the challenger before the fight starts, to the winner, or home to both. There is no admin withdrawal. The admin can register stocks, pause new fights and name the oracle for new fights, and cannot touch a stake. A fight whose prices never come is refunded in full.",
  },
  {
    id: "real-money",
    label: "Real money",
    q: "Is this real money?",
    a: "The live demo runs on Solana devnet with test shares and real market prices. Tokenized stocks are generally offered only to non-US persons; know the rules where you live.",
  },
];

const CONTENTS: Contents = [
  { id: "the-game", label: "The game in three" },
  { id: "why-solana", label: "Why Solana" },
  ...RULES.map((r) => ({ id: r.id, label: r.label })),
];

export default function HowPage() {
  return (
    /* From 1024px: the rail, the reading column, and an empty column that
     * mirrors the rail, so the text sits in the middle of the page, where the
     * privacy and terms pages put theirs. */
    <div className="pb-10 text-base lg:grid lg:grid-cols-[minmax(12rem,1fr)_minmax(0,68ch)_minmax(0,1fr)] lg:gap-x-10">
      <ContentsRail items={CONTENTS} className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] self-start overflow-y-auto pt-6 lg:block" />

      <article className="mx-auto min-w-0 max-w-[68ch] lg:mx-0">
        <PageHeader eyebrow="The rules" title="How it works" />

        <ContentsDetails items={CONTENTS} className="mb-4 lg:hidden" />

        <section id="the-game" aria-labelledby="the-game-title" className="scroll-mt-20">
          <h2 id="the-game-title" className="sr-only">
            The game in three steps
          </h2>
          <ol className="grid gap-px bg-line ring-1 ring-line sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex min-w-0 flex-col gap-1.5 bg-panel px-3 py-2.5">
                <p className="label">
                  <span className="num">{i + 1}</span> · {s.title}
                </p>
                {s.lines.map((line) => (
                  <p key={line} className="text-sm text-ink">
                    {line}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </section>

        <WorkedExample className="mt-6" />

        {/* Straight after the real fight, so its cost is the fight just read. */}
        <WhySolana className="mt-10" />

        <div className="mt-10 flex flex-col">
          {RULES.map((r) => (
            <section
              key={r.id}
              id={r.id}
              aria-labelledby={`${r.id}-q`}
              className="scroll-mt-20 border-t border-line py-6"
            >
              <h2 id={`${r.id}-q`} className="h-section">
                {r.q}
              </h2>
              <p className="mt-3 text-dim">{r.a}</p>
              {r.dev ? (
                <details className="group mt-2">
                  <summary className="label min-h-10 cursor-pointer select-none py-3 hover:text-ink">
                    For developers
                  </summary>
                  <div className="flex flex-col gap-3 border-l border-line pl-4 text-sm text-dim">
                    {typeof r.dev === "string" ? <p>{r.dev}</p> : r.dev}
                  </div>
                </details>
              ) : null}
            </section>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-6">
          <Link href="/new" className="btn btn-p1">
            Pick a fight
          </Link>
          <p className="text-sm text-dim">
            Or read the{" "}
            <Link href="/terms" className="link">
              terms
            </Link>{" "}
            and the{" "}
            <Link href="/privacy" className="link">
              privacy policy
            </Link>
            .
          </p>
        </div>
      </article>
    </div>
  );
}
