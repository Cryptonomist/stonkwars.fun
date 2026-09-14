/* THE RECEIPT: every step a fight took on chain, who signed it, and where to
 * check.
 *
 * The program emits an event for each step (DuelCreated, DuelAccepted,
 * DuelStarted, DuelSettled, DuelRefunded, DuelVoided, DuelCancelled), and
 * Anchor writes each into the transaction's logs as a "Program data: " line.
 * Reading those back, rather than guessing from which instruction ran, is what
 * lets the page say "Settled by 7xKX...", with the transaction to prove it.
 *
 * One transaction can carry more than one fight: the settler runs its jobs
 * together. So an event counts only when it names this duel.
 *
 * Pure: a transaction as the RPC returns it in, rows out, so the tests can
 * hand it a log line built with the same coder. */

import { coder, type DuelView } from "./duel";

export const EVENT_KINDS = [
  "DuelCreated",
  "DuelAccepted",
  "DuelStarted",
  "DuelSettled",
  "DuelRefunded",
  "DuelVoided",
  "DuelCancelled",
] as const;

export type ReceiptKind = (typeof EVENT_KINDS)[number];

export type ReceiptEvent = {
  kind: ReceiptKind;
  /** Unix seconds, as the cluster recorded the block; null if it did not. */
  blockTime: number | null;
  /** The first account key: whoever paid for, and signed, the transaction. */
  feePayer: string | null;
  signature: string;
  /** The event's fields, pubkeys as base58 and integers as numbers. */
  data: Record<string, string | number | boolean>;
  /** What the whole transaction paid the network, in lamports, as the cluster
   *  recorded it; null when the node did not say. */
  fee: number | null;
  /** The slot the transaction landed in; null when the node did not say. */
  slot: number | null;
  /** Other fights whose events ride in the same transaction (a settler batch),
   *  so a fee is never passed off as this fight's alone. */
  sharedWith: number;
};

/** The parts of a getTransaction answer this reads, legacy or versioned. */
export type TxLike = {
  blockTime?: number | null;
  slot?: number | null;
  meta?: { err?: unknown; fee?: number | null; logMessages?: string[] | null } | null;
  transaction: {
    signatures: string[];
    message: { staticAccountKeys?: { toBase58(): string }[]; accountKeys?: { toBase58(): string }[] };
  };
};

const PREFIX = "Program data: ";
type Decoded = { name: string; data: Record<string, unknown> };
const KINDS = new Set<string>(EVENT_KINDS);

/* Anchor hands back pubkeys as PublicKey and integers as BN. A row wants
 * strings it can link and numbers it can format. */
function plain(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value && typeof value === "object") {
    const v = value as { toBase58?: () => string; toString?: () => string; words?: unknown };
    if (typeof v.toBase58 === "function") return v.toBase58();
    if ("words" in v && typeof v.toString === "function") {
      const n = Number(v.toString());
      return Number.isSafeInteger(n) ? n : v.toString();
    }
  }
  return undefined;
}

/** The fight event in a transaction's logs, or null. With `duel`, only an event
 *  that names that duel counts. A failed transaction changed nothing and emits
 *  nothing worth listing. */
export function classifyTx(tx: TxLike | null | undefined, duel?: string): ReceiptEvent | null {
  if (!tx || tx.meta?.err) return null;
  const logs = tx.meta?.logMessages ?? [];
  /* Every fight event in the transaction first, so the one that names this
   * duel can say how many other fights paid into the same fee. */
  const found: { kind: ReceiptKind; data: ReceiptEvent["data"] }[] = [];
  for (const line of logs) {
    if (!line.startsWith(PREFIX)) continue;
    let decoded: Decoded | null;
    try {
      decoded = coder.events.decode(line.slice(PREFIX.length)) as Decoded | null;
    } catch {
      /* Another program's data, or not base64 at all. */
      continue;
    }
    if (!decoded || !KINDS.has(decoded.name)) continue;
    const data: ReceiptEvent["data"] = {};
    for (const [k, v] of Object.entries(decoded.data ?? {})) {
      const p = plain(v);
      if (p !== undefined) data[k] = p;
    }
    found.push({ kind: decoded.name as ReceiptKind, data });
  }
  const hit = found.find((e) => !duel || e.data.duel === duel);
  if (!hit) return null;
  const others = new Set(found.map((e) => e.data.duel).filter((k) => k !== hit.data.duel));
  const keys = tx.transaction.message.staticAccountKeys ?? tx.transaction.message.accountKeys ?? [];
  const fee = tx.meta?.fee;
  return {
    kind: hit.kind,
    blockTime: tx.blockTime ?? null,
    feePayer: keys[0]?.toBase58() ?? null,
    signature: tx.transaction.signatures[0] ?? "",
    data: hit.data,
    fee: typeof fee === "number" && Number.isFinite(fee) ? fee : null,
    slot: typeof tx.slot === "number" ? tx.slot : null,
    sharedWith: others.size,
  };
}

