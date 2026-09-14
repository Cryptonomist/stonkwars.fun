import type { ReactNode } from "react";

import { cx } from "./cx";

/** A keyboard hint: "/", "Esc". Hidden from phones by whoever places it. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "micro inline-flex h-4.5 min-w-4.5 items-center justify-center px-1 text-dim ring-1 ring-line ring-inset",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
