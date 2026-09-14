"use client";

/* Pick a fight: your stock, theirs, the stake, the round.
 *
 * Both stakes are fixed here and sized to the same dollar value at the live
 * price, in integers (see `stakeForDollars`). Whoever accepts takes these
 * exact terms or leaves them.
 *
 * THE LAYOUT IS THE ORDER OF THE DECISION. One picker, switched between the
 * two corners by tabs, with the tale of the tape under it; the ticket beside
 * it from lg, sticky, so the button is on screen the moment both fighters are
 * in. On a phone the ticket follows the tape, and a bar fixed above the bottom
 * nav carries the pair and the same next step, so nobody scrolls a thousand
 * tiles to find the button. The bar steps aside while the ticket's own button
 * is on screen, so there are never two of it in view.
 *
 * A LINK CAN CARRY THE FIGHT. /new?p1=NVDA&p2=AAPL&usd=50&invite=WALLET is how
 * "Run it back" hands over a rematch (lib/ticket.ts reads it). A corner the
 * link leaves out starts from the default pair, which fights around the clock,
 * so a weekend visitor never opens on a warning.
 *
 * THE HOURS GATES ARE THE ROSTER'S, UNCHANGED. A create is refused per
 * mixedHoursAt, a bell challenge nobody can take yet says when it can be
 * (nextFairTake), and a fight that would wait says who prices each waiting
 * stock and when it reopens. The refusal is asked again at the click, because
 * the render's clock can be seconds old. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { useFaucet } from "@/components/FaucetButton";
import { StockPicker } from "@/components/StockPicker";
import { TaleOfTheTape } from "@/components/TaleOfTheTape";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs } from "@/components/ui/Tabs";
import { TxButton } from "@/components/ui/TxButton";
import { cx } from "@/components/ui/cx";
import { requestConnect } from "@/components/ui/intents";
import { useSend, useTokenBalance } from "@/lib/hooks";
import { ataFor, buildCreateDuel, randomSeed } from "@/lib/duel";
import { FAUCET_TARGET_USD, faucetWouldTopUp } from "@/lib/faucet";
import { etTime, shares, span, usd } from "@/lib/format";
import { OFFHOURS_WINDOW } from "@/lib/oracle";
import { isSparWallet, SPAR_MAX_ROUND_SECS, SPAR_WALLET } from "@/lib/spar";
import { stakeForDollars, stakeValue, usePrices } from "@/lib/prices";
import {
  byTicker,
  CLUSTER,
  firstPriceAt,
  mixedHoursAt,
  nextFairTake,
  openingWords,
  pricedAt,
  STAKE_DECIMALS,
  stakeAssetFor,
  tokenSymbol,
  type EndRule,
} from "@/lib/stocks";
import {
  allDayPair,
  ctaStep,
  isRoundId,
  ROUND_SECS,
  roundChoices,
  ticketFromParams,
  type RoundId,
} from "@/lib/ticket";
import { useNow } from "@/lib/useNow";
import { FightTicket } from "./FightTicket";

/** When a challenge made now stops being takeable. A fixed-end challenge must
 *  close before the last minutes of its round; a timed one can wait up to a
 *  week for a taker. */
const expiryFor = (fixedEnd: number, nowSecs: number) =>
  fixedEnd ? Math.min(fixedEnd - 5 * 60, nowSecs + 7 * 86_400) : nowSecs + 7 * 86_400;

/** "TSLA", "TSLA and QQQ". */
const andList = (tickers: string[]) => tickers.join(" and ");

const ROUND_WORDS: Record<RoundId, string> = {
  "5m": "5 min",
  "15m": "15 min",
  "1h": "1 hour",
  bell: "next bell",
  week: "Friday bell",
};

type Corner = "p1" | "p2";

