/* The parts of linking X that are plain rules, kept apart from the server code
 * so they can be tested and shared.
 *
 * A profile picture is not in the program's Profile account (that holds an id
 * and a handle, and changing its layout means a program upgrade). It rides in a
 * memo in the same link transaction instead, which the oracle signs along with
 * everything else. So a picture shows only when the chain carries it, in a
 * transaction the oracle signed, for a wallet whose profile is still open. */

/** The SPL Memo program (v2). A memo with no signer accounts is just logged. */
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** What the memo starts with, so no other memo is ever read as a picture. */
export const AVATAR_MEMO_PREFIX = "stonkwars:x-avatar:";

const FALLBACK_NEXT = "/leaderboard";
const PLACEHOLDER_ORIGIN = "https://stonkwars.invalid";

/** A path on this site and nothing else: no scheme, no host, no protocol-relative trick. */
export function safeNext(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\") || path.startsWith("/api/")) {
    return FALLBACK_NEXT;
  }
  try {
    const url = new URL(path, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return FALLBACK_NEXT;
    for (const key of ["x", "handle", "message"]) url.searchParams.delete(key);
    return `${url.pathname}${url.search}`;
  } catch {
    return FALLBACK_NEXT;
  }
}

/* X serves profile pictures from one host, under one path. Anything else is not
 * a picture X named, so it is dropped rather than written on chain. The URL X
 * hands out is the 48px "_normal" size; the 400px one lives beside it. */
const AVATAR_HOST = "pbs.twimg.com";
const MAX_AVATAR_URL = 200;

export function cleanAvatar(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== AVATAR_HOST || !u.pathname.startsWith("/profile_images/")) return null;
    if (u.search || u.hash || u.username || u.password || u.port) return null;
    if (u.pathname.includes("..")) return null;
    const big = `${u.origin}${u.pathname.replace(/_normal(\.\w+)$/, "_400x400$1")}`;
    return big.length <= MAX_AVATAR_URL ? big : null;
  } catch {
    return null;
  }
}

export const avatarMemo = (url: string) => `${AVATAR_MEMO_PREFIX}${url}`;

/** The picture in a memo, only if the memo is ours and the URL is still one X would name. */
export function readAvatarMemo(memo: string | null | undefined): string | null {
  if (!memo || !memo.startsWith(AVATAR_MEMO_PREFIX)) return null;
  return cleanAvatar(memo.slice(AVATAR_MEMO_PREFIX.length));
}
