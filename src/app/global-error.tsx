"use client";

/* WHEN THE LAYOUT ITSELF THROWS. app/error.tsx catches a page; nothing caught
 * the shell around it (the nav, the providers), and a throw there showed Next's
 * bare white "Application error" on every route. This replaces the whole
 * document, so it brings its own <html> and <body> and leans on nothing that
 * could be the thing that broke: no providers, no components, inline styles in
 * the site's own colours.
 *
 * It says the one thing a visitor with a stake needs to hear first: the fights
 * are on chain and none of this touches them. */

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07070b",
          color: "#f3f3f8",
          fontFamily: "system-ui, sans-serif",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 460 }}>
          <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "#9090a8" }}>
            Stonk Wars
          </p>
          <h1 style={{ margin: "8px 0 12px", fontSize: 28, lineHeight: 1.1 }}>Something broke on our side.</h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#9090a8" }}>
            Your wallet and your fights are on chain and unaffected: stakes sit with the program, and the settler does
            not need this page. Try again, and if it keeps happening, tell us at hello@stonkwars.fun.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <button
              type="button"
              onClick={reset}
              style={{ background: "#f3f3f8", color: "#07070b", border: 0, padding: "10px 18px", fontWeight: 700, cursor: "pointer" }}
            >
              Try again
            </button>
            {/* A plain link on purpose: it reloads the whole document. The router
              * is part of what may have broken, so it is not asked to help. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ color: "#f3f3f8", padding: "10px 0", textUnderlineOffset: 4 }}>
              Back to the board
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
