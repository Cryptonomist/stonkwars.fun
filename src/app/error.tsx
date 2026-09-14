"use client";

/* When a page throws while rendering. The message and stack stay in the
 * console: they are written for whoever fixes the bug, and on the page they
 * would read like the site is broken in ways it is not. The visitor gets what
 * happened, a retry that re-renders just this page, and a way back. */

import Link from "next/link";
import { useEffect } from "react";

import { Notice } from "@/components/ui/Notice";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <Notice
        tone="error"
        title="Something broke on this page."
        action={
          <button type="button" onClick={reset} className="btn btn-sm btn-light">
            Try again
          </button>
        }
      >
        Your wallet and your fights are on chain and unaffected. Try again, or go back to the board.
      </Notice>
      <p className="text-sm text-dim">
        <Link href="/" className="link">
          Back to the board
        </Link>
      </p>
    </div>
  );
}
