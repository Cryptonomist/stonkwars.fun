/* WHAT THE DUEL LIST SAYS, WORKED OUT ONCE.
 *
 * Every board on the site reads the same list of duel accounts: the profile,
 * the leaderboard, the Wire, toasts, stock records, the home page. Each used to
 * redo its own arithmetic over it, and two pages that disagree about a record
 * make both look invented. So the readings live here, as plain functions of
 * that list and a clock, with no React and no fetching, and a test can hand
 * them a fixture and pin the answer.
 *
 * Nothing here makes a number up. A result is an outcome the program wrote; an
 * amount is a stake the program holds or paid; a dollar figure is a stake at
 * the price the program recorded when it settled; a time is a timestamp on the
 * account. Where the account cannot say something (when a stalled fight was
 * refunded, say) the reading picks the nearest thing it does record and the
 * comment says so. */

import {
  OUTCOME_CREATOR,
  OUTCOME_OPPONENT,
  OUTCOME_TIE,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
  type DuelView,
} from "./duel";
import { pythToNumber } from "./format";
import { movePct } from "./pricemath";
import { decimalsForMint, isListedDuel, tickerForMint } from "./stocks";

export type Side = "p1" | "p2";
export type Result = "W" | "L" | "T";

/** The default key, as base58: an empty opponent or invitee slot. */
const EMPTY_KEY = "11111111111111111111111111111111";
const keyOrNull = (k: { toBase58(): string }) => {
  const s = k.toBase58();
  return s === EMPTY_KEY ? null : s;
};

/* ─── One fight ───────────────────────────────────────────────────────────── */

/** Both sides are listed stocks on this cluster's roster. The same test the
 *  duel list applies before any board sees it (lib/stocks isListedDuel), under
 *  the name boards use, for lists that did not come through that filter: a
 *  server read, or a profile counting the test fights it keeps out of view. */
export const isRosterFight = (d: Pick<DuelView, "creatorMint" | "opponentMint">): boolean => isListedDuel(d);

/** A fight the program decided one way or the other. */
export const isDecided = (d: DuelView) =>
  d.status === STATUS_SETTLED && (d.outcome === OUTCOME_CREATOR || d.outcome === OUTCOME_OPPONENT);

/** A dead heat: both moves identical at the bell, both stakes home. */
export const isDeadHeat = (d: DuelView) => d.status === STATUS_REFUNDED && d.outcome === OUTCOME_TIE;

/** Voided at the start, or refunded after one: both stakes home, no result. */
export const isVoided = (d: DuelView) =>
  d.status === STATUS_VOID || (d.status === STATUS_REFUNDED && d.outcome !== OUTCOME_TIE);

export type Take = {
  /** Base units of the loser's token. */
  shares: bigint;
  decimals: number;
  ticker: string;
  /** The loser's stake at the loser's own end price, as the program recorded it. */
  usd: number;
};

/* WHAT A WIN WAS WORTH. The winner is paid the loser's stake in the loser's
 * shares, so the honest dollar figure is those shares at the price that ended
 * the fight, not at today's. `decimals` defaults to the mint's own. */
export function loserTake(d: DuelView, decimals?: number): Take | null {
  if (!isDecided(d)) return null;
  const creatorWon = d.outcome === OUTCOME_CREATOR;
  const raw = creatorWon ? d.opponentAmount : d.creatorAmount;
  const mint = creatorWon ? d.opponentMint : d.creatorMint;
  const end = creatorWon ? d.opponentEnd : d.creatorEnd;
  const dp = decimals ?? decimalsForMint(mint);
  return {
    shares: raw,
    decimals: dp,
    ticker: tickerForMint(mint) ?? "?",
    usd: (Number(raw) / 10 ** dp) * pythToNumber(end.price, end.expo),
  };
}

/** Each side's move from its on-chain start to its on-chain end, in percent,
 *  or null until both ends are on the account. */
export function moves(d: DuelView): [number, number] | null {
  const posted = (p: { price: bigint }) => p.price > BigInt(0);
  if (![d.creatorStart, d.creatorEnd, d.opponentStart, d.opponentEnd].every(posted)) return null;
  return [movePct(d.creatorStart, d.creatorEnd), movePct(d.opponentStart, d.opponentEnd)];
}

