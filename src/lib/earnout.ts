/* EARNOUT: who sent this player, said once, on chain, in a way nobody else
 * can read.
 *
 * An Earnout link (earnout.dev/r/<creator>) lands here with `?eo=<token>`.
 * The token carries a campaign, the identity that signed it, a single-use
 * reference, and the signature. This file keeps it in localStorage for a
 * week, takes it out of the address bar so it does not travel with a shared
 * link, and turns it into the two instructions a fight-entry transaction
 * carries: Earnout's `tag` (three read-only keys, never fails) and the
 * Solana Actions identity memo. Only creating or taking a fight carries
 * them; nothing else here is a conversion.
 *
 * The reference is ciphertext: only the campaign can tell which creator it
 * came from. The chain sees that this wallet converted, not who sent it.
 *
 * A trimmed copy of Earnout's SDK client (github.com/Cryptonomist/earnout,
 * sdk/client.ts and sdk/identity.ts), on web3.js like the rest of this app.
 * Storage key and token format are the SDK's, so the two stay compatible. */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const EARNOUT_PROGRAM = new PublicKey("EKcSH6aEQiKhULjqixHqaReodxh61tMKRZ8Vsg4Vz8dU");
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
/** Anchor's discriminator for the program's `tag` instruction. */
const TAG_DISCRIMINATOR = Uint8Array.from([62, 126, 95, 189, 228, 237, 42, 150]);

export const TAG_PARAM = "eo";
const KEY = "earnout:tag";
const WINDOW_SECS = 7 * 86_400;

export type EarnoutTag = { campaign: PublicKey; identity: PublicKey; reference: PublicKey; signature: string };

const nowSecs = () => Math.floor(Date.now() / 1000);

/** `e1.<campaign>.<identity>.<reference>.<signature>`, all base58. */
export function decodeEarnoutToken(token: string): EarnoutTag | null {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "e1") return null;
  if (!/^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(parts[4])) return null;
  try {
    return {
      campaign: new PublicKey(parts[1]),
      identity: new PublicKey(parts[2]),
      reference: new PublicKey(parts[3]),
      signature: parts[4],
    };
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** On page load: keep a tag from the URL, and take it out of the address
 * bar. Last click wins. Nothing here throws. */
export function captureEarnoutTag(): EarnoutTag | null {
  try {
    if (typeof location === "undefined") return null;
    const url = new URL(location.href);
    const token = url.searchParams.get(TAG_PARAM);
    if (!token) return null;
    url.searchParams.delete(TAG_PARAM);
    if (typeof history !== "undefined") history.replaceState(history.state, "", url.toString());
    const tag = decodeEarnoutToken(token);
    if (!tag) return null;
    storage()?.setItem(KEY, JSON.stringify({ token, savedAt: nowSecs() }));
    return tag;
  } catch {
    return null;
  }
}

/** The kept tag, if any, and still inside its week. */
export function pendingEarnoutTag(): EarnoutTag | null {
  const s = storage();
  try {
    const raw = s?.getItem(KEY);
    if (!raw) return null;
    const { token, savedAt } = JSON.parse(raw) as { token: string; savedAt: number };
    const age = nowSecs() - savedAt;
    if (!(age >= 0 && age <= WINDOW_SECS)) {
      s?.removeItem(KEY);
      return null;
    }
    return decodeEarnoutToken(token);
  } catch {
    return null;
  }
}

/** Forget it: a reference only ever counts once. Call after the tagged
 * transaction confirms. */
export function clearEarnoutTag(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Storage blocked; nothing was kept.
  }
}

/** The two instructions to append to a fight-entry transaction. */
export function earnoutTagInstructions(tag: EarnoutTag): TransactionInstruction[] {
  const memo = `solana-action:${tag.identity.toBase58()}:${tag.reference.toBase58()}:${tag.signature}`;
  return [
    new TransactionInstruction({
      programId: EARNOUT_PROGRAM,
      keys: [
        { pubkey: tag.campaign, isSigner: false, isWritable: false },
        { pubkey: tag.identity, isSigner: false, isWritable: false },
        { pubkey: tag.reference, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(TAG_DISCRIMINATOR),
    }),
    // No keys: the memo program would demand a signature from any it is given.
    new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(memo, "utf8") }),
  ];
}

/** Everything a fight-entry send needs: the pending tag's instructions, or
 * none. About 72,000 compute units when present, almost all of it the memo. */
export function earnoutInstructionsForEntry(): TransactionInstruction[] {
  const tag = pendingEarnoutTag();
  return tag ? earnoutTagInstructions(tag) : [];
}
