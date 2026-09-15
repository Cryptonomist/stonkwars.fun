"use client";

/* THE TICKET: everything a challenge will say, on one card, beside the button
 * that makes it.
 *
 * Top to bottom it follows the order somebody decides in: the two corners and
 * what each stakes, how much, how long, anything about the hours that changes
 * the fight, the words written on chain with it, who may take it, and then
 * what a win pays, right above the button. From lg it is sticky beside the
 * picker, so changing a fighter never scrolls the button away.
 *
 * It draws and does not decide. The amounts are the ones the transaction will
 * carry (stakeForDollars, worked out by the page); the hours notice and the
 * primary action arrive ready-made, because the page also puts that action in
 * the phone's bottom bar and the two must never disagree.
 *
 * Nothing on it is green or orange. A preview of a win is not money taken, and
 * a warning is ink with a glyph (ui/Notice). Cyan and pink appear only where
 * they name a corner. */

import type { ReactNode, Ref } from "react";

import { Badge } from "@/components/ui/Badge";
import { FlashNum } from "@/components/ui/FlashNum";
import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { Skeleton } from "@/components/ui/Skeleton";
import { Versus } from "@/components/ui/Versus";
import { cx } from "@/components/ui/cx";
import { MAX_TAUNT_LEN } from "@/lib/duel";
import { shares, shortAddress, usd } from "@/lib/format";
import { quoteValue, stakeValue, type Quote } from "@/lib/prices";
import { sourceWords } from "@/lib/pricemath";
import { SPAR_MAX_ROUND_SECS } from "@/lib/spar";
import { byTicker, offHoursWords, sourceLabel, STAKE_DECIMALS, tokenSymbol } from "@/lib/stocks";
import { MAX_STAKE_USD, STAKE_CHIPS, winPreview, type RoundChoice, type RoundId } from "@/lib/ticket";

export type FightTicketProps = {
  p1: string | null;
  p2: string | null;
  q1: Quote | undefined;
  q2: Quote | undefined;
  amount1: bigint;
  amount2: bigint;
  dollars: number;
  onDollars: (n: number) => void;
  rounds: RoundChoice[];
  round: RoundId;
  onRound: (r: RoundId) => void;
  /** Rounds that cannot be taken now, each with why: a queued one says from
   *  when (`sub`), and one nobody could take fairly before it expires is off. */
  chipNotes?: Partial<Record<RoundId, { sub?: string; title: string; off?: boolean }>>;
  /** One line under the chips, while the shorter rounds queue for the open. */
  roundWhy?: string;
  /** One line under the round chips: when this round starts and ends. */
  roundNote: string;
  /** The hours notice, when there is one. */
  notice: ReactNode;
  taunt: string;
  onTaunt: (s: string) => void;
  invite: string;
  onInvite: (s: string) => void;
  inviteOpen: boolean;
  onInviteOpen: (open: boolean) => void;
  inviteError: string | null;
  inviteValid: boolean;
  pricesError: boolean;
  /** What the connected wallet holds of its own stock, and its worth now; null
   *  with no wallet or before the balance is read. */
  held?: { raw: bigint; usd: number | null } | null;
  /** Address the challenge to the sparring wallet; absent when none is offered. */
  onSpar?: () => void;
  /** The challenge is addressed to the sparring wallet, which takes timed rounds up to 24 hours. */
  sparring?: boolean;
  /** The primary action and anything said right under it. */
  action: ReactNode;
  actionRef?: Ref<HTMLDivElement>;
  className?: string;
};

