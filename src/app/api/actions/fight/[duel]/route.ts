import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";

import { actionError, actionJson, ACTION_HEADERS } from "@/lib/actions.server";
import { SITE_URL } from "@/lib/brand";
import { ataFor, buildAcceptDuel, decodeDuel, isInviteOnly, PROGRAM_ID, STATUS_OPEN, type DuelView } from "@/lib/duel";
import { shares, span } from "@/lib/format";
import { STAKE_DECIMALS, tickerForMint, tokenSymbol } from "@/lib/stocks";

export const dynamic = "force-dynamic";

/* A fight as a Solana Action: GET describes it, POST hands back an unsigned
 * accept_duel for the wallet to sign. The transaction is built from the same
 * lib/duel.ts the fight page uses, so a Blink cannot take a fight on terms the
 * site would not. The program re-checks everything anyway. */

type Params = { params: Promise<{ duel: string }> };

function connection() {
  return new Connection(process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
}

async function readDuel(address: string): Promise<DuelView | null> {
  let key: PublicKey;
  try {
    key = new PublicKey(address);
  } catch {
    return null;
  }
  const info = await connection().getAccountInfo(key);
  if (!info || !info.owner.equals(PROGRAM_ID)) return null;
  return decodeDuel(key, info.data);
}

/* An RPC that is down or rate limiting throws out of every chain call here.
 * Left uncaught, Next answers a bare 500 carrying none of the Action headers,
 * and an Actions client reads that as a CORS failure rather than a reason. So
 * each call that touches the chain ends here instead, as a proper error body
 * with the headers still on it. */
const unreachable = () => actionError("Could not reach Solana just now. Try again in a moment.", 503);

/* A token account that was never created makes getTokenAccountBalance throw,
 * and for that case zero is the true balance. Every other failure is the RPC,
 * where "you need more shares" would be a lie told to somebody who has them. */
const neverCreated = (e: unknown) => /could not find account/i.test(String((e as Error)?.message ?? e));

export const OPTIONS = () => new Response(null, { headers: ACTION_HEADERS });

export async function GET(_req: Request, { params }: Params) {
  const { duel } = await params;
  let d: DuelView | null;
  try {
    d = await readDuel(duel);
  } catch {
    return unreachable();
  }
  const icon = `${SITE_URL}/f/${duel}/opengraph-image`;
  if (!d) {
    return actionJson({
      type: "action",
      icon: `${SITE_URL}/opengraph-image`,
      title: "Fight not found",
      description: "It was called off, or the link is wrong.",
      label: "Gone",
      disabled: true,
    });
  }

  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  const now = Math.floor(Date.now() / 1000);
  const open = d.status === STATUS_OPEN && d.expiresTs > now;
  const round = d.durationSecs ? `${span(d.durationSecs)} round` : "to the bell";
  const stake = `${shares(d.opponentAmount, STAKE_DECIMALS)} ${tokenSymbol(t2)}`;

  return actionJson({
    type: "action",
    icon,
    title: `${t1} vs ${t2}`,
    description: [
      d.taunt ? `"${d.taunt}"` : null,
      `${shares(d.creatorAmount, STAKE_DECIMALS)} ${tokenSymbol(t1)} staked on ${t1}. Stake ${stake} on ${t2}, ${round}. Bigger move takes both stakes, settled on Solana.`,
      isInviteOnly(d) ? "This one is addressed to a single wallet." : null,
    ]
      .filter(Boolean)
      .join(" "),
    label: open ? `Take it: stake ${stake}` : "Fight closed",
    disabled: !open,
    ...(open
      ? { links: { actions: [{ type: "transaction", label: `Take it: stake ${stake}`, href: `/api/actions/fight/${duel}` }] } }
      : { error: { message: "This fight has already been taken, or it expired." } }),
  });
}

export async function POST(req: Request, { params }: Params) {
  const { duel } = await params;
  let account: PublicKey;
  try {
    const body = (await req.json()) as { account?: string };
    account = new PublicKey(body.account ?? "");
  } catch {
    return actionError("Send { account } as a Solana address.");
  }

  let d: DuelView | null;
  try {
    d = await readDuel(duel);
  } catch {
    return unreachable();
  }
  if (!d) return actionError("No fight at that address.", 404);
  const now = Math.floor(Date.now() / 1000);
  if (d.status !== STATUS_OPEN || d.expiresTs <= now) return actionError("This fight is no longer open.");
  if (account.equals(d.creator)) return actionError("You cannot take your own fight.");
  if (isInviteOnly(d) && !account.equals(d.invitee)) return actionError("This fight is addressed to someone else.");

  const conn = connection();
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  let balance: bigint;
  try {
    balance = await conn
      .getTokenAccountBalance(ataFor(account, d.opponentMint, d.opponentTokenProgram))
      .then((b) => BigInt(b.value.amount));
  } catch (e) {
    if (!neverCreated(e)) return unreachable();
    balance = BigInt(0);
  }
  if (balance < d.opponentAmount) {
    return actionError(
      `You need ${shares(d.opponentAmount, STAKE_DECIMALS)} ${tokenSymbol(t2)} to take this. Get some at ${SITE_URL.replace(/^https?:\/\//, "")}.`,
    );
  }

  let latest: Awaited<ReturnType<Connection["getLatestBlockhash"]>>;
  try {
    latest = await conn.getLatestBlockhash("confirmed");
  } catch {
    return unreachable();
  }
  const tx = new Transaction({ feePayer: account, ...latest })
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(buildAcceptDuel(d, account));

  return actionJson({
    type: "transaction",
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    message: `You're in. The round starts at the first prices after this lands. Watch it at ${SITE_URL}/f/${duel}`,
  });
}