export type ReceiptStep = "called" | "taken" | "started" | "voided" | "settled" | "refunded" | "cancelled" | "bell";

export type ReceiptRow = {
  step: ReceiptStep;
  label: string;
  /** Unix seconds; 0 when nothing recorded when. */
  at: number;
  /** The wallet that signed the step, when it is known. */
  signer: string | null;
  signature: string | null;
  /** Settled by a wallet that fought in neither corner and is not the settler. */
  spectator: boolean;
  /** Posted by one of the settler's own fee wallets (the cron or a page nudge). */
  settler: boolean;
  /** The transaction's network fee in lamports; null when it is not known. */
  fee: number | null;
  slot: number | null;
  /** Other fights carried by the same transaction. */
  sharedWith: number;
};

const LABEL: Record<ReceiptKind, [ReceiptStep, string]> = {
  DuelCreated: ["called", "Called"],
  DuelAccepted: ["taken", "Taken"],
  DuelStarted: ["started", "Start prices posted"],
  DuelVoided: ["voided", "Voided"],
  DuelSettled: ["settled", "Settled"],
  DuelRefunded: ["refunded", "Refunded"],
  DuelCancelled: ["cancelled", "Called off"],
};

/* THE SETTLER'S OWN WALLETS.
 *
 * Starts and settles are paid by whoever posts them, and on devnet that is
 * almost always the settler: the cron's crank key, or the key a fight page's
 * nudge pays from. Both are public addresses (fee payers on every transaction
 * they send). Without this list the receipt called the settler "a spectator",
 * which undersold the one part of the app that runs by itself. Anyone else
 * who posts is still a spectator, and says so. */
export const SETTLER_WALLETS: ReadonlySet<string> = new Set([
  "7UoQ9CBJTomyTBHpYVivjKrTghWe8N4vCSj7gE7yHVyY", // cron crank key
  "CDvkaPF9LzECEEEJVZ4f896KgbwkG7tHWCS23LE26TYx", // page nudge key
]);

/** A row per event, oldest first. Who "signed" is the wallet the event names
 *  where it names one (the creator, the taker), and otherwise the fee payer. */
export function rowsFromEvents(events: readonly ReceiptEvent[], d: Pick<DuelView, "creator" | "opponent">): ReceiptRow[] {
  const fighters = new Set([d.creator.toBase58(), d.opponent.toBase58()]);
  const seen = new Set<string>();
  return [...events]
    .sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0) || EVENT_KINDS.indexOf(a.kind) - EVENT_KINDS.indexOf(b.kind))
    .filter((e) => {
      // The same signature can come back twice across pages of history.
      if (seen.has(e.signature + e.kind)) return false;
      seen.add(e.signature + e.kind);
      return true;
    })
    .map((e) => {
      const [step, label] = LABEL[e.kind];
      const named =
        e.kind === "DuelCreated" ? e.data.creator : e.kind === "DuelAccepted" ? e.data.opponent : e.kind === "DuelCancelled" ? e.data.by : null;
      const signer = typeof named === "string" ? named : e.feePayer;
      const settler = !!e.feePayer && SETTLER_WALLETS.has(e.feePayer) && (e.kind === "DuelStarted" || e.kind === "DuelSettled" || e.kind === "DuelRefunded" || e.kind === "DuelVoided");
      return {
        step,
        label,
        at: e.blockTime ?? 0,
        signer,
        signature: e.signature || null,
        spectator: e.kind === "DuelSettled" && !!e.feePayer && !fighters.has(e.feePayer) && !settler,
        settler,
        fee: e.fee,
        slot: e.slot,
        sharedWith: e.sharedWith,
      };
    });
}

