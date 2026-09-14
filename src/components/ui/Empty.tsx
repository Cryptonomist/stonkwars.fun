import Link from "next/link";
import { isValidElement, type ReactNode } from "react";

import { cx } from "./cx";
import { Plate } from "./Plate";

/* Nothing here, and somewhere to go instead.
 *
 * Only for when there has truly never been anything. A quiet board with old
 * results shows those results and their age; an empty state on a board that
 * has history would tell a visitor nobody plays. */

export type EmptyAction = { href: string; label: string; tone?: "p1" | "light" | "ghost" };

const TONE: Record<NonNullable<EmptyAction["tone"]>, string> = {
  p1: "btn-p1",
  light: "btn-light",
  ghost: "btn-ghost",
};

const isAction = (a: unknown): a is EmptyAction =>
  typeof a === "object" && a !== null && !isValidElement(a) && "href" in a && "label" in a;

export function Empty({
  title,
  body,
  action,
  className,
}: {
  title: ReactNode;
  body?: ReactNode;
  /** One link, several (the first is the primary), or any node. */
  action?: EmptyAction | EmptyAction[] | ReactNode;
  className?: string;
}) {
  const actions: EmptyAction[] | null = Array.isArray(action) && action.every(isAction)
    ? action
    : isAction(action)
      ? [action]
      : null;

  return (
    <Plate pad="std" className={cx("flex flex-col items-center gap-3 py-10 text-center", className)}>
      <h2 className="h-section">{title}</h2>
      {body ? <p className="max-w-prose text-sm text-dim">{body}</p> : null}
      {actions ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {actions.map((a, i) => (
            <Link key={a.href} href={a.href} className={cx("btn btn-sm", TONE[a.tone ?? (i === 0 ? "light" : "ghost")])}>
              {a.label}
            </Link>
          ))}
        </div>
      ) : action ? (
        <div className="mt-2">{action as ReactNode}</div>
      ) : null}
    </Plate>
  );
}