export function FightTicket(t: FightTicketProps) {
  const priced = t.amount1 > BigInt(0) && t.amount2 > BigInt(0);
  const win = t.p1 && t.p2 && priced ? winPreview(t.amount1, t.amount2, t.p1, t.p2, t.q2) : null;
  /* Max is everything the wallet holds of its stock, rounded down to the
   * dollar so the shares it sizes never come to more than are there. */
  const maxUsd = t.held?.usd != null && t.held.usd >= 1 ? Math.min(MAX_STAKE_USD, Math.floor(t.held.usd)) : null;

  return (
    <Plate as="section" notch rope pad="std" aria-label="Fight ticket" className={cx("flex flex-col gap-4", t.className)}>
      <Versus
        left={<Corner side="p1" ticker={t.p1} quote={t.q1} amount={t.amount1} held={t.held} />}
        center={<span className="display text-hud-sm text-ink">VS</span>}
        right={<Corner side="p2" ticker={t.p2} quote={t.q2} amount={t.amount2} />}
        className="items-start"
      />

      <fieldset className="min-w-0">
        <legend className="label">Stake, each side</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {STAKE_CHIPS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={t.dollars === s}
              onClick={() => t.onDollars(s)}
              className={cx("btn btn-sm num", t.dollars === s ? "btn-light" : "btn-ghost")}
            >
              ${s}
            </button>
          ))}
          {maxUsd !== null ? (
            <button
              type="button"
              aria-pressed={t.dollars === maxUsd}
              onClick={() => t.onDollars(maxUsd)}
              className={cx("btn btn-sm", t.dollars === maxUsd ? "btn-light" : "btn-ghost")}
            >
              Max <span className="num">${maxUsd}</span>
            </button>
          ) : null}
          <label className="flex min-w-0 items-center gap-1.5">
            <span className="num text-sm text-dim" aria-hidden="true">
              $
            </span>
            <span className="sr-only">Any stake, in dollars a side</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_STAKE_USD}
              step={1}
              value={t.dollars || ""}
              onChange={(e) => t.onDollars(Math.min(MAX_STAKE_USD, Math.max(0, Number(e.target.value))))}
              className="input num w-20 py-2"
            />
          </label>
        </div>
      </fieldset>

      <div role="group" aria-labelledby="ticket-round" aria-describedby="ticket-round-note" className="min-w-0">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <p id="ticket-round" className="label shrink-0">
            Round
          </p>
          {t.roundNote ? (
            <p id="ticket-round-note" className="min-w-0 text-right text-meta text-dim sm:truncate">
              {t.roundNote}
            </p>
          ) : null}
        </div>
        {/* Six columns: the three short timed rounds take two each, and the
          * two long ones and the two bells three each, so every row fills and
          * the bells' longer end times get the wider chips at every width. */}
        <div className="mt-2 grid grid-cols-6 gap-2">
          {t.rounds.map((r) => {
            const on = t.round === r.id;
            // The sparring wallet takes timed rounds up to a day, not the bells.
            const sparOff = !!t.sparring && !(r.secs && r.secs <= SPAR_MAX_ROUND_SECS);
            // A round that cannot be taken now queues for when it can, and says so; one that never can is off.
            const note = t.chipNotes?.[r.id];
            const off = sparOff || !!note?.off;
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                disabled={off}
                title={sparOff ? "The sparring wallet takes timed rounds, not the bells" : note?.title}
                onClick={() => t.onRound(r.id)}
                className={cx(
                  "btn btn-sm min-w-0 flex-col gap-0.5 px-2",
                  r.endTs || (r.secs ?? 0) >= 43_200 ? "col-span-3" : "col-span-2",
                  on ? "btn-light" : "btn-ghost",
                )}
              >
                <span className="whitespace-nowrap">{r.label}</span>
                <span
                  className={cx(
                    "max-w-full truncate font-sans text-meta font-normal tracking-normal normal-case",
                    on ? "text-void/70" : "text-dim",
                  )}
                >
                  {note?.sub ?? r.sub}
                </span>
              </button>
            );
          })}
        </div>
        {t.roundWhy ? <p className="mt-2 text-meta text-dim">{t.roundWhy}</p> : null}
      </div>

      {t.notice}

      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="ticket-taunt" className="label">
            Taunt
          </label>
          <p id="ticket-taunt-count" className="num text-meta text-dim">
            {t.taunt.length}/{MAX_TAUNT_LEN} · written on chain
          </p>
        </div>
        <input
          id="ticket-taunt"
          value={t.taunt}
          maxLength={MAX_TAUNT_LEN}
          onChange={(e) => t.onTaunt(e.target.value)}
          placeholder={t.p2 ? `${t.p2} is cooked.` : "Say something."}
          aria-describedby="ticket-taunt-count"
          className="input mt-2"
        />
      </div>

      <details open={t.inviteOpen} onToggle={(e) => t.onInviteOpen(e.currentTarget.open)} className="group min-w-0">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-ink [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="num w-3 text-dim group-open:hidden">
            +
          </span>
          <span aria-hidden="true" className="num hidden w-3 text-dim group-open:inline">
            -
          </span>
          Call someone out
          {!t.inviteOpen && t.inviteValid ? (
            <span className="num min-w-0 truncate text-meta text-dim">{t.sparring ? "Sparring wallet" : shortAddress(t.invite.trim())}</span>
          ) : null}
        </summary>
        <div className="mt-2">
          <input
            value={t.invite}
            onChange={(e) => t.onInvite(e.target.value)}
            placeholder="Their wallet address"
            aria-label="Their wallet address"
            aria-invalid={t.inviteError ? true : undefined}
            aria-describedby="ticket-invite-help"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="input num text-sm"
          />
          <p id="ticket-invite-help" className="mt-1 text-meta text-dim">
            {t.inviteError ? (
              <span className="text-ink">
                <span aria-hidden="true" className="micro mr-1.5 inline-flex h-3.5 w-3.5 items-center justify-center bg-ink text-void">
                  x
                </span>
                {t.inviteError}
              </span>
            ) : t.sparring ? (
              "The sparring wallet takes timed challenges addressed to it, up to 24 hours, from its own wallet, within seconds while this page is open. The fight is real and settles like any other; it is left off the ranks."
            ) : (
              "Only that wallet can take it. Leave it empty and anyone with the link can."
            )}
          </p>
        </div>
      </details>
      {/* NOBODY HERE TO FIGHT? A lone visitor cannot take their own challenge,
        * so on devnet the site offers its own disclosed opponent (lib/spar.ts),
        * and only when the owner has set one up. Outside the fold above, so a
        * visitor on their own sees it without opening "Call someone out". */}
      {t.onSpar && !t.sparring ? (
        <button type="button" onClick={t.onSpar} className="btn btn-sm btn-ghost -mt-2 self-start">
          No opponent? Fight the sparring wallet
          <span className="micro text-dim">devnet</span>
        </button>
      ) : null}

      <div className="flex min-w-0 flex-col gap-3 border-t border-line pt-4">
        {t.pricesError ? (
          <Notice tone="error" title="Prices are unavailable right now.">
            Stakes are sized from live prices, so the button waits until they return.
          </Notice>
        ) : null}
        {win ? (
          <div>
            <p className="text-sm text-ink">
              If you win: your <span className="num">{win.keep}</span> back plus their{" "}
              <span className="num">{win.take}</span>
              {win.takeUsd !== null ? (
                <>
                  {" "}
                  (worth <span className="num">{usd(win.takeUsd)}</span> now)
                </>
              ) : null}
              .
            </p>
            <p className="mt-1 text-meta text-dim">An exact tie sends both stakes home.</p>
          </div>
        ) : !t.pricesError ? (
          <div aria-hidden="true" className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-40" />
          </div>
        ) : null}
        <div ref={t.actionRef} className="min-w-0">
          {t.action}
        </div>
        {/* Who prices each side, and for a stock that fights around the clock,
          * what prices it while the exchange is shut. */}
        {t.p1 && t.p2 ? (
          <p className="text-meta text-dim">
            Prices:{" "}
            {[t.p1, t.p2].map((x, i) => {
              const offHours = offHoursWords(x);
              return (
                <span key={x}>
                  {i ? " · " : ""}
                  {x} by {sourceLabel(byTicker(x)!)}
                  {offHours ? `, 24/7 on ${offHours}` : ""}
                </span>
              );
            })}
          </p>
        ) : null}
      </div>
    </Plate>
  );
}

