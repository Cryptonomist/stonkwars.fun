"use client";

/* Pick a fight: your stock, theirs, the stake, the round.
 *
 * Both stakes are fixed here and sized to the same dollar value at the live
 * price, in integers (see `stakeForDollars`). Whoever accepts takes these
 * exact terms or leaves them. */

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { FaucetButton } from "@/components/FaucetButton";
import { StockPicker } from "@/components/StockPicker";
import { TaleOfTheTape } from "@/components/TaleOfTheTape";
import { useSend, useTokenBalance } from "@/lib/hooks";
import { ataFor, buildCreateDuel, MAX_TAUNT_LEN, randomSeed, readableProgramError } from "@/lib/duel";
import { etTime, shares, span, usd } from "@/lib/format";
import { nextBell, session, weekBell } from "@/lib/market";
import { OFFHOURS_WINDOW } from "@/lib/oracle";
import { quoteValue, stakeForDollars, stakeValue, usePrices } from "@/lib/prices";
import {
  AROUND_THE_CLOCK,
  byTicker,
  CLUSTER,
  pricedAt,
  sourceLabel,
  STAKE_DECIMALS,
  stakeAssetFor,
  tokenSymbol,
} from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

type Round = "5m" | "15m" | "1h" | "bell" | "week";

const ROUNDS: { id: Round; label: string; secs?: number }[] = [
  { id: "5m", label: "5 min", secs: 300 },
  { id: "15m", label: "15 min", secs: 900 },
  { id: "1h", label: "1 hour", secs: 3_600 },
  { id: "bell", label: "Next bell" },
  { id: "week", label: "Friday bell" },
];

const STAKES = [10, 25, 50, 100];