/** The gap between the two on-chain moves, in percentage points, or null. */
export function margin(d: DuelView): number | null {
  const m = moves(d);
  return m ? Math.abs(m[0] - m[1]) : null;
}

export const winnerSide = (d: DuelView): Side | undefined =>
  !isDecided(d) ? undefined : d.outcome === OUTCOME_CREATOR ? "p1" : "p2";

/* ─── The Wire ────────────────────────────────────────────────────────────── */

export type FightEventKind = "opened" | "taken" | "live" | "bell" | "heat" | "void" | "expired";

export type FightEvent = {
  /** address + ":" + kind, stable across polls, so a board can tell what is new. */
  id: string;
  kind: FightEventKind;
  /** Unix seconds, from the account. */
  at: number;
  address: string;
  creator: string;
  opponent: string | null;
  invitee: string | null;
  t1: string;
  t2: string;
  taunt: string;
  winnerSide?: Side;
  margin?: number;
  take?: Take;
};

/* Later in a fight's life sorts first when two events share a second, so a
 * fight taken and started in the same block reads "live" above "taken". */
const LIFECYCLE: Record<FightEventKind, number> = {
  opened: 0,
  taken: 1,
  live: 2,
  expired: 3,
  void: 3,
  heat: 4,
  bell: 4,
};

/* EVERY STEP A FIGHT TOOK, NEWEST FIRST, each at the time the account records.
 *
 * Cancelled fights close their account, so they are not in the list and cannot
 * appear here: a challenge withdrawn before anyone took it simply leaves no
 * trace on the Wire, which is what the chain says too.
 *
 * A voided fight was voided when its start prices posted, which the account
 * keeps as startTs. One refunded after stalling before it ever started has no
 * start, and the account does not record the refund's time, so it falls back
 * to the latest time it does have. */
export function fightEvents(
  duels: DuelView[],
  now: number,
  { rosterOnly = true }: { rosterOnly?: boolean } = {},
): FightEvent[] {
  const out: FightEvent[] = [];
  for (const d of duels) {
    if (rosterOnly && !isRosterFight(d)) continue;
    const address = d.address.toBase58();
    const base = {
      address,
      creator: d.creator.toBase58(),
      opponent: keyOrNull(d.opponent),
      invitee: keyOrNull(d.invitee),
      t1: tickerForMint(d.creatorMint) ?? "?",
      t2: tickerForMint(d.opponentMint) ?? "?",
      taunt: d.taunt,
    };
    const push = (kind: FightEventKind, at: number, extra: Partial<FightEvent> = {}) => {
      if (at > 0) out.push({ id: `${address}:${kind}`, kind, at, ...base, ...extra });
    };

    push("opened", d.createdTs);
    if (d.acceptedTs > 0 && base.opponent) push("taken", d.acceptedTs);

    const wentLive = d.status === STATUS_LIVE || isDecided(d) || isDeadHeat(d);
    if (wentLive) push("live", d.startTs);

    if (isDecided(d)) {
      push("bell", d.endTs, {
        winnerSide: winnerSide(d),
        margin: margin(d) ?? undefined,
        take: loserTake(d) ?? undefined,
      });
    } else if (isDeadHeat(d)) {
      push("heat", d.endTs, { margin: margin(d) ?? undefined });
    } else if (isVoided(d)) {
      const latest = Math.max(d.acceptedTs, d.startTs > 0 ? d.startTs : d.endTs);
      push("void", now > 0 ? Math.min(now, latest) : latest);
    } else if (d.status === STATUS_OPEN && now > 0 && d.expiresTs <= now) {
      push("expired", d.expiresTs);
    }
  }
  return out.sort((a, b) => b.at - a.at || LIFECYCLE[b.kind] - LIFECYCLE[a.kind] || a.id.localeCompare(b.id));
}

/* ─── A fighter's record ──────────────────────────────────────────────────── */

