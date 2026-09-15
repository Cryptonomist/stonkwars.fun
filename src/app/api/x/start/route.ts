import { NextResponse, type NextRequest } from "next/server";

import { AUTHORIZE, COOKIE_NEXT, COOKIE_STATE, COOKIE_VERIFIER, pkce, randomState, redirectUri, SCOPES, xConfig } from "@/lib/xAuth.server";
import { safeNext } from "@/lib/xLink";

export const dynamic = "force-dynamic";

/* Step one: send them to X.
 *
 * The state stops somebody else's sign-in being handed back as yours, and the
 * PKCE verifier stops an intercepted code being spent by anyone but this
 * browser. Both are cookies rather than server state, so nothing here has to
 * remember anybody. `?next=` is the page to come back to, a path on this site
 * only (lib/xLink safeNext). */
export async function GET(req: NextRequest) {
  const cfg = xConfig();
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  if (!cfg) {
    // Send them back to a page rather than a page of JSON.
    const home = new URL(next, req.nextUrl.origin);
    home.searchParams.set("x", "error");
    home.searchParams.set("message", "X sign-in is not set up on this deployment yet.");
    return NextResponse.redirect(home);
  }

  const state = randomState();
  const { verifier, challenge } = pkce();
  const origin = req.nextUrl.origin;

  const url = new URL(AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(url);
  const cookie = {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax" as const,
    path: "/api/x",
    maxAge: 600,
  };
  res.cookies.set(COOKIE_STATE, state, cookie);
  res.cookies.set(COOKIE_VERIFIER, verifier, cookie);
  res.cookies.set(COOKIE_NEXT, next, cookie);
  return res;
}