export function CreateFight() {
  const params = useSearchParams();
  const router = useRouter();
  const { publicKey } = useWallet();
  const send = useSend();
  const now = useNow(5_000);

  const [p1, setP1] = useState<string | null>(byTicker(params.get("p1") ?? "")?.ticker ?? "TSLA");
  const [p2, setP2] = useState<string | null>(byTicker(params.get("p2") ?? "")?.ticker ?? "NVDA");
  const prices = usePrices([p1, p2]);
  const [dollars, setDollars] = useState<number>(Number(params.get("usd")) || 25);
  const [round, setRound] = useState<Round>("15m");
  const [taunt, setTaunt] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q1 = p1 ? prices.data?.quotes[p1] : undefined;
  const q2 = p2 ? prices.data?.quotes[p2] : undefined;
  const cents = BigInt(Math.round(dollars * 100));
  const amount1 = q1 ? stakeForDollars(cents, q1, STAKE_DECIMALS) : BigInt(0);
  const amount2 = q2 ? stakeForDollars(cents, q2, STAKE_DECIMALS) : BigInt(0);

  const asset1 = p1 ? stakeAssetFor(p1) : null;
  const asset2 = p2 ? stakeAssetFor(p2) : null;
  const myAta = publicKey && asset1 ? ataFor(publicKey, asset1.mint, asset1.tokenProgram) : null;
  const balance = useTokenBalance(myAta);

  const roundDef = ROUNDS.find((r) => r.id === round)!;
  const endTs = useMemo(() => {
    if (!now || roundDef.secs) return 0;
    return round === "bell" ? nextBell(now * 1000) : weekBell(now * 1000);
  }, [now, round, roundDef.secs]);

  const marketNow = now ? session(now * 1000) : "open";

  /* Where each side's price would come from when this round ends. A stock
   * whose exchange is shut and whose token has no pool deep enough to read
   * will not settle until the market opens, and saying so before somebody
   * stakes is the whole point of working it out here. */
  const endsAt = endTs || (now ? now + (roundDef.secs ?? 0) : 0);
  const sides = [p1, p2].filter((t): t is string => !!t);
  const waiting = endsAt ? sides.filter((t) => pricedAt(t, endsAt) === "waits") : [];
  const onPools = endsAt ? sides.filter((t) => pricedAt(t, endsAt) === "pool") : [];
  const short = balance.data !== undefined && balance.data !== null && balance.data < amount1;
  const noAccount = balance.data === null;

  let inviteKey: PublicKey | undefined;
  let inviteError: string | null = null;
  if (invite.trim()) {
    try {
      inviteKey = new PublicKey(invite.trim());
    } catch {
      inviteError = "That is not a Solana address.";
    }
  }

  const ready =
    !!publicKey && !!p1 && !!p2 && !!asset1 && !!asset2 && amount1 > BigInt(0) && amount2 > BigInt(0) &&
    !short && !noAccount && !inviteError && !busy;

  async function submit() {
    if (!publicKey || !asset1 || !asset2) return;
    setBusy(true);
    setError(null);
    try {
      const seed = randomSeed();
      const nowSecs = Math.floor(Date.now() / 1000);
      const fixedEnd = roundDef.secs ? 0 : endTs;
      // A fixed-end challenge must close before the last minute of the round;
      // a timed one can wait up to a week for a taker.
      const expiresTs = fixedEnd ? Math.min(fixedEnd - 5 * 60, nowSecs + 7 * 86_400) : nowSecs + 7 * 86_400;
      const { instruction, duel } = buildCreateDuel({
        creator: publicKey,
        seed,
        creatorAsset: asset1,
        opponentAsset: asset2,
        creatorAmount: amount1,
        opponentAmount: amount2,
        durationSecs: roundDef.secs ?? 0,
        endTs: fixedEnd,
        expiresTs,
        invitee: inviteKey,
        taunt: taunt.trim(),
      });
      await send([instruction]);
      router.push(`/f/${duel.toBase58()}?new=1`);
    } catch (e) {
      setError(readableProgramError(e));
      setBusy(false);
    }
  }

  return (
    <div className="py-10">
      <p className="label">New fight</p>
      <h1 className="display mt-2 text-6xl sm:text-7xl">Pick a fight</h1>
      <p className="mt-3 max-w-2xl text-dim">
        Back a stock with real shares. Name the stock you think it beats. Whoever takes the other side
        stakes theirs, and the bigger move by the end of the round wins both stakes.
      </p>

      <section className="mt-10">
        <h2 className="display text-3xl">
          <span className="text-p1">Your fighter</span>
        </h2>
        <div className="mt-3">
          <StockPicker side="p1" value={p1} taken={p2} onChange={setP1} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="display text-3xl">
          <span className="text-p2">Their fighter</span>
        </h2>
        <div className="mt-3">
          <StockPicker side="p2" value={p2} taken={p1} onChange={setP2} />
        </div>
      </section>

      <TaleOfTheTape p1={p1} p2={p2} />

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="display text-3xl">Stake, each side</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {STAKES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDollars(s)}
                className={`btn btn-sm ${dollars === s ? "btn-light" : "btn-ghost"}`}
              >
                ${s}
              </button>
            ))}
            <label className="flex items-center gap-2">
              <span className="text-dim">$</span>
              <input
                type="number"
                min={1}
                max={10_000}
                value={dollars}
                onChange={(e) => setDollars(Math.max(0, Number(e.target.value)))}
                className="input w-28 font-mono"
              />
            </label>
          </div>
        </section>

        <section>
          <h2 className="display text-3xl">Round</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {ROUNDS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRound(r.id)}
                className={`btn btn-sm ${round === r.id ? "btn-light" : "btn-ghost"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-dim">
            {roundDef.secs
              ? `Runs ${span(roundDef.secs)} from the first prices after they accept.`
              : endTs
                ? `Ends at the first prices after ${etTime(endTs)}.`
                : ""}
          </p>
          {waiting.length ? (
            <p className="mt-2 text-sm text-cooked">
              The exchange is shut, and {waiting.join(" and ")}{" "}
              {waiting.length === 1 ? "is priced by it" : "are priced by it"}, so this fight would sit until trading
              resumes. {AROUND_THE_CLOCK ? `${AROUND_THE_CLOCK} stocks fight around the clock if you want one now.` : ""}
            </p>
          ) : onPools.length ? (
            <>
              <p className="mt-2 text-sm text-up">
                The exchange is shut, so {onPools.join(" and ")} settle on their own Solana pools. This fight runs now.
              </p>
              {roundDef.secs && roundDef.secs < OFFHOURS_WINDOW * 60 ? (
                <p className="mt-2 text-sm text-dim">
                  An out-of-hours price is read from the last {OFFHOURS_WINDOW} minutes on the pool, which is what makes
                  it hard to push. A round shorter than that shares most of its window with its own start, so it settles
                  on the move across {OFFHOURS_WINDOW} minutes rather than {span(roundDef.secs)}. A real fight either
                  way; just not the one the clock says.
                </p>
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="display text-3xl">Talk your talk</h2>
          <input
            value={taunt}
            maxLength={MAX_TAUNT_LEN}
            onChange={(e) => setTaunt(e.target.value)}
            placeholder={p2 ? `${p2} is cooked.` : "Say something."}
            className="input mt-3"
          />
          <p className="mt-1 text-right text-xs text-dim">
            {taunt.length}/{MAX_TAUNT_LEN} · written on chain with the fight
          </p>
        </section>
        <section>
          <h2 className="display text-3xl">Call someone out <span className="text-base text-dim">(optional)</span></h2>
          <input
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder="Their wallet address. Leave empty and anyone with the link can take it."
            className="input mt-3 font-mono text-sm"
          />
          {inviteError ? <p className="mt-1 text-xs text-down">{inviteError}</p> : null}
        </section>
      </div>

      <section className="card mt-10 p-5 sm:p-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <Side ticker={p1} side="p1" amount={amount1} value={stakeValue(amount1, STAKE_DECIMALS, q1)} price={quoteValue(q1)} />
          <span className="display text-4xl text-ink">VS</span>
          <Side ticker={p2} side="p2" amount={amount2} value={stakeValue(amount2, STAKE_DECIMALS, q2)} price={quoteValue(q2)} align="right" />
        </div>
        {taunt.trim() ? <p className="mt-5 text-center text-lg italic">&ldquo;{taunt.trim()}&rdquo;</p> : null}
        <p className="mt-5 text-center text-sm text-dim">
          Winner takes both stakes, paid in shares. An exact tie gives each side its own stake back.
        </p>
        {p1 && p2 ? (
          <p className="mt-1 text-center text-xs text-dim">
            Prices: {[p1, p2].map((t) => `${t} by ${sourceLabel(byTicker(t)!)}`).join(" · ")}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col items-center gap-3">
          {!publicKey ? (
            <p className="text-sm text-ink">Connect a wallet to pick this fight.</p>
          ) : noAccount || short ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-ink">
                You need {shares(amount1, STAKE_DECIMALS)} {p1 ? tokenSymbol(p1) : ""} to stake.
              </p>
              {CLUSTER !== "mainnet-beta" && p1 ? (
                <FaucetButton tickers={[p1]} label={`Get test ${tokenSymbol(p1)}`} />
              ) : null}
            </div>
          ) : null}
          {prices.data?.error ? (
            <p className="text-sm text-down">Prices are unavailable: {prices.data.error}</p>
          ) : null}
          <button type="button" disabled={!ready} onClick={submit} className="btn btn-p1 px-10 text-xl">
            {busy ? "Signing..." : `Stake ${shares(amount1, STAKE_DECIMALS)} ${p1 ? tokenSymbol(p1) : ""} and get the link`}
          </button>
          {error ? <p className="max-w-lg text-center text-sm text-down">{error}</p> : null}
        </div>
      </section>
    </div>
  );
}

function Side({
  ticker,
  side,
  amount,
  value,
  price,
  align = "left",
}: {
  ticker: string | null;
  side: "p1" | "p2";
  amount: bigint;
  value: number | null;
  price: number | null;
  align?: "left" | "right";
}) {
  const stock = ticker ? byTicker(ticker) : null;
  return (
    <div className={`flex flex-col ${align === "right" ? "items-end text-right" : "items-start"}`}>
      <span className="label">{side === "p1" ? "You back" : "They back"}</span>
      <span className={`display text-6xl sm:text-7xl ${side === "p1" ? "text-p1" : "text-p2"}`}>
        {ticker ?? "?"}
      </span>
      <span className="text-sm text-dim">{stock?.name}</span>
      <span className="mt-2 font-mono text-sm">
        {shares(amount, STAKE_DECIMALS)} {ticker ? tokenSymbol(ticker) : ""}
      </span>
      <span className="font-mono text-xs text-dim">
        {value !== null ? usd(value) : "--"} {price !== null ? `at ${usd(price)}` : ""}
      </span>
    </div>
  );
}
