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
};

/** The parts of a getTransaction answer this reads, legacy or versioned. */
export type TxLike = {
  blockTime?: number | null;
  meta?: { err?: unknown; logMessages?: string[] | null } | null;
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
    if (duel && data.duel !== duel) continue;
    const keys = tx.transaction.message.staticAccountKeys ?? tx.transaction.message.accountKeys ?? [];
    return {
      kind: decoded.name as ReceiptKind,
      blockTime: tx.blockTime ?? null,
      feePayer: keys[0]?.toBase58() ?? null,
      signature: tx.transaction.signatures[0] ?? "",
      data,
    };
  }
  return null;
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
  /** Settled by a wallet that fought in neither corner. */
  spectator: boolean;
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
      return {
        step,
        label,
        at: e.blockTime ?? 0,
        signer,
        signature: e.signature || null,
        spectator: e.kind === "DuelSettled" && !!e.feePayer && !fighters.has(e.feePayer),
      };
    });
}

/* WITHOUT HISTORY, FROM THE ACCOUNT ALONE. Some RPC nodes keep no transaction
 * history for an account. The duel account still records when it was made,
 * taken, started and when its bell was, and who the two fighters are, so the
 * receipt shows those with no signer it cannot prove and no link. */
export function rowsFromAccount(
  d: Pick<DuelView, "creator" | "opponent" | "createdTs" | "acceptedTs" | "startTs" | "endTs" | "creatorEnd">,
): ReceiptRow[] {
  const none = { signature: null, spectator: false };
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
