import type { ReactNode } from "react";

import { cx } from "./cx";

/* THE ONLY WAY TO SHOW A WARNING OR AN ERROR, and it is ink.
 *
 * Red on this site means a price went down, and orange means a fighter got
 * COOKED, so an error in either colour makes a claim about a fight that is not
 * true. A notice is told apart by its glyph and its left rule instead:
 *
 *   info   i, a hairline rule
 *   warn   !, a dashed rule
 *   error  x, a solid ink rule
 *
 * Say what happened and what happens next; offer the action (Retry) when there
 * is one. Never put a raw error string or a stack in the body. */

export type NoticeTone = "info" | "warn" | "error";

const RULE: Record<NoticeTone, string> = {
  info: "border-line",
  warn: "border-dashed border-line-strong",
  error: "border-ink",
};

const GLYPH: Record<NoticeTone, string> = { info: "i", warn: "!", error: "x" };

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: NoticeTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("flex min-w-0 items-start gap-3 border-l-2 bg-panel-2 p-4", RULE[tone], className)}
    >
      <span
        aria-hidden="true"
        className={cx(
          "micro mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center font-semibold normal-case",
          tone === "error" ? "bg-ink text-void" : "text-ink ring-1 ring-ink ring-inset",
        )}
      >
        {GLYPH[tone]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children ? <div className="mt-1 text-sm text-ink">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}