/* WHAT THE STEPS COST, FROM THE TRANSACTIONS THEMSELVES.
 *
 * The strongest reason this runs on Solana is on every receipt already: each
 * step's fee, as the cluster charged it. So the total is the sum of the fees
 * the node reported, one per transaction (two rows can share a signature), and
 * it says how many of the steps it covers rather than filling a gap with a
 * typical fee. A rebuilt receipt with no transactions has no total at all. */
export type FeeTotal = { lamports: number; counted: number; steps: number; shared: boolean };

export function feeTotal(rows: readonly ReceiptRow[]): FeeTotal | null {
  const withTx = rows.filter((r) => r.signature);
  if (withTx.length === 0) return null;
  const seen = new Set<string>();
  let lamports = 0;
  let counted = 0;
  let shared = false;
  for (const r of withTx) {
    if (r.fee === null) continue;
    counted += 1;
    if (r.sharedWith > 0) shared = true;
    if (seen.has(r.signature!)) continue;
    seen.add(r.signature!);
    lamports += r.fee;
  }
  return counted ? { lamports, counted, steps: withTx.length, shared } : null;
}

/** Seconds from the bell to the block that settled it, from the chain's own
 *  times; null without a settle row that recorded its block time. */
export function settledAfterBell(rows: readonly ReceiptRow[], endTs: number): number | null {
  const settled = rows.find((r) => r.step === "settled" && r.at > 0);
  if (!settled || !endTs) return null;
  return Math.max(0, settled.at - endTs);
}

/** Lamports as SOL, every digit kept: 5000 -> "0.000005". */
export function solFromLamports(lamports: number): string {
  return (lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9, minimumFractionDigits: 0 });
}

/** "21 s", "3 min 4 s", "2 h 5 min": a wait measured between two chain times. */
export function waitWords(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3_600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  const h = Math.floor(s / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  return `${h} h${m ? ` ${m} min` : ""}`;
}

/* WITHOUT HISTORY, FROM THE ACCOUNT ALONE. Some RPC nodes keep no transaction
 * history for an account. The duel account still records when it was made,
 * taken, started and when its bell was, and who the two fighters are, so the
 * receipt shows those with no signer it cannot prove and no link. */
export function rowsFromAccount(
  d: Pick<DuelView, "creator" | "opponent" | "createdTs" | "acceptedTs" | "startTs" | "endTs" | "creatorEnd">,
): ReceiptRow[] {
  const none = { signature: null, spectator: false, settler: false, fee: null, slot: null, sharedWith: 0 };
  const rows: ReceiptRow[] = [];
  if (d.createdTs) rows.push({ step: "called", label: "Called", at: d.createdTs, signer: d.creator.toBase58(), ...none });
  if (d.acceptedTs) rows.push({ step: "taken", label: "Taken", at: d.acceptedTs, signer: d.opponent.toBase58(), ...none });
  if (d.startTs) rows.push({ step: "started", label: "Start prices posted", at: d.startTs, signer: null, ...none });
  if (d.startTs && d.creatorEnd.price > BigInt(0)) rows.push({ step: "bell", label: "Bell", at: d.endTs, signer: null, ...none });
  return rows;
}

const STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

/** "Sat 12 Sep 4:21:00 PM ET": a price's moment, to the second, on the market's clock. */
export function etStamp(unix: number): string {
  const p: Record<string, string> = {};
  for (const part of STAMP.formatToParts(new Date(unix * 1000))) p[part.type] = part.value;
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}:${p.second} ${(p.dayPeriod ?? "").toUpperCase()} ET`;
}
