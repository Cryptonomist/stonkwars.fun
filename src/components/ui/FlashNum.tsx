"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cx } from "./cx";

/* A number that shows it changed.
 *
 * Only a real change flashes: the first value a component is given, and a
 * value arriving after a gap (null), are just shown. In "price" mode a rise
 * flashes green tint and a fall red tint, because that is what the price did;
 * in "count" mode any change gives a faint neutral tint, because a count going
 * up is not good news or bad news.
 *
 * The class is taken off and put back on the element directly, with a reflow
 * between, so that two changes in quick succession each flash, without
 * remounting whatever is inside. Under reduced motion the CSS drops the flash
 * and the number simply changes. */

const FLASH_MS = 400;
const CLASSES = ["flash-up", "flash-down", "row-new"];

export function FlashNum({
  value,
  mode = "price",
  children,
  className,
}: {
  value: number | null | undefined;
  mode?: "price" | "count";
  children: ReactNode;
  className?: string;
}) {
  const el = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null | undefined>(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    const node = el.current;
    if (!node || before == null || value == null || before === value) return;

    const cls = mode === "count" ? "row-new" : value > before ? "flash-up" : "flash-down";
    node.classList.remove(...CLASSES);
    void node.offsetWidth;
    node.classList.add(cls);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => node.classList.remove(cls), FLASH_MS);
  }, [value, mode]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <span ref={el} className={cx("tabular-nums", className)}>
      {children}
    </span>
  );
}