export type FighterRecord = {
  wins: number;
  losses: number;
  ties: number;
  /** Dollars taken off opponents, each at the loser's end price. */
  taken: number;
  /** Dollars of this wallet's own stake lost, each at its own end price. */
  lost: number;
  /** Wins in a row, counting back from the latest result. A tie ends a run. */
  streak: number;
  /** The longest run of wins. */
  best: number;
  /** The last 10 results, oldest first. */
  form: Result[];
  /** Fights with a result: wins, losses and dead heats. */
  fights: number;
  /** When the latest result landed, or 0. */
  lastTs: number;
};

const emptyRecord = (): FighterRecord => ({
  wins: 0,
  losses: 0,
  ties: 0,
  taken: 0,
  lost: 0,
  streak: 0,
  best: 0,
  form: [],
  fights: 0,
  lastTs: 0,
});

/** Fights with a result on chain, oldest first, so a streak is counted the way
 *  it happened. Ties in time break by address, so the order never flickers. */
function results(duels: DuelView[]): DuelView[] {
  return duels
    .filter((d) => isDecided(d) || isDeadHeat(d))
    .sort((a, b) => a.endTs - b.endTs || a.address.toBase58().localeCompare(b.address.toBase58()));
}

/* EVERY WALLET WITH A RESULT, IN ONE PASS. The leaderboard, a profile and the
 * home rail all read from this, which is what makes the same wallet show the
 * same record on each. `decimals` overrides each mint's own, for callers that
 * have always passed one. */
export function recordsByWallet(duels: DuelView[], decimals?: number): Map<string, FighterRecord> {
  const table = new Map<string, FighterRecord>();
  const row = (wallet: string) => {
    let r = table.get(wallet);
    if (!r) {
      r = emptyRecord();
      table.set(wallet, r);
    }
    return r;
  };
  const note = (r: FighterRecord, result: Result, at: number) => {
    r.fights++;
    r.form.push(result);
    if (r.form.length > 10) r.form.shift();
    r.lastTs = Math.max(r.lastTs, at);
  };

  for (const d of results(duels)) {
    const creator = d.creator.toBase58();
    const opponent = d.opponent.toBase58();
    if (isDeadHeat(d)) {
      for (const w of [creator, opponent]) {
        const r = row(w);
        r.ties++;
        r.streak = 0;
        note(r, "T", d.endTs);
      }
      continue;
    }
    const take = loserTake(d, decimals)!;
    const creatorWon = d.outcome === OUTCOME_CREATOR;
    const w = row(creatorWon ? creator : opponent);
    w.wins++;
    w.taken += take.usd;
    w.streak++;
    w.best = Math.max(w.best, w.streak);
    note(w, "W", d.endTs);

    const l = row(creatorWon ? opponent : creator);
    l.losses++;
    l.lost += take.usd;
    l.streak = 0;
    note(l, "L", d.endTs);
  }
  return table;
}

/** One wallet's record over every fight with a result in `duels`. */
export function recordFor(wallet: string, duels: DuelView[]): FighterRecord {
  const mine = duels.filter((d) => d.creator.toBase58() === wallet || d.opponent.toBase58() === wallet);
  return recordsByWallet(mine).get(wallet) ?? emptyRecord();
}

/* ─── What a record is made of ────────────────────────────────────────────── */

export type BestWin = {
  address: string;
  /** The stock in the winner's corner, and the one it beat. */
  ticker: string;
  against: string;
  /** Percentage points between the two on-chain moves. */
  margin: number | null;
  usd: number;
  endTs: number;
};

export type FavouriteStock = { ticker: string; fights: number; wins: number; losses: number; ties: number };

export type Highlights = { bestWin: BestWin | null; favourite: FavouriteStock | null };

/* THE TWO LINES A BOARD ROW WAS MISSING. A leaderboard row said how much a
 * wallet had taken but not from which fight, and a podium card held one
 * dollar figure in a card 450px wide. For every wallet with a result: its
 * biggest win by money taken (the later one on a tie, so a rematch that paid
 * the same shows), and the stock it put in its own corner most often, with how
 * that stock did for it. Read from the same fights with a result as
 * recordsByWallet, so the numbers agree with the record beside them. */
