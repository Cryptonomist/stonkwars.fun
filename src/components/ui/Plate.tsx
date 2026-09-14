import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { cx } from "./cx";

/* THE ONE CONTAINER. Every card, rail, ticket and arena on the site is one of
 * these, so surfaces, padding and the two special shapes are decided here once
 * rather than retyped in every file:
 *
 *   notch  the top-right corner cut, for things that hold a fight
 *   rope   a 2px top edge, cyan on the left half and pink on the right, for
 *          anything that holds two sides
 *   pad    none, dense (rows, stat cells), std (rails, menus, ticket) or arena
 *
 * Without a notch it is the plain panel card with a hairline ring. */

export type PlatePad = "none" | "dense" | "std" | "arena";

const PAD: Record<PlatePad, string> = {
  none: "",
  dense: "px-3 py-2.5",
  std: "p-4",
  arena: "p-5 sm:p-8",
};

type PlateOwnProps<T extends ElementType> = {
  as?: T;
  notch?: boolean;
  rope?: boolean;
  pad?: PlatePad;
  className?: string;
  children?: ReactNode;
};

export type PlateProps<T extends ElementType = "div"> = PlateOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof PlateOwnProps<T>>;

export function Plate<T extends ElementType = "div">({
  as,
  notch = false,
  rope = false,
  pad = "std",
  className,
  children,
  ...rest
}: PlateProps<T>) {
  const Tag: ElementType = as ?? "div";
  return (
    <Tag className={cx(notch ? "plate-card" : "card", rope && "rope", PAD[pad], "min-w-0", className)} {...rest}>
      {children}
    </Tag>
  );
}