export function CreateFight() {
  const params = useSearchParams();
  const router = useRouter();
  const { publicKey } = useWallet();
  const send = useSend();
  const now = useNow(5_000);

  /* Read once, at mount: the link sets up the ticket, and from then on the
   * ticket is the visitor's. */
  const [initial] = useState(() => ticketFromParams((k) => params.get(k), Math.floor(Date.now() / 1000)));
  const [p1, setP1] = useState<string | null>(initial.p1);
  const [p2, setP2] = useState<string | null>(initial.p2);
  const [corner, setCorner] = useState<Corner>("p1");
  const prices = usePrices([p1, p2]);
  const [dollars, setDollars] = useState<number>(initial.usd);
  const [round, setRound] = useState<RoundId>(() => {
    const r = params.get("round");
    return isRoundId(r) ? r : "15m";
  });
  const [taunt, setTaunt] = useState("");
  const [invite, setInvite] = useState(initial.invite);
  const [inviteOpen, setInviteOpen] = useState(!!initial.invite);

  const q1 = p1 ? prices.data?.quotes[p1] : undefined;
  const q2 = p2 ? prices.data?.quotes[p2] : undefined;
  const cents = BigInt(Math.round(dollars * 100));
  const amount1 = q1 ? stakeForDollars(cents, q1, STAKE_DECIMALS) : BigInt(0);
  const amount2 = q2 ? stakeForDollars(cents, q2, STAKE_DECIMALS) : BigInt(0);

  const asset1 = p1 ? stakeAssetFor(p1) : null;
  const asset2 = p2 ? stakeAssetFor(p2) : null;
  const myAta = publicKey && asset1 ? ataFor(publicKey, asset1.mint, asset1.tokenProgram) : null;
  const balance = useTokenBalance(myAta);

  /* The chips' end times move only when a bell passes, so they are worked out
   * once a minute, not on every tick. */
  const minute = Math.floor((now || Date.now() / 1000) / 60);
  const rounds = useMemo(() => roundChoices(minute * 60), [minute]);
  const roundDef = rounds.find((r) => r.id === round)!;
  const secs = ROUND_SECS[round];
  const endTs = now && !secs ? (roundDef.endTs ?? 0) : 0;

  /* Where each side's price would come from when this round ends. A stock
   * whose exchange is shut and whose token has no pool deep enough to read
   * will not settle until the market opens, and saying so before somebody
   * stakes is the whole point of working it out here. */
  const endsAt = endTs || (now ? now + (secs ?? 0) : 0);
  const sides = [p1, p2].filter((t): t is string => !!t);
  const waiting = endsAt ? sides.filter((t) => pricedAt(t, endsAt) === "waits") : [];
  /* Both sources that keep going once the exchange shuts, kept apart because
   * they are not the same claim and telling somebody the wrong one, next to
   * the button that takes their shares, is the worst place in the app to be
   * vague. Most round-the-clock fights settle on a perpetual futures market,
   * not on a Solana pool. */
  const onPerp = endsAt ? sides.filter((t) => pricedAt(t, endsAt) === "perp") : [];
  const onPoolOnly = endsAt ? sides.filter((t) => pricedAt(t, endsAt) === "pool") : [];
  const roundTheClock = [...onPerp, ...onPoolOnly];
  /* The round starts when somebody takes the challenge, and the nearest that
   * can be is now. A pair whose start prices would land hours apart, or whose
   * round would end where one side still trades and the other waits, would be
   * decided by that gap, so a timed round on it cannot be picked: a timed
   * challenge is made to be taken now.
   *
   * A bell is different. Its end is fixed and it is often set up before the
   * session, to be taken during it, and the fight page and the Action route
   * refuse the take itself at any moment the pair would part. So a bell
   * challenge is refused only when nobody could take it fairly before it
   * closes, and otherwise says when they can. */
  const fixedEnd = secs ? 0 : endTs;
  const blockedAt = (at: number, a: string, b: string) => {
    const fightRound: EndRule = { durationSecs: secs ?? 0, endTs: fixedEnd, expiresTs: expiryFor(fixedEnd, at) };
    const parts = mixedHoursAt(a, b, at, fightRound);
    const takeable = parts && fixedEnd ? nextFairTake(a, b, at, fightRound) : null;
    return { mixed: takeable === null ? parts : null, takeable };
  };
  const gate = p1 && p2 && now ? blockedAt(now, p1, p2) : { mixed: null, takeable: null };
  const mixedHours = gate.mixed;
  const takeableFrom = gate.takeable;
  /* Why a side waits, from who prices it. A Pyth feed prints only in the
   * regular session, so a Pyth stock can wait while its exchange is busy with
   * after-hours trading; only a signed stock waits because its exchange is
   * shut. */
  const waitingPyth = waiting.filter((t) => byTicker(t)?.source === "pyth");
  const waitingShut = waiting.filter((t) => byTicker(t)?.source !== "pyth");
  const reopens = endsAt ? Math.max(0, ...waiting.map((t) => firstPriceAt(t, endsAt) ?? 0)) : 0;
  const waitingWhy = [
    waitingPyth.length
      ? `${andList(waitingPyth)} ${waitingPyth.length === 1 ? "is" : "are"} priced by Pyth, which only prints from the opening bell to the close`
      : "",
    waitingShut.length
      ? `${andList(waitingShut)} ${waitingShut.length === 1 ? "is priced by its exchange" : "are priced by their exchanges"}, which will be shut when this round ends`
      : "",
  ]
    .filter(Boolean)
    .join(", and ");

  const testCluster = CLUSTER !== "mainnet-beta";
  const balanceKnown = balance.data !== undefined;
  const noAccount = balance.data === null;
  const short = typeof balance.data === "bigint" && balance.data < amount1;

  /* WHAT YOU HOLD, AND WHAT THE FAUCET CAN REACH. The ticket says how many
   * shares of your stock the wallet has (the same balance read that gates the
   * button) and offers them all as the stake. On a test cluster a stake above
   * what a faucet top-up reaches used to offer "Get test AAPLx" anyway, a
   * button that could never cover $5,000; it now says so and offers the most
   * that works. A top-up reaches about FAUCET_TARGET_USD, and happens only
   * while the wallet holds under half of it; after a top-up the suggestion
   * keeps 4% of room for the price moving between the mint and the stake. */
  const heldRaw = typeof balance.data === "bigint" ? balance.data : balance.data === null ? BigInt(0) : null;
  const heldUsd = heldRaw !== null && q1 ? stakeValue(heldRaw, STAKE_DECIMALS, q1) : null;
  const held = publicKey && p1 && heldRaw !== null ? { raw: heldRaw, usd: heldUsd } : null;
  const topUpHelps = faucetWouldTopUp(heldUsd);
  const reachUsd = topUpHelps ? FAUCET_TARGET_USD : (heldUsd ?? 0);
  // Shares already held are sized at today's price, so they need no margin.
  const safeStake = Math.max(1, Math.floor(topUpHelps ? reachUsd * 0.96 : reachUsd));
  const beyondFaucet = testCluster && (short || noAccount) && dollars > reachUsd;

  let inviteKey: PublicKey | undefined;
  let inviteError: string | null = null;
  if (invite.trim()) {
    try {
      inviteKey = new PublicKey(invite.trim());
    } catch {
      inviteError = "That is not a Solana address.";
    }
  }

  /* A challenge for the sparring wallet (lib/spar.ts) must be a round it
   * takes, or it would sit untaken; the other round chips are switched off
   * while it is the invitee, and a round from the link is caught here. */
  const sparring = isSparWallet(inviteKey?.toBase58());
  const sparRound = !sparring || (!!secs && secs <= SPAR_MAX_ROUND_SECS);
  const spar = SPAR_WALLET
    ? () => {
        setInvite(SPAR_WALLET!);
        if (!(secs && secs <= SPAR_MAX_ROUND_SECS)) setRound("15m");
      }
    : undefined;

  const pricesError = !!prices.data?.error;
  const priced = amount1 > BigInt(0) && amount2 > BigInt(0);
  const ready =
    !!publicKey && !!p1 && !!p2 && !!asset1 && !!asset2 && priced && balanceKnown &&
    !short && !noAccount && !inviteError && !mixedHours && sparRound;
  const step = ctaStep({ connected: !!publicKey, hasAccount: !noAccount, short, ready });

  /* Why the button waits, in the order somebody would fix it. */
  const waitReason = !p1 || !p2
    ? "Pick both fighters"
    : dollars < 1
      ? "Pick a stake"
      : pricesError
        ? "Waiting for prices"
        : !priced
          ? "Reading prices..."
          : inviteError
            ? "Check the wallet address"
            : !sparRound
              ? "Pick a 5 or 15 min round"
              : mixedHours
              ? "Pick two that line up"
              : !balanceKnown
                ? "Checking your shares..."
                : "Not ready";

  /* One send at a time, whichever of the two buttons (ticket or phone bar) was
   * pressed. A second press joins the first rather than asking the wallet to
   * sign a second challenge. */
  const inflight = useRef<Promise<string> | null>(null);
  const create = (onSent: (sig: string) => void): Promise<string> => {
    if (inflight.current) return inflight.current;
    const run = async () => {
      if (!publicKey || !asset1 || !asset2 || !p1 || !p2) throw new Error("Connect a wallet first.");
      const nowSecs = Math.floor(Date.now() / 1000);
      if (blockedAt(nowSecs, p1, p2).mixed) {
        // The notice above says why; nothing was sent.
        throw new Error("The two markets stopped lining up just now, so nothing was sent.");
      }
      const seed = randomSeed();
      const expiresTs = expiryFor(fixedEnd, nowSecs);
      const { instruction, duel } = buildCreateDuel({
        creator: publicKey,
        seed,
        creatorAsset: asset1,
        opponentAsset: asset2,
        creatorAmount: amount1,
        opponentAmount: amount2,
        durationSecs: secs ?? 0,
        endTs: fixedEnd,
        expiresTs,
        invitee: inviteKey,
        taunt: taunt.trim(),
      });
      const sig = await send([instruction], onSent);
      router.push(`/f/${duel.toBase58()}?new=1`);
      return sig;
    };
    const p = run().finally(() => {
      inflight.current = null;
    });
    inflight.current = p;
    return p;
  };

  /* ── Picking ────────────────────────────────────────────────────────── */

  const pick = (ticker: string) => {
    if (corner === "p1") {
      setP1(ticker);
      if (!p2) setCorner("p2");
    } else {
      setP2(ticker);
      if (!p1) setCorner("p1");
    }
  };
  const swap = () => {
    setP1(p2);
    setP2(p1);
  };
  const toAllDay = () => {
    const [a, b] = allDayPair([p1, p2]);
    setP1(a);
    setP2(b);
  };

  /* ── The hours notice ───────────────────────────────────────────────── */

  const fix = (
    <button type="button" onClick={toAllDay} className="btn btn-sm btn-ghost mt-3">
      Use two 24/7 stocks
    </button>
  );
  let notice: ReactNode = null;
  if (mixedHours) {
    notice = (
      <Notice tone="warn" title="These two cannot fight on this round right now.">
        <p>{mixedHours}</p>
        {fix}
      </Notice>
    );
  } else if (takeableFrom !== null) {
    notice = (
      <Notice tone="warn" title={`Nobody can take this before ${openingWords(takeableFrom)}.`}>
        <p>
          Taken any earlier, {p1} and {p2} would not start together.
        </p>
        {fix}
      </Notice>
    );
  } else if (waiting.length) {
    notice = (
      <Notice tone="warn" title={`This fight would sit until ${reopens ? openingWords(reopens) : "trading resumes"}.`}>
        <p>{waitingWhy}.</p>
        {fix}
      </Notice>
    );
  } else if (roundTheClock.length) {
    notice = (
      <Notice tone="info" title="The exchange is shut, so this fight runs now.">
        <p>
          {onPerp.length
            ? `${andList(onPerp)} settle on a perpetual futures market that never closes${onPoolOnly.length ? ", and " : "."}`
            : ""}
          {onPoolOnly.length
            ? `${onPerp.length ? "" : "The "}${andList(onPoolOnly)} settle on ${onPoolOnly.length === 1 ? "its" : "their"} own Solana pool.`
            : ""}
        </p>
        {onPoolOnly.length && secs && secs < OFFHOURS_WINDOW * 60 ? (
          <p className="mt-2 text-dim">
            {andList(onPoolOnly)} {onPoolOnly.length === 1 ? "has" : "have"} no market open right now except
            {onPoolOnly.length === 1 ? " its" : " their"} Solana pool, which is read over {OFFHOURS_WINDOW} minutes to
            stop one trade setting it. A round shorter than that settles on the move across those {OFFHOURS_WINDOW}{" "}
            minutes rather than {span(secs)}.
          </p>
        ) : null}
      </Notice>
    );
  }

  const roundNote = secs
    ? `Runs ${span(secs)} from the first prices after a take.`
    : endTs
      ? `Ends at the first prices after ${etTime(endTs)}.`
      : "";

  /* ── The next step ──────────────────────────────────────────────────── */

  const need = p1 && priced ? `${shares(amount1, STAKE_DECIMALS)} ${tokenSymbol(p1)}` : null;
  const action = (compact: boolean): ReactNode => {
    if (step === "connect") {
      return (
        <button type="button" onClick={requestConnect} className={cx("btn btn-p1", compact ? "btn-sm" : "w-full")}>
          Connect to stake
        </button>
      );
    }
    if (step === "faucet" && p1) {
      if (testCluster && beyondFaucet) {
        const lower = (
          <button
            type="button"
            onClick={() => setDollars(safeStake)}
            className={cx("btn btn-light", compact ? "btn-sm" : "w-full")}
          >
            Stake <span className="num">${safeStake}</span>
          </button>
        );
        if (compact) return lower;
        return (
          <div className="flex min-w-0 flex-col gap-3">
            <Notice
              tone="warn"
              title={
                topUpHelps
                  ? `The faucet tops a stock up to about $${FAUCET_TARGET_USD}.`
                  : `You hold about ${heldUsd !== null ? usd(heldUsd) : "less than this"} of ${tokenSymbol(p1)}.`
              }
            >
              {topUpHelps
                ? `Prices move between the mint and the stake, so stake $${safeStake} or less to fight now.`
                : `The faucet only tops up a wallet holding under half of $${FAUCET_TARGET_USD}, so stake what you hold to fight now.`}
            </Notice>
            {lower}
          </div>
        );
      }
      if (testCluster) {
        return (
          <div className="flex min-w-0 flex-col gap-2">
            <FaucetPrimary ticker={p1} compact={compact} />
            {!compact && need ? (
              <p className="text-meta text-dim">
                You need <span className="num text-ink">{need}</span> to stake
                {noAccount ? " and have none yet" : ""}. Test shares are free on devnet.
              </p>
            ) : null}
          </div>
        );
      }
      return (
        <button type="button" disabled className={cx("btn btn-p1", compact ? "btn-sm" : "w-full")}>
          You need {need ? <span className="num normal-case">{need}</span> : "more shares"}
        </button>
      );
    }
    if (step === "stake" && p1) {
      return (
        <TxButton
          run={create}
          successTitle="Fight picked."
          className={cx("btn-p1", compact ? "btn-sm" : "w-full")}
          label={
            /* One line on a phone: "and get the link" wrapped the label to
             * three lines at 375px, so there it is left to the success step. */
            <span className="whitespace-nowrap">
              Stake <span className="num normal-case">{need}</span>
              {compact ? null : <span className="hidden sm:inline"> and get the link</span>}
            </span>
          }
        />
      );
    }
    return (
      <button type="button" disabled className={cx("btn btn-p1", compact ? "btn-sm" : "w-full")}>
        {waitReason}
      </button>
    );
  };

  /* The bottom bar steps aside while the ticket's own button is on screen. */
  const actionRef = useRef<HTMLDivElement>(null);
  /* Assumed in view until the observer says otherwise, so a laptop that can
   * see the button never flashes the bar for a frame on load. */
  const [actionInView, setActionInView] = useState(true);
  useEffect(() => {
    const el = actionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setActionInView(entry.isIntersecting), { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* The labels stay short so both corners and Swap sit on one row at 375px;
   * the picks themselves are on the ticket and in the phone bar. */
  const cornerItems = [
    { id: "p1" as const, label: "Your fighter", side: "p1" as const },
    { id: "p2" as const, label: "Their fighter", side: "p2" as const },
  ];

  return (
    <div className="pb-6">
      <PageHeader eyebrow="New fight" title="Pick a fight" className="pb-2" />
      <p className="mb-6 text-meta text-dim">
        Stake shares of one stock against another. The bigger move by the end of the round takes both stakes.
        {testCluster ? " Devnet: real prices, free test shares, nothing real at stake." : ""}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Tabs
                ariaLabel="Corner to pick for"
                items={cornerItems}
                value={corner}
                onChange={setCorner}
                controls="corner-picker"
                className="min-w-0"
              />
              <button
                type="button"
                onClick={swap}
                disabled={!p1 || !p2}
                aria-label="Swap corners"
                className="btn btn-sm btn-ghost ml-auto shrink-0"
              >
                <span aria-hidden="true">&#8646;</span>
                <span className="hidden sm:inline">Swap</span>
              </button>
            </div>
            <div
              role="tabpanel"
              id="corner-picker"
              aria-label={corner === "p1" ? "Your fighter" : "Their fighter"}
              className="mt-3"
            >
              <StockPicker
                side={corner}
                value={corner === "p1" ? p1 : p2}
                taken={corner === "p1" ? p2 : p1}
                onChange={pick}
              />
            </div>
          </div>
          <TaleOfTheTape p1={p1} p2={p2} />
        </div>

        <div className="min-w-0 lg:sticky lg:top-20">
          <FightTicket
            p1={p1}
            p2={p2}
            q1={q1}
            q2={q2}
            amount1={amount1}
            amount2={amount2}
            dollars={dollars}
            onDollars={setDollars}
            rounds={rounds}
            round={round}
            onRound={setRound}
            roundNote={roundNote}
            notice={notice}
            taunt={taunt}
            onTaunt={setTaunt}
            invite={invite}
            onInvite={setInvite}
            inviteOpen={inviteOpen}
            onInviteOpen={setInviteOpen}
            inviteError={inviteError}
            inviteValid={!!inviteKey}
            pricesError={pricesError}
            held={held}
            onSpar={spar}
            sparring={sparring}
            action={action(false)}
            actionRef={actionRef}
          />
        </div>
      </div>

      {p1 && p2 ? (
        <NextStepBar hidden={actionInView}>
          <div className="min-w-0 flex-1">
            <p className="display truncate text-hud-xs">
              <span className="text-p1">{p1}</span> <span className="text-ink">vs</span>{" "}
              <span className="text-p2">{p2}</span>
            </p>
            <p className="num truncate text-meta text-dim">
              ${dollars} a side · {ROUND_WORDS[round]}
            </p>
          </div>
          <div className="shrink-0">{action(true)}</div>
        </NextStepBar>
      ) : null}
    </div>
  );
}

/* The faucet as the next step: the same request FaucetButton makes, drawn here
 * so the token symbol keeps its case inside an uppercase button. */
function FaucetPrimary({ ticker, compact }: { ticker: string; compact: boolean }) {
  const { drip, busy } = useFaucet([ticker]);
  return (
    <button
      type="button"
      onClick={drip}
      disabled={busy}
      aria-busy={busy || undefined}
      className={cx("btn btn-light", compact ? "btn-sm" : "w-full")}
    >
      {busy ? (
        "Minting..."
      ) : (
        <>
          Get test <span className="normal-case">{tokenSymbol(ticker)}</span>
        </>
      )}
    </button>
  );
}

/* THE BAR UNDER THE THUMB. Fixed above the phone's bottom nav, and the same
 * height reserved at the very end of the page (after the footer, which is where
 * a fixed bar would otherwise sit on top of content), so it never covers
 * anything.
 *
 * It shows whenever the ticket's own button is off screen, which on a phone is
 * most of the page. From lg the ticket is sticky beside the picker and its
 * button is in view on an ordinary laptop, so the bar stays away; on a short
 * window (1024 by 768) the ticket is taller than the screen and the bar is how
 * the button stays reachable there too. */
function NextStepBar({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <>
      <div
        role="region"
        aria-label="Pick this fight"
        hidden={hidden}
        className="rope fixed inset-x-0 z-35 bg-panel-2 shadow-overlay"
        style={{ bottom: "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">{children}</div>
      </div>
      {hidden ? null : <div aria-hidden="true" className="h-16" />}
    </>,
    document.body,
  );
}
