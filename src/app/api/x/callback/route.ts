import { NextResponse, type NextRequest } from "next/server";

import { COOKIE_LINK, COOKIE_STATE, COOKIE_VERIFIER, readProfile, sealHandle, xConfig } from "@/lib/xAuth.server";

export const dynamic = "force-dynamic";

/* Step two: X sends them back.
 *
 * The handle is read here and carried onward in a signed cookie, because the
 * chain is what actually records it and only the wallet can sign that. So this
 * route ends with a redirect back to the leaderboard, where the browser asks
 * for the wallet's signature. */
export async function GET(req: NextRequest) {
  const cfg = xConfig();
  const home = new URL("/leaderboard", req.nextUrl.origin);
  if (!cfg) return fail(home, "X sign-in is not configured on this deployment");

  const error = req.nextUrl.searchParams.get("error");
  if (error) return fail(home, error === "access_denied" ? "Sign-in cancelled" : error);

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get(COOKIE_STATE)?.value;
  const verifier = req.cookies.get(COOKIE_VERIFIER)?.value;
  if (!code || !state || !expected || !verifier || state !== expected) {
    return fail(home, "That sign-in did not match the one this browser started");
  }

  let profile;
  try {
    profile = await readProfile(cfg, code, verifier, req.nextUrl.origin);
  } catch (e) {
    return fail(home, e instanceof Error ? e.message : "X sign-in failed");
  }

  home.searchParams.set("x", "sign");
  home.searchParams.set("handle", profile.handle);
  const res = NextResponse.redirect(home);
  res.cookies.delete({ name: COOKIE_STATE, path: "/api/x" });
  res.cookies.delete({ name: COOKIE_VERIFIER, path: "/api/x" });
  res.cookies.set(COOKIE_LINK, sealHandle(cfg.clientSecret, profile), {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/x",
    maxAge: 900,
  });
  return res;
}

function fail(home: URL, message: string) {
  home.searchParams.set("x", "error");
  home.searchParams.set("message", message);
  return NextResponse.redirect(home);
}