function Corner({
  side,
  ticker,
  quote,
  amount,
  held,
}: {
  side: "p1" | "p2";
  ticker: string | null;
  quote: Quote | undefined;
  amount: bigint;
  held?: { raw: bigint; usd: number | null } | null;
}) {
  const right = side === "p2";
  const stock = ticker ? byTicker(ticker) : null;
  const price = quoteValue(quote);
  const value = stakeValue(amount, STAKE_DECIMALS, quote);
  return (
    <div className={cx("flex min-w-0 flex-col", right && "items-end")}>
      {/* The live price's source rides on the label line, beside the corner it
        * belongs to, so the stake lines under the ticker stay two. On a phone
        * the corner is too narrow for both and the badge wraps under the label
        * rather than running into the VS. */}
      <span className={cx("flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1", right && "flex-row-reverse")}>
        <span className="label shrink-0">{side === "p1" ? "You back" : "They back"}</span>
        {ticker && price !== null && quote?.source ? (
          <Badge variant="source" className="min-w-0">
            {sourceWords(quote.source)}
          </Badge>
        ) : null}
      </span>
      <span
        className={cx(
          "display mt-1 max-w-full truncate text-hud-lg",
          side === "p1" ? "text-p1" : "text-p2",
        )}
      >
        {ticker ?? "?"}
      </span>
      <span className="max-w-full truncate text-meta text-dim">{stock?.name ?? "Pick a fighter"}</span>
      {ticker && amount > BigInt(0) && price !== null ? (
        <>
          <span className="num mt-2 max-w-full truncate text-sm text-ink">
            {shares(amount, STAKE_DECIMALS)} {tokenSymbol(ticker)}
          </span>
          <span className="num max-w-full truncate text-meta text-dim">
            {value !== null ? usd(value) : "--"} at{" "}
            <FlashNum value={price} className="text-ink">
              {usd(price)}
            </FlashNum>
          </span>
          {/* Whether the wallet can cover the stake, before the button says so. */}
          {held ? (
            <span className="num max-w-full truncate text-meta text-dim">
              You hold {shares(held.raw, STAKE_DECIMALS)} {tokenSymbol(ticker)}
              {held.usd !== null && held.raw > BigInt(0) ? ` · ${usd(held.usd)}` : ""}
            </span>
          ) : null}
        </>
      ) : ticker ? (
        <span className={cx("mt-2 flex flex-col gap-1.5", right && "items-end")} aria-hidden="true">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-28" />
        </span>
      ) : null}
    </div>
  );
}
