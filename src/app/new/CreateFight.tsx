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
 * THE HOURS GATES JUDGE THE SOURCES THE CHAIN WILL RECORD: the registry's for
 * each side once read, the roster's until then. A challenge that cannot be taken fairly
 * now but can be later is queued, not refused (stocks.ts, queueAt): it can be
 * made, and the ticket says from when it can be taken. Only a pair nobody could
 * take fairly before it expires is refused, with mixedHoursAt's sentence. A
 * fight that would wait says who prices each waiting stock and when it
 * reopens. The refusal is asked again at the click, because the render's
 * clock can be seconds old. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { BuyShortcut } from "@/components/BuyShortcut";
import { useFaucet } from "@/components/FaucetButton";
import { StockPicker } from "@/components/StockPicker";
import { TaleOfTheTape } from "@/components/TaleOfTheTape";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs } from "@/components/ui/Tabs";
import { TxButton } from "@/components/ui/TxButton";
import { cx } from "@/components/ui/cx";
import { requestConnect } from "@/components/ui/intents";
import { calloutError, resolveCallout } from "@/lib/callout";
import { useProfiles, useRegistrySources, useSend, useTokenBalance } from "@/lib/hooks";
import { ataFor, buildCreateDuel, randomSeed } from "@/lib/duel";
import { FAUCET_TARGET_USD, faucetWouldTopUp } from "@/lib/faucet";
import { etShort, etTime, hm, shares, span, usd } from "@/lib/format";
import { OFFHOURS_WINDOW } from "@/lib/oracle";
import { isSparWallet, SPAR_MAX_ROUND_SECS, SPAR_WALLET, sparRoundFor } from "@/lib/spar";
import { stakeForDollars, stakeValue, usePrices } from "@/lib/prices";
import {
  CLUSTER,
  firstPriceAt,
  offHoursWords,
  openingWords,
  pricedAt,
  byTicker,
  queueAt,
  sourceFromChain,
  STAKE_DECIMALS,
  stakeAssetFor,
  tokenSymbol,
  tooShortOffHours,
  type EndRule,
  type Queue,
  type SideSource,
} from "@/lib/stocks";
import { MIN_OFFHOURS_ROUND_SECS } from "@/lib/composite";
import { pythDownFor } from "@/lib/pythHealth";
import {
  allDayPair,
  ctaStep,
  isRoundId,
  ROUND_SECS,
  roundChoices,
  shortestRoundAtLeast,
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

/** A challenge's end rule as the gates read it, made at `at`: its round, the
 *  expiry it will carry, which a queue must end before, and the sources the
 *  registry would record for its two sides (useRegistrySources), where read. */
const roundOf = (secs: number | undefined, fixedEnd: number, at: number, sources?: (number | undefined)[]): EndRule => ({
  durationSecs: secs ?? 0,
  endTs: fixedEnd,
  expiresTs: expiryFor(fixedEnd, at),
  creatorSource: sources?.[0],
  opponentSource: sources?.[1],
});

const MIN_ROUND_HOURS = MIN_OFFHOURS_ROUND_SECS / 3_600;

/** "TSLA", "TSLA and QQQ". */
const andList = (tickers: string[]) => tickers.join(" and ");

const ROUND_WORDS: Record<RoundId, string> = {
  "5m": "5 min",
  "15m": "15 min",
  "1h": "1 hour",
  "12h": "Overnight 12h",
  "24h": "24 hours",
  bell: "Next bell",
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
  /* Whether the visitor (or their link) chose the round. Until they do, a
   * default the composite's hours rule out moves to the shortest round they
   * allow, so a weekend visitor never opens on a refusal. */
  const [roundPicked, setRoundPicked] = useState(() => isRoundId(params.get("round")));
  const pickRound = (r: RoundId) => {
    setRoundPicked(true);
    setRound(r);
  };
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
  /* THE GATES JUDGE WHAT THE CHAIN WILL RECORD. A fight copies each side's
   * source from the registry, which can still say Pyth for a stock the roster
   * has moved to the oracle, until the admin's set_asset (lib/hooks.ts,
   * useRegistrySources). Until the registry has been read, the roster's. */
  const registry = useRegistrySources([asset1?.mint ?? null, asset2?.mint ?? null]).data;
  const recordedFor = (t: string): SideSource | undefined => {
    const n = t === p1 ? registry?.[0] : t === p2 ? registry?.[1] : undefined;
    return n === undefined ? undefined : sourceFromChain(n);
  };
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
  const waiting = endsAt ? sides.filter((t) => pricedAt(t, endsAt, recordedFor(t)) === "waits") : [];
  /* Both sources that keep going once the exchange shuts, kept apart because
   * they are not the same claim and telling somebody the wrong one, next to
   * the button that takes their shares, is the worst place in the app to be
   * vague. Most round-the-clock fights settle on a perpetual futures market,
   * not on a Solana pool. */
  const onPerp = endsAt ? sides.filter((t) => pricedAt(t, endsAt, recordedFor(t)) === "perp") : [];
  const onPoolOnly = endsAt ? sides.filter((t) => pricedAt(t, endsAt, recordedFor(t)) === "pool") : [];
  const onComposite = endsAt ? sides.filter((t) => pricedAt(t, endsAt, recordedFor(t)) === "composite") : [];
  const roundTheClock = [...onPerp, ...onPoolOnly, ...onComposite];
  /* QUEUE, DO NOT REFUSE, WHERE IT IS FAIR.
   *
   * The round starts when somebody takes the challenge. A pair whose start
   * prices would land hours apart, whose round would end where one side still
   * trades and the other waits, or whose short round the 24/7 markets would
   * price, cannot be taken fairly now. Most of those can be at the next
   * opening, so the challenge is made anyway and queued: it says from when it
   * can be taken, and the fight page and the Action route refuse the take at
   * every earlier moment (stocks.ts, queueAt). Only a pair nobody could take
   * fairly before the challenge expires is refused. */
  const fixedEnd = secs ? 0 : endTs;
  const blockedAt = (at: number, a: string, b: string) => {
    const q = queueAt(a, b, at, roundOf(secs, fixedEnd, at, registry));
    return { mixed: q && "refused" in q ? q.refused : null, queued: q && "queued" in q ? q : null };
  };
  const gate = p1 && p2 && now ? blockedAt(now, p1, p2) : { mixed: null, queued: null };
  /* ...or Pyth is not answering us for a stock Pyth prices (pythHealth.ts): a
   * fight made now could never start. Same notice, same disabled button. */
  const pythSides = [p1, p2].filter((t): t is string => !!t && byTicker(t)?.source === "pyth");
  const mixedHours = gate.mixed ?? (now ? pythDownFor(pythSides, prices.data?.quotes, now) : null);
  const queued = gate.queued;

  /* EACH ROUND CHIP, AS IT WOULD GO NOW.
   *
   * Worked out once a minute. A round the 24/7 markets would price at its
   * start or end must run at least MIN_OFFHOURS_ROUND_SECS (stocks.ts,
   * tooShortOffHours), so while the exchange is shut the shorter chips queue
   * for the open, and say from when; 12 and 24 hours run now. A chip nobody
   * could take fairly at all is switched off, with the reason on it. */
  // Only once the page has a clock, so the server render and hydration agree.
  const chipMinute = now ? minute : 0;
  const chips = useMemo(() => {
    const out: Partial<Record<RoundId, { queue: Queue; short: boolean }>> = {};
    if (!p1 || !p2 || !chipMinute) return out;
    const at = chipMinute * 60;
    for (const r of rounds) {
      const fixed = r.secs ? 0 : (r.endTs ?? 0);
      const q = queueAt(p1, p2, at, roundOf(r.secs, fixed, at, registry));
      if (q) out[r.id] = { queue: q, short: tooShortOffHours(p1, p2, at, roundOf(r.secs, fixed, at, registry)) };
    }
    return out;
  }, [p1, p2, chipMinute, rounds, registry]);
  const chipNotes = useMemo(() => {
    const notes: Partial<Record<RoundId, { sub?: string; title: string; off?: boolean }>> = {};
    for (const [id, c] of Object.entries(chips) as [RoundId, { queue: Queue; short: boolean }][]) {
      notes[id] =
        "queued" in c.queue
          ? { sub: `from ${etShort(c.queue.queued)}`, title: `Queued: nobody can take it before ${openingWords(c.queue.queued)}. ${c.queue.why}` }
          : { title: c.queue.refused, off: true };
    }
    return notes;
  }, [chips]);
  const shortQueued = Object.values(chips).some((c) => c.short && "queued" in c.queue);
  useEffect(() => {
    if (roundPicked || !chips[round]?.short) return;
    const longer = shortestRoundAtLeast(MIN_OFFHOURS_ROUND_SECS);
    if (longer && !chips[longer]) setRound(longer);
  }, [roundPicked, chips, round]);
  /* Why a side waits. Only a signed stock waits, because its exchange is
   * shut: a Pyth stock prices at once or never, and mixedHoursAt refuses the
   * never. */
  const reopens = endsAt ? Math.max(0, ...waiting.map((t) => firstPriceAt(t, endsAt, recordedFor(t)) ?? 0)) : 0;
  const waitingWhy = waiting.length
    ? `${andList(waiting)} ${waiting.length === 1 ? "is priced by its exchange" : "are priced by their exchanges"}, which will be shut when this round ends`
    : "";

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

  /* A wallet address, or the X handle of a wallet that has linked one: people
   * know each other's handles, not their keys (lib/callout.ts). What goes on
   * chain is the wallet either way. */
  const profiles = useProfiles();
  const callout = resolveCallout(invite, profiles.data);
  const inviteKey: PublicKey | undefined = callout.kind === "wallet" ? new PublicKey(callout.wallet) : undefined;
  const inviteError: string | null = calloutError(callout, !profiles.isLoading);
  const inviteName = callout.kind === "wallet" && callout.handle ? `@${callout.handle.replace(/^@/, "")}` : null;

  /* A challenge for the sparring wallet (lib/spar.ts) must be a round it
   * takes, or it would sit untaken; the other round chips are switched off
   * while it is the invitee, and a round from the link is caught here. */
  const sparring = isSparWallet(inviteKey?.toBase58());
  const sparRound = !sparring || (!!secs && secs <= SPAR_MAX_ROUND_SECS);
  const spar = SPAR_WALLET
    ? () => {
        setInvite(SPAR_WALLET!);
        // A round it takes and a visitor can fight now: 15 minutes while the
        // exchange trades, the overnight 12 hours while it is shut.
        setRound(sparRoundFor(Date.now()));
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
              ? "Pick a timed round of 24 hours or less"
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
    const [a, b] = allDayPair([p1, p2], now || undefined);
    setP1(a);
    setP2(b);
  };

  /* ── The hours notice ───────────────────────────────────────────────── */

  const fix = (
    <button type="button" onClick={toAllDay} className="btn btn-sm btn-ghost mt-3">
      Use two 24/7 stocks
    </button>
  );
  /* A queued short round can run now instead: the shortest round the 24/7
   * markets may price, when that one is fair now. */
  const longer = shortestRoundAtLeast(MIN_OFFHOURS_ROUND_SECS);
  const runNow =
    queued && chips[round]?.short && longer && !chips[longer] ? (
      <button type="button" onClick={() => pickRound(longer)} className="btn btn-sm btn-light mt-3">
        Fight now: {ROUND_WORDS[longer]}
      </button>
    ) : null;
  let notice: ReactNode = null;
  if (mixedHours) {
    notice = (
      <Notice tone="warn" title="These two cannot fight on this round before the challenge expires.">
        <p>{mixedHours}</p>
        {fix}
      </Notice>
    );
  } else if (queued) {
    notice = (
      <Notice tone="info" title={`Queued for ${openingWords(queued.queued)}.`}>
        <p>
          Nobody can take this before then{now ? <span className="num"> ({hm(queued.queued - now)})</span> : null}, and a take
          from then starts it at the first prices after.
        </p>
        <p className="mt-2 text-dim">{queued.why}</p>
        {runNow ?? fix}
      </Notice>
    );
  } else if (waiting.length) {
    notice = (
      <Notice tone="info" title={`This fight would sit until ${reopens ? openingWords(reopens) : "trading resumes"}.`}>
        <p>{waitingWhy}.</p>
        {fix}
      </Notice>
    );
  } else if (roundTheClock.length) {
    notice = (
      <Notice tone="info" title="The exchange is shut, so this fight runs now.">
        <p>
          {onComposite.length
            ? `${andList(onComposite)} ${onComposite.length === 1 ? "is" : "are"} priced by ${onComposite.length === 1 ? (offHoursWords(onComposite[0], endsAt) ?? "its 24/7 markets") : "the median of the markets that trade them around the clock"}. `
            : ""}
          {onPerp.length
            ? `${andList(onPerp)} ${onPerp.length === 1 ? "settles" : "settle"} on a perpetual futures market that never closes${onPoolOnly.length ? ", and " : "."}`
            : ""}
          {onPoolOnly.length
            ? `${andList(onPoolOnly)} ${onPoolOnly.length === 1 ? "settles on its" : "settle on their"} own Solana pool.`
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
        <button type="button" onClick={requestConnect} className={cx("btn btn-primary", compact ? "btn-sm" : "w-full")}>
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
      /* What the missing shares are worth: the stake, less what the wallet holds. */
      const missingUsd = Math.max(0, dollars - (heldUsd ?? 0));
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
            {!compact ? <BuyShortcut ticker={p1} usd={missingUsd} primary={false} className="self-start" /> : null}
          </div>
        );
      }
      if (compact) return <BuyShortcut ticker={p1} usd={missingUsd} compact />;
      return (
        <div className="flex min-w-0 flex-col gap-2">
          <BuyShortcut ticker={p1} usd={missingUsd} />
          {need ? (
            <p className="text-meta text-dim">
              You need <span className="num text-ink">{need}</span> to stake{noAccount ? " and have none yet" : ""}.
            </p>
          ) : null}
        </div>
      );
    }
    if (step === "stake" && p1) {
      return (
        <TxButton
          run={create}
          successTitle="Fight picked."
          className={cx("btn-primary", compact ? "btn-sm" : "w-full")}
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
      <button type="button" disabled className={cx("btn btn-primary", compact ? "btn-sm" : "w-full")}>
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
                initialKind={params.get("filter") === "247" ? "allday" : "all"}
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
            onRound={pickRound}
            chipNotes={chipNotes}
            roundWhy={
              shortQueued
                ? `Rounds under ${MIN_ROUND_HOURS} hours wait for the open while the exchange is shut: over a shorter round one market could tip the result far more often.`
                : undefined
            }
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
            inviteName={inviteName}
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
