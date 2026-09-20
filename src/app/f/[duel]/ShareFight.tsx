"use client";

/* SENDING THE FIGHT SOMEWHERE.
 *
 *   open     "Send it to someone": a challenge is only a fight once somebody
 *            takes it, so a fresh one (?new=1) gets an ink ring to say this
 *            is the next step
 *   live     "Share the fight"
 *   settled  "Post the K.O.", with the card the link unfurls into, drawn
 *            from chain state by opengraph-image.tsx, so what gets posted is
 *            what the viewer sees here
 *
 * The raw URL box is gone: nobody reads a URL, and "Copy link" puts it on the
 * clipboard with a toast to say it worked.
 *
 * There used to be a "Preview the Blink" link here, to dial.to, which rendered
 * any Action URL as a card. Dialect paused dial.to in 2026 and the Blinks
 * registry has been frozen since spring, so the link went nowhere. The fight is
 * still a valid Solana Action at /api/actions/fight/<duel>; there is just no
 * public previewer to send anyone to. */

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { Plate } from "@/components/ui/Plate";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { BRAND } from "@/lib/brand";
import { isInviteOnly, OUTCOME_CREATOR, SOURCE_PYTH, STATUS_LIVE, STATUS_OPEN, STATUS_SETTLED, type DuelView } from "@/lib/duel";
import { loserTake } from "@/lib/derive";
import { shares, usd } from "@/lib/format";
import { useProfiles } from "@/lib/hooks";
import { calloutPrefix, koPostText } from "@/lib/shareText";
import { STAKE_DECIMALS, tokenSymbol } from "@/lib/stocks";

export function ShareFight({
  d,
  t1,
  t2,
  m1,
  m2,
  fresh,
  className,
}: {
  d: DuelView;
  t1: string;
  t2: string;
  m1: number | null;
  m2: number | null;
  fresh: boolean;
  className?: string;
}) {
  const { data: handles } = useProfiles();
  const me = useWallet().publicKey?.toBase58();
  const [origin, setOrigin] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  if (!origin) return null;

  const address = d.address.toBase58();
  const url = `${origin}/f/${address}`;

  let title = "";
  let text = "";
  if (d.status === STATUS_OPEN) {
    title = "Send it to someone";
    /* A challenge addressed to one wallet tags it, when it has linked a handle. */
    const called = isInviteOnly(d) ? calloutPrefix(handles?.[d.invitee.toBase58()]) : "";
    text = d.taunt
      ? `${called}${d.taunt}\n\n${t1} vs ${t2}. I staked ${shares(d.creatorAmount, STAKE_DECIMALS)} ${tokenSymbol(t1)}. Take the other side:`
      : `${called}I'm staking ${shares(d.creatorAmount, STAKE_DECIMALS)} ${tokenSymbol(t1)} that ${t1} beats ${t2}. Take the other side:`;
  } else if (d.status === STATUS_SETTLED && m1 !== null && m2 !== null) {
    title = "Post the K.O.";
    const creatorWon = d.outcome === OUTCOME_CREATOR;
    const [win, lose, mw, ml] = creatorWon ? [t1, t2, m1, m2] : [t2, t1, m2, m1];
    const winner = (creatorWon ? d.creator : d.opponent).toBase58();
    const loser = (creatorWon ? d.opponent : d.creator).toBase58();
    const take = loserTake(d);
    text = koPostText({
      win,
      lose,
      mw,
      ml,
      byPyth: d.creatorSource === SOURCE_PYTH && d.opponentSource === SOURCE_PYTH,
      winnerHandle: handles?.[winner],
      loserHandle: handles?.[loser],
      tookUsd: take?.usd ? usd(take.usd) : null,
      viewer: me === winner ? "winner" : me === loser ? "loser" : "other",
    });
  } else if (d.status === STATUS_LIVE) {
    title = "Share the fight";
    text = `${t1} vs ${t2} is live on ${BRAND.name}. Watch it:`;
  } else {
    return null;
  }

  /* X keeps a link's card for days, keyed by URL. A fight first posted while
   * open would unfurl as "Open challenge" even after the K.O., so the result
   * is posted under its own URL and gets its own, final card. */
  const postUrl = d.status === STATUS_SETTLED ? `${url}?r=ko` : url;
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(postUrl)}`;
  const copy = () => {
    if (!navigator.clipboard) {
      toast.push({ title: "Could not copy.", body: "The link is in the address bar." });
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => toast.push({ title: "Link copied", check: true }),
      () => toast.push({ title: "Could not copy.", body: "The link is in the address bar." }),
    );
  };

  const ring = fresh && d.status === STATUS_OPEN;

  return (
    <Plate as="section" pad="std" className={cx("flex flex-col gap-3", ring && "ring-2 ring-ink", className)}>
      <h2 className="label">{title}</h2>
      {d.status === STATUS_SETTLED ? (
        /* The card is drawn on request and takes a moment, so its box holds a
         * shimmer of its own shape until it arrives, then the image fades in
         * over it (appears at once under reduced motion). */
        <a
          href={`/f/${address}/opengraph-image`}
          target="_blank"
          rel="noreferrer"
          className="relative block aspect-[1200/630] overflow-hidden ring-1 ring-line"
        >
          {!loaded ? <Skeleton className="absolute inset-0 h-full w-full" /> : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={(el) => {
              // Already decoded from cache before React attached onLoad.
              if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
            }}
            src={`/f/${address}/opengraph-image`}
            alt={`The card this fight's link unfurls into: ${t1} vs ${t2}, final.`}
            width={1200}
            height={630}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className={cx(
              "relative block h-full w-full transition-opacity duration-300 motion-reduce:transition-none",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        </a>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <a href={intent} target="_blank" rel="noreferrer" className="btn btn-sm btn-light">
          Post on X
        </a>
        <button type="button" onClick={copy} className="btn btn-sm btn-ghost">
          Copy link
        </button>
      </div>
    </Plate>
  );
}