export function highlightsByWallet(duels: DuelView[], decimals?: number): Map<string, Highlights> {
  const best = new Map<string, BestWin>();
  const favs = new Map<string, Map<string, FavouriteStock>>();
  const fav = (wallet: string, ticker: string) => {
    let byTicker = favs.get(wallet);
    if (!byTicker) favs.set(wallet, (byTicker = new Map()));
    let f = byTicker.get(ticker);
    if (!f) byTicker.set(ticker, (f = { ticker, fights: 0, wins: 0, losses: 0, ties: 0 }));
    return f;
  };

  for (const d of results(duels)) {
    const t1 = tickerForMint(d.creatorMint) ?? "?";
    const t2 = tickerForMint(d.opponentMint) ?? "?";
    const creator = d.creator.toBase58();
    const opponent = d.opponent.toBase58();
    if (isDeadHeat(d)) {
      for (const [wallet, ticker] of [
        [creator, t1],
        [opponent, t2],
      ] as const) {
        const f = fav(wallet, ticker);
        f.fights++;
        f.ties++;
      }
      continue;
    }
    const creatorWon = d.outcome === OUTCOME_CREATOR;
    const [winner, loser] = creatorWon ? [creator, opponent] : [opponent, creator];
    const [wt, lt] = creatorWon ? [t1, t2] : [t2, t1];
    const w = fav(winner, wt);
    w.fights++;
    w.wins++;
    const l = fav(loser, lt);
    l.fights++;
    l.losses++;

    const take = loserTake(d, decimals)!;
    const had = best.get(winner);
    if (!had || take.usd >= had.usd) {
      best.set(winner, { address: d.address.toBase58(), ticker: wt, against: lt, margin: margin(d), usd: take.usd, endTs: d.endTs });
    }
  }

  const out = new Map<string, Highlights>();
  for (const [wallet, byTicker] of favs) {
    const favourite =
      [...byTicker.values()].sort((a, b) => b.fights - a.fights || b.wins - a.wins || a.ticker.localeCompare(b.ticker))[0] ?? null;
    out.set(wallet, { bestWin: best.get(wallet) ?? null, favourite });
  }
  return out;
}

/** Wins over fights with a result, 0 to 1; 0 with no results. */
export const winRate = (r: Pick<FighterRecord, "wins" | "fights">) => (r.fights > 0 ? r.wins / r.fights : 0);

/* ─── A stock's record ────────────────────────────────────────────────────── */

export type TickerRecord = {
  /** Fights with a result that had this stock in a corner. */
  fights: number;
  wins: number;
  losses: number;
  ties: number;
  /** Challenges with this stock still waiting for a taker (unexpired when `now` is given). */
  open: number;
};

/** How a stock has done in roster fights, whichever corner it was in. A win
 *  means its side won. */
export function tickerRecord(ticker: string, duels: DuelView[], now = 0): TickerRecord {
  const out: TickerRecord = { fights: 0, wins: 0, losses: 0, ties: 0, open: 0 };
  for (const d of duels) {
    if (!isRosterFight(d)) continue;
    const t1 = tickerForMint(d.creatorMint);
    const t2 = tickerForMint(d.opponentMint);
    const side: Side | null = t1 === ticker ? "p1" : t2 === ticker ? "p2" : null;
    if (!side) continue;
    if (d.status === STATUS_OPEN && (now <= 0 || d.expiresTs > now)) out.open++;
    // Two issuers' tokens of one stock can meet; that fight says nothing about the stock.
    if (t1 === t2) continue;
    if (isDeadHeat(d)) {
      out.fights++;
      out.ties++;
    } else if (isDecided(d)) {
      out.fights++;
      if (winnerSide(d) === side) out.wins++;
      else out.losses++;
    }
  }
  return out;
}

/* ─── Who a fighter meets ─────────────────────────────────────────────────── */

export type Rival = { wallet: string; fights: number; wins: number; losses: number; ties: number; lastTs: number };

/** The five wallets this one has fought most, with its record against each.
 *  A fight counts once somebody took it; the record counts results only. */
