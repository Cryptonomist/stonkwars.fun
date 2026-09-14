import Link from "next/link";

import { ClosingSoon } from "@/components/ClosingSoon";
import { LiveBoard } from "@/components/LiveBoard";
import { Movers } from "@/components/Movers";
import { ProofStrip } from "@/components/ProofStrip";
import { SiteTally } from "@/components/SiteTally";
import { TickerTape } from "@/components/TickerTape";
import { TopFighters } from "@/components/TopFighters";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Wire } from "@/components/Wire";
import { CLUSTER } from "@/lib/stocks";

/* THE FRONT PAGE IS A BOARD, NOT A PITCH.
 *
 * Everyone this is for has seen a hundred landing pages and reads none of
 * them. What they read is numbers: what is moving, who is fighting, who is
 * winning, what it paid. So the page opens on the tape and the tally, says
 * what the game is in one line, and gives the rest of the first screen to the
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

      <section className="flex flex-wrap items-center gap-x-6 gap-y-3 py-6">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="h-page">
            Your stock vs theirs. <span className="text-up">Winner takes both.</span>
          </h1>
          <p className="mt-2 text-meta text-dim">
            Stake tokenized shares against someone else&apos;s. Bigger percentage move by the bell takes both stakes,
            paid in shares.
            {/* Said where the stake is first mentioned, so nobody reads the
              * line as asking for their money. */}
            {CLUSTER !== "mainnet-beta" ? " On Solana devnet: real market prices, free test shares, nothing real at stake." : ""}
          </p>
        </div>
        {/* A phone already has this button in the bar under its thumb, and the
          * second copy up here cost the first screen a fight row. */}
        <Link href="/new" className="btn btn-p1 hidden shrink-0 sm:inline-flex">
          Pick a fight
        </Link>
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
