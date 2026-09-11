/* The client half of the duel program.
 *
 * Every address is DERIVED, never passed in: the duel is a PDA of its creator
 * and a seed, each escrow is the duel's associated token account for a mint,
 * each payout account is a player's associated token account. The program
 * re-derives all of it and refuses a mismatch; this module exists so an honest
 * client agrees with it before the wallet popup rather than after.
 *
 * Instruction data comes from Anchor's BorshCoder over the vendored IDL, the
 * same path the LiteSVM suite uses, and account order mirrors the Accounts
 * structs in programs/duel/src/lib.rs exactly. A reordering here is not a type
 * error anywhere; it is a failed transaction at best.
 */

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { BorshCoder, utils, type Idl } from "@coral-xyz/anchor";
import BN from "bn.js";

import idlJson from "@/idl/duel.json";

export const idl = idlJson as unknown as Idl;
export const coder = new BorshCoder(idl);

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || (idlJson as { address: string }).address,
);

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const PYTH_RECEIVER_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

// Mirrors of programs/duel/src/{constants,state}.rs.
export const STATUS_OPEN = 0;
export const STATUS_ACCEPTED = 1;
export const STATUS_LIVE = 2;
export const STATUS_SETTLED = 3;
export const STATUS_VOID = 4;
export const STATUS_REFUNDED = 5;

export const OUTCOME_NONE = 0;
export const OUTCOME_CREATOR = 1;
export const OUTCOME_OPPONENT = 2;
export const OUTCOME_TIE = 3;
export const OUTCOME_VOID = 4;

export const START_DELAY_SECS = 2;
export const MIN_DUEL_SECS = 60;
export const MAX_DUEL_SECS = 31 * 86_400;
export const MAX_OPEN_SECS = 30 * 86_400;
export const STALL_REFUND_SECS = 7 * 86_400;
export const MAX_TAUNT_LEN = 80;

/** Byte offsets the program promises to keep (see the Duel struct). */
export const OFFSET_CREATOR = 8;
export const OFFSET_OPPONENT = 40;
export const OFFSET_STATUS = 72;

const enc = new TextEncoder();

export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("config")], PROGRAM_ID)[0];
}

export function assetPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("asset"), mint.toBytes()], PROGRAM_ID)[0];
}

export function duelPda(creator: PublicKey, seed: bigint): PublicKey {
  const le = new Uint8Array(8);
  new DataView(le.buffer).setBigUint64(0, seed, true);
  return PublicKey.findProgramAddressSync(
    [enc.encode("duel"), creator.toBytes(), le],
    PROGRAM_ID,
  )[0];
}