export function headToHead(wallet: string, duels: DuelView[]): Rival[] {
  const table = new Map<string, Rival>();
  for (const d of duels) {
    const creator = d.creator.toBase58();
    const opponent = keyOrNull(d.opponent);
    if (!opponent || (creator !== wallet && opponent !== wallet)) continue;
    const other = creator === wallet ? opponent : creator;
    if (other === wallet) continue;
    let r = table.get(other);
    if (!r) {
      r = { wallet: other, fights: 0, wins: 0, losses: 0, ties: 0, lastTs: 0 };
      table.set(other, r);
    }
    r.fights++;
    r.lastTs = Math.max(r.lastTs, d.endTs || d.acceptedTs || d.createdTs);
    if (isDeadHeat(d)) r.ties++;
    else if (isDecided(d)) {
      const mySide: Side = creator === wallet ? "p1" : "p2";
      if (winnerSide(d) === mySide) r.wins++;
      else r.losses++;
    }
  }
  return [...table.values()]
    .sort((a, b) => b.fights - a.fights || b.lastTs - a.lastTs || a.wallet.localeCompare(b.wallet))
    .slice(0, 5);
}

/* ─── Records ─────────────────────────────────────────────────────────────── */

export type Records = {
  /** The narrowest real margin. A margin of exactly zero is a dead heat, which
   *  is not a finish at all, so it is left out. */
  closest: { address: string; margin: number } | null;
  /** The winning side's move with the largest size, up or down: a winner can
   *  win by falling less. */
  biggestMove: { address: string; ticker: string; move: number } | null;
  longestStreak: { wallet: string; best: number } | null;
};

export function records(duels: DuelView[], skipWallet?: (wallet: string) => boolean): Records {
  let closest: Records["closest"] = null;
  let biggestMove: Records["biggestMove"] = null;
  for (const d of duels) {
    if (!isDecided(d)) continue;
    const m = moves(d);
    if (!m) continue;
    const address = d.address.toBase58();
    const gap = Math.abs(m[0] - m[1]);
    if (gap > 0 && (!closest || gap < closest.margin)) closest = { address, margin: gap };
    const side = winnerSide(d)!;
    const move = side === "p1" ? m[0] : m[1];
    if (!biggestMove || Math.abs(move) > Math.abs(biggestMove.move)) {
      biggestMove = {
        address,
        ticker: tickerForMint(side === "p1" ? d.creatorMint : d.opponentMint) ?? "?",
        move,
      };
    }
  }

  let longestStreak: Records["longestStreak"] = null;
  for (const [wallet, r] of recordsByWallet(duels)) {
    /* A wallet left off the ranks (the sparring wallet) holds no record either. */
    if (skipWallet?.(wallet)) continue;
    if (r.best > 0 && (!longestStreak || r.best > longestStreak.best)) longestStreak = { wallet, best: r.best };
  }
  return { closest, biggestMove, longestStreak };
}

/* ─── Time ────────────────────────────────────────────────────────────────── */

/** When the latest bell rang on a fight with a result, or 0 if none has. Quiet
 *  boards say "Last bell 3h ago" from this rather than showing a zero. */
export function lastBell(duels: DuelView[]): number {
  let latest = 0;
  for (const d of duels) if ((isDecided(d) || isDeadHeat(d)) && d.endTs > latest) latest = d.endTs;
  return latest;
}

/** Open challenges only `wallet` may take, still inside their window. */
export function calledOut(wallet: string, duels: DuelView[], now: number): DuelView[] {
  return duels.filter(
    (d) =>
      d.status === STATUS_OPEN && d.invitee.toBase58() === wallet && (now <= 0 || d.expiresTs > now),
  );
}

/** Fights whose bell is inside the last `secs` (or still ahead). */
export function inWindow(duels: DuelView[], secs: number, now: number): DuelView[] {
  return duels.filter((d) => d.endTs > 0 && d.endTs >= now - secs);
}

/** Still in play: open, taken, or live. */
export const isActive = (d: DuelView) =>
  d.status === STATUS_OPEN || d.status === STATUS_ACCEPTED || d.status === STATUS_LIVE;
