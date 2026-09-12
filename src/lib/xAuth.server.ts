import "server-only";

import crypto from "crypto";

/* Signing in with X, the only way this app ever touches it.
 *
 * We ask for permission to read a public profile and nothing else: no posting,
 * no messages, no follows, and deliberately no offline access, so X hands us no
 * refresh token and we cannot act as anybody later. The access token we do get
 * is used once, to read an id and a handle, and then dropped.
 *
 * Nothing is stored on a server here either. What survives the round trip is a
 * cookie this file signs, and the handle inside it is worth only as much as the
 * signature: the browser can read it, and cannot change it. */

export type XConfig = { clientId: string; clientSecret: string };

export function xConfig(): XConfig | null {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const AUTHORIZE = "https://x.com/i/oauth2/authorize";
export const TOKEN = "https://api.x.com/2/oauth2/token";
export const ME = "https://api.x.com/2/users/me";

/** Read the profile, and that is the whole list. */
export const SCOPES = ["users.read", "tweet.read"];

export const COOKIE_STATE = "x_state";
export const COOKIE_VERIFIER = "x_verifier";
export const COOKIE_LINK = "x_link";

const b64url = (b: Buffer) => b.toString("base64url");

/** PKCE: a secret, and the hash of it that goes out in the open. */
export function pkce() {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export const randomState = () => b64url(crypto.randomBytes(32));

/* A cookie the browser carries but cannot forge. HMAC-SHA256 keyed by the X
 * client secret, which is already on the server and nowhere else; a payload
 * whose expiry has passed is refused even with a good signature. */
export function sealHandle(secret: string, value: { xId: string; handle: string }, ttlSecs = 900) {
  const body = b64url(Buffer.from(JSON.stringify({ ...value, exp: Math.floor(Date.now() / 1000) + ttlSecs })));
  return `${body}.${hmac(secret, body)}`;
}

export function openHandle(secret: string, token: string | undefined): { xId: string; handle: string } | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = hmac(secret, body);
  // Constant time, so a wrong signature cannot be found one character at a time.
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      xId?: string;
      handle?: string;
      exp?: number;
    };
    if (!value.xId || !value.handle || !value.exp) return null;
    if (value.exp < Math.floor(Date.now() / 1000)) return null;
    return { xId: value.xId, handle: value.handle };
  } catch {
    return null;
  }
}

const hmac = (secret: string, body: string) =>
  b64url(crypto.createHmac("sha256", secret).update(body).digest());

/** The callback X redirects to, which must match one registered on the app. */
export const redirectUri = (origin: string) => `${origin}/api/x/callback`;

/** Swap the code for a token, read the profile, and keep neither. */
export async function readProfile(
  cfg: XConfig,
  code: string,
  verifier: string,
  origin: string,
): Promise<{ xId: string; handle: string }> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: cfg.clientId,
      redirect_uri: redirectUri(origin),
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`X would not exchange the code (HTTP ${res.status})`);
  const token = (await res.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("X returned no access token");

  const me = await fetch(ME, {
    headers: { authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  if (!me.ok) throw new Error(`X would not say who you are (HTTP ${me.status})`);
  const body = (await me.json()) as { data?: { id?: string; username?: string } };
  const id = body.data?.id;
  const handle = body.data?.username;
  if (!id || !handle) throw new Error("X returned no account");
  return { xId: id, handle };
}