/** The associated token account for an owner and mint, under a token program. */
export function ataFor(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

/** Random rather than sequential, so two duels opened at once cannot collide. */
export function randomSeed(): bigint {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  b[7] &= 0x7f;
  return new DataView(b.buffer).getBigUint64(0, true);
}

/** A stock as the builders need it: which mint, under which token program. */
export type StakeAsset = { mint: PublicKey; tokenProgram: PublicKey };

export type PricePoint = { price: bigint; expo: number; publishTime: number };

export type DuelView = {
  address: PublicKey;
  creator: PublicKey;
  opponent: PublicKey;
  status: number;
  outcome: number;
  seed: bigint;
  invitee: PublicKey;
  winner: PublicKey;
  creatorMint: PublicKey;
  opponentMint: PublicKey;
  creatorTokenProgram: PublicKey;
  opponentTokenProgram: PublicKey;
  creatorFeed: string;
  opponentFeed: string;
  creatorAmount: bigint;
  opponentAmount: bigint;
  durationSecs: number;
  endTs: number;
  expiresTs: number;
  createdTs: number;
  acceptedTs: number;
  startTs: number;
  creatorStart: PricePoint;
  opponentStart: PricePoint;
  creatorEnd: PricePoint;
  opponentEnd: PricePoint;
  taunt: string;
};

const toHex = (bytes: number[] | Uint8Array) => Buffer.from(Uint8Array.from(bytes)).toString("hex");

function point(raw: { price: BN; expo: number; publish_time: BN }): PricePoint {
  return {
    price: BigInt(raw.price.toString()),
    expo: Number(raw.expo),
    publishTime: Number(raw.publish_time.toString()),
  };
}

export function decodeDuel(address: PublicKey, data: Uint8Array): DuelView {
  const r = coder.accounts.decode("Duel", Buffer.from(data)) as Record<string, never>;
  const pk = (k: string) => new PublicKey(r[k]);
  const num = (k: string) => Number((r[k] as { toString(): string }).toString());
  const big = (k: string) => BigInt((r[k] as { toString(): string }).toString());
  return {
    address,
    creator: pk("creator"),
    opponent: pk("opponent"),
    status: num("status"),
    outcome: num("outcome"),
    seed: big("seed"),
    invitee: pk("invitee"),
    winner: pk("winner"),
    creatorMint: pk("creator_mint"),
    opponentMint: pk("opponent_mint"),
    creatorTokenProgram: pk("creator_token_program"),
    opponentTokenProgram: pk("opponent_token_program"),
    creatorFeed: toHex(r["creator_feed"]),
    opponentFeed: toHex(r["opponent_feed"]),
    creatorAmount: big("creator_amount"),
    opponentAmount: big("opponent_amount"),
    durationSecs: num("duration_secs"),
    endTs: num("end_ts"),
    expiresTs: num("expires_ts"),
    createdTs: num("created_ts"),
    acceptedTs: num("accepted_ts"),
    startTs: num("start_ts"),
    creatorStart: point(r["creator_start"]),
    opponentStart: point(r["opponent_start"]),
    creatorEnd: point(r["creator_end"]),
    opponentEnd: point(r["opponent_end"]),
    taunt: String(r["taunt"] ?? ""),
  };
}

export const hasOpponent = (d: DuelView) => !d.opponent.equals(PublicKey.default);
export const isInviteOnly = (d: DuelView) => !d.invitee.equals(PublicKey.default);

/* ─── Instructions ─────────────────────────────────────────────────────────── */

export type CreateDuelArgs = {
  creator: PublicKey;
  seed: bigint;
  creatorAsset: StakeAsset;
  opponentAsset: StakeAsset;
  creatorAmount: bigint;
  opponentAmount: bigint;
  /** Exactly one of these two is non-zero. */
  durationSecs: number;
  endTs: number;
  expiresTs: number;
  invitee?: PublicKey;
  taunt?: string;
  /** Defaults to the creator's associated token account for their stock. */
  source?: PublicKey;
};

export function buildCreateDuel(args: CreateDuelArgs) {
  const taunt = args.taunt ?? "";
  if (enc.encode(taunt).length > MAX_TAUNT_LEN) {
    throw new Error(`Keep the taunt under ${MAX_TAUNT_LEN} characters`);
  }
  if (args.creatorAsset.mint.equals(args.opponentAsset.mint)) {
    throw new Error("Pick two different stocks");
  }
  if ((args.durationSecs > 0) === (args.endTs > 0)) {
    throw new Error("Set a round length or an end time, not both");
  }

  const duel = duelPda(args.creator, args.seed);
  const c = args.creatorAsset;
  const o = args.opponentAsset;
  const escrow = ataFor(duel, c.mint, c.tokenProgram);
  const source = args.source ?? ataFor(args.creator, c.mint, c.tokenProgram);
  const winnings = ataFor(args.creator, o.mint, o.tokenProgram);

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.creator, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: assetPda(c.mint), isSigner: false, isWritable: false },
      { pubkey: assetPda(o.mint), isSigner: false, isWritable: false },
      { pubkey: c.mint, isSigner: false, isWritable: false },
      { pubkey: o.mint, isSigner: false, isWritable: false },
      { pubkey: duel, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: winnings, isSigner: false, isWritable: true },
      { pubkey: c.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: o.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("create_duel", {
      seed: new BN(args.seed.toString()),
      creator_amount: new BN(args.creatorAmount.toString()),
      opponent_amount: new BN(args.opponentAmount.toString()),
      duration_secs: new BN(args.durationSecs),
      end_ts: new BN(args.endTs),
      expires_ts: new BN(args.expiresTs),
      invitee: args.invitee ?? PublicKey.default,
      taunt,
    }),
  });
  return { instruction, duel, escrow };
}

export function buildAcceptDuel(d: DuelView, opponent: PublicKey, source?: PublicKey) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: opponent, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: d.address, isSigner: false, isWritable: true },
      { pubkey: d.creatorMint, isSigner: false, isWritable: false },
      { pubkey: d.opponentMint, isSigner: false, isWritable: false },
      {
        pubkey: ataFor(d.address, d.opponentMint, d.opponentTokenProgram),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: source ?? ataFor(opponent, d.opponentMint, d.opponentTokenProgram),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: ataFor(opponent, d.creatorMint, d.creatorTokenProgram),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: d.creatorTokenProgram, isSigner: false, isWritable: false },
      { pubkey: d.opponentTokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("accept_duel", {}),
  });
}

export function buildCancelDuel(d: DuelView, caller: PublicKey) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: caller, isSigner: true, isWritable: true },
      { pubkey: d.address, isSigner: false, isWritable: true },
      { pubkey: d.creator, isSigner: false, isWritable: true },
      { pubkey: d.creatorMint, isSigner: false, isWritable: false },
      {
        pubkey: ataFor(d.address, d.creatorMint, d.creatorTokenProgram),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: ataFor(d.creator, d.creatorMint, d.creatorTokenProgram),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: d.creatorTokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("cancel_duel", {}),
  });
}

