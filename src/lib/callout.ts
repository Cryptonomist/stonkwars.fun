/* CALL SOMEBODY OUT BY NAME.
 *
 * A challenge can be addressed to one wallet, and the box for it asked for a
 * wallet address, which nobody knows about anybody. People know handles. Every
 * wallet that has linked X already has its handle on chain (useProfiles maps
 * wallet to handle), so "@name" resolves by reading that map backwards: no new
 * account, no lookup service, and nobody can be named who has not linked the
 * handle themselves, with X's own sign-in behind it.
 *
 * What goes on chain is still the wallet. The handle is only how it is typed.
 *
 * Pure, so the rules are pinned by tests: case does not matter, the @ is
 * optional only when the text cannot be an address, and an unknown handle is
 * an answer with a next step, not just an error. */

import { PublicKey } from "@solana/web3.js";

export type Callout =
  | { kind: "empty" }
  | { kind: "wallet"; wallet: string; handle: string | null }
  | { kind: "unknown-handle"; handle: string }
  | { kind: "invalid" };

const HANDLE = /^@?([A-Za-z0-9_]{1,15})$/;

export function resolveCallout(input: string, handlesByWallet: Record<string, string> | undefined): Callout {
  const text = input.trim();
  if (!text) return { kind: "empty" };

  /* An address first: a base58 key is also made of handle characters, and the
   * wallet somebody pasted must never be reread as a name. */
  if (!text.startsWith("@")) {
    try {
      const wallet = new PublicKey(text).toBase58();
      return { kind: "wallet", wallet, handle: handlesByWallet?.[wallet] ?? null };
    } catch {
      /* Not an address; it may be a handle typed without its @. */
    }
  }

  const m = HANDLE.exec(text);
  if (!m) return { kind: "invalid" };
  const want = m[1].toLowerCase();
  for (const [wallet, handle] of Object.entries(handlesByWallet ?? {})) {
    if (handle.replace(/^@/, "").toLowerCase() === want) return { kind: "wallet", wallet, handle };
  }
  return { kind: "unknown-handle", handle: m[1] };
}

export const calloutError = (c: Callout, profilesLoaded: boolean): string | null =>
  c.kind === "invalid"
    ? "That is not a Solana address or an X handle."
    : c.kind === "unknown-handle"
      ? profilesLoaded
        ? `No wallet has linked @${c.handle} yet. Leave this empty, send them the link, and they can link X in one step.`
        : "Looking that handle up..."
      : null;
