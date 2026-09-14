import Link from "next/link";

import { ClosingSoon } from "@/components/ClosingSoon";
import { LiveBoard } from "@/components/LiveBoard";
import { MainEvent } from "@/components/MainEvent";
import { Movers } from "@/components/Movers";
import { ProofStrip } from "@/components/ProofStrip";
import { SiteTally } from "@/components/SiteTally";
import { TickerTape } from "@/components/TickerTape";
import { TopFighters } from "@/components/TopFighters";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Wire } from "@/components/Wire";
import { BRAND } from "@/lib/brand";
import { CLUSTER } from "@/lib/stocks";

/* THE FRONT PAGE IS A BOARD, NOT A PITCH.
 *
 * Everyone this is for has seen a hundred landing pages and reads none of
 * them. What they read is numbers: what is moving, who is fighting, who is
 * winning, what it paid. So the page opens on the tape, the main event (the
 * live round nearest its bell, or the latest result) and the tally, says what
 * the game is in one line, and gives the rest of the first screen to the
 * ring, the wire and the rails. The billboards that used to fill the bottom
 * half (three steps, four trust cards) are gone: the proof is a strip of links
 * to the things themselves, and the explaining lives on /how.
 *
 * THE GRID, BY WIDTH. From 1280px three columns: the ring, the wire, and a
 * rail with the movers and the top fighters. From 1024px the ring and the wire
 * stack on the left beside the rail. Below that, one column in reading order.
 * The ring-and-wire wrapper dissolves (display: contents) at 1280px, so the
 * same two sections are grid children there and a stacked column below it,
 * without rendering either twice. Every grid child is min-w-0, so a long
 * handle truncates instead of widening the page on a phone. */

export default function Home() {
  return (
    <div>
      {/* Out past the page's column, edge to edge, the way a tape should run. */}
      <div className="relative left-1/2 w-screen -translate-x-1/2 overflow-x-clip">
        <TickerTape />
      </div>

      {/* THE BIG THING UP TOP IS A FIGHT. The slogan that used to be the
        * page's largest type said nothing live; the main event is a real round
        * (or the latest result), and the pitch is one line under it. The page
        * keeps its heading for screen readers and search. */}
      <h1 className="sr-only">{BRAND.name}: stock duels on Solana</h1>
      <section className="flex flex-col gap-3 py-6" aria-label="Main event">
        <MainEvent />
        <div className="flex min-w-0 items-center gap-x-6 gap-y-3">
          {/* On a phone the pitch is one line ending in a way to the rules, so
            * the first screen keeps its room for fight rows. */}
          <p className="flex min-w-0 flex-1 items-baseline gap-2 text-meta text-dim sm:hidden">
            <span className="min-w-0 truncate">
              {CLUSTER !== "mainnet-beta" ? "Test shares on devnet. " : ""}Bigger move takes both.
            </span>
            <Link href="/how" className="link shrink-0">
              How
            </Link>
          </p>
          <p className="hidden min-w-0 flex-1 text-meta text-dim sm:block">
            Your stock vs theirs. Stake tokenized shares against someone else&apos;s; the bigger percentage move by the
            bell takes both stakes, paid in shares.
            {/* Said where the stake is first mentioned, so nobody reads the
              * line as asking for their money. */}
            {CLUSTER !== "mainnet-beta" ? " On Solana devnet: real market prices, free test shares, nothing real at stake." : ""}
          </p>
          {/* A phone already has this button in the bar under its thumb, and the
            * second copy up here cost the first screen a fight row. */}
          <Link href="/new" className="btn btn-p1 hidden shrink-0 sm:inline-flex">
            Pick a fight
          </Link>
        </div>
      </section>

      <SiteTally />

      {/* CLOSING SOON, ABOVE THE BOARD FROM 640PX AND UNDER THE RING BELOW IT.
        * On a phone the ring already opens with the same live and open fights,
        * so the strip up here would push the first row off the screen to repeat
        * it. Both copies read the same cached queries; the one not shown is
        * display: none. A wrapper around nothing takes no space (empty:hidden). */}
      <div className="mt-6 hidden empty:hidden sm:block">
        <ClosingSoon />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]">
        <div className="flex min-w-0 flex-col gap-6 xl:contents">
          <section className="flex min-w-0 flex-col gap-3" aria-labelledby="ring-head">
            <SectionHead id="ring-head" title="In the ring" action={{ href: "/fights", label: "All fights" }} />
            <LiveBoard limit={8} />
          </section>

          <div className="min-w-0 empty:hidden sm:hidden">
            <ClosingSoon />
          </div>

          <div className="min-w-0">
            <Wire />
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-6" aria-label="Rails">
          <section className="flex min-w-0 flex-col gap-3" aria-labelledby="movers-head">
            <SectionHead id="movers-head" title="Moving today" />
            <Plate pad="std" className="py-2">
              <Movers rows={8} />
            </Plate>
          </section>

          <section className="flex min-w-0 flex-col gap-3" aria-labelledby="cooks-head">
            <SectionHead id="cooks-head" title="Who cooks" />
            <Plate pad="std" className="py-2">
              <TopFighters rows={7} />
            </Plate>
          </section>
        </aside>
      </div>

      <section className="mt-10 flex flex-col gap-3" aria-label="Check it yourself">
        <ProofStrip />
        <p className="text-meta text-dim">
          Details and edge cases:{" "}
          <Link href="/how" className="link">
            how it works
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