/** No signer: the prices prove themselves. The fee payer is whoever sends it. */
export function buildStartDuel(d: DuelView, creatorPrice: PublicKey, opponentPrice: PublicKey) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: d.address, isSigner: false, isWritable: true },
      { pubkey: creatorPrice, isSigner: false, isWritable: false },
      { pubkey: opponentPrice, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("start_duel", {}),
  });
}

function payoutKeys(d: DuelView, payer: PublicKey, full: boolean) {
  const cp = d.creatorTokenProgram;
  const op = d.opponentTokenProgram;
  return [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: d.address, isSigner: false, isWritable: true },
    { pubkey: d.creator, isSigner: false, isWritable: true },
    { pubkey: d.opponent, isSigner: false, isWritable: true },
    { pubkey: d.creatorMint, isSigner: false, isWritable: false },
    { pubkey: d.opponentMint, isSigner: false, isWritable: false },
    { pubkey: ataFor(d.address, d.creatorMint, cp), isSigner: false, isWritable: true },
    { pubkey: ataFor(d.address, d.opponentMint, op), isSigner: false, isWritable: true },
    { pubkey: ataFor(d.creator, d.creatorMint, cp), isSigner: false, isWritable: true },
    ...(full
      ? [
          { pubkey: ataFor(d.creator, d.opponentMint, op), isSigner: false, isWritable: true },
          { pubkey: ataFor(d.opponent, d.creatorMint, cp), isSigner: false, isWritable: true },
        ]
      : []),
    { pubkey: ataFor(d.opponent, d.opponentMint, op), isSigner: false, isWritable: true },
  ];
}

export function buildSettleDuel(
  d: DuelView,
  payer: PublicKey,
  creatorPrice: PublicKey,
  opponentPrice: PublicKey,
) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      ...payoutKeys(d, payer, true),
      { pubkey: creatorPrice, isSigner: false, isWritable: false },
      { pubkey: opponentPrice, isSigner: false, isWritable: false },
      { pubkey: d.creatorTokenProgram, isSigner: false, isWritable: false },
      { pubkey: d.opponentTokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("settle_duel", {}),
  });
}

export function buildRefundDuel(d: DuelView, payer: PublicKey) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      ...payoutKeys(d, payer, false),
      { pubkey: d.creatorTokenProgram, isSigner: false, isWritable: false },
      { pubkey: d.opponentTokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("refund_duel", {}),
  });
}

export function buildCloseDuel(d: DuelView) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: d.creator, isSigner: true, isWritable: true },
      { pubkey: d.address, isSigner: false, isWritable: true },
    ],
    data: coder.instruction.encode("close_duel", {}),
  });
}

/* ─── Finding duels ────────────────────────────────────────────────────────── */

const DUEL_DISCRIMINATOR = (
  idlJson as { accounts?: { name: string; discriminator: number[] }[] }
).accounts?.find((a) => a.name === "Duel")?.discriminator;

function duelFilter() {
  if (!DUEL_DISCRIMINATOR) throw new Error("The vendored IDL has no Duel discriminator");
  return { memcmp: { offset: 0, bytes: utils.bytes.bs58.encode(Buffer.from(DUEL_DISCRIMINATOR)) } };
}

export const duelsWithStatus = (status: number) => [
  duelFilter(),
  { memcmp: { offset: OFFSET_STATUS, bytes: utils.bytes.bs58.encode(Buffer.from([status])) } },
];

export const duelsCreatedBy = (wallet: PublicKey) => [
  duelFilter(),
  { memcmp: { offset: OFFSET_CREATOR, bytes: wallet.toBase58() } },
];

export const duelsAcceptedBy = (wallet: PublicKey) => [
  duelFilter(),
  { memcmp: { offset: OFFSET_OPPONENT, bytes: wallet.toBase58() } },
];

export const allDuels = () => [duelFilter()];

/* ─── Errors ───────────────────────────────────────────────────────────────── */

/** The program's own sentence, rather than "custom program error: 0x1771". */
export function readableProgramError(err: unknown): string {
  const text =
    err instanceof Error
      ? `${err.message}\n${(err as { logs?: string[] }).logs?.join("\n") ?? ""}`
      : String(err);
  const named = text.match(/Error Message: ([^.\n]+)/);
  if (named) return named[1].trim();
  if (/User rejected|rejected the request/i.test(text)) return "You cancelled in your wallet.";
  if (/insufficient (lamports|funds)|0x1\b/i.test(text)) {
    return "Not enough SOL for fees and rent. Grab some devnet SOL and try again.";
  }
  if (/AccountNotInitialized|could not find account/i.test(text)) {
    return "An account this needs does not exist yet. Do you hold that stock?";
  }
  return text.split("\n")[0].slice(0, 200);
}
