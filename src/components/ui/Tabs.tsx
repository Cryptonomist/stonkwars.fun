"use client";

import { useCallback, useId, useRef, type KeyboardEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cx } from "./cx";

/* Tabs as slanted segment plates.
 *
 * The chosen plate is filled in ink; the rest are ghost plates. A tab that
 * stands for a corner ("Your fighter", "Their fighter") passes `side`, and when
 * chosen takes that side's tint, colour and underline instead, because there
 * the choice really is a side. Colour never marks an ordinary tab.
 *
 * Keyboard: one tab stop for the whole list (roving tabindex), arrows move and
 * select, Home and End jump to the ends. Selection follows focus, which suits
 * tabs whose panels are already in memory. */

export type TabItem<T extends string = string> = {
  id: T;
  label: string;
  count?: number | null;
  side?: "p1" | "p2";
};

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  controls,
  size = "sm",
  className,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  /** The id of the panel these tabs switch, for aria-controls. */
  controls?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (to: number) => {
    const n = items.length;
    if (n === 0) return;
    const i = ((to % n) + n) % n;
    refs.current[i]?.focus();
    onChange(items[i].id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = items.findIndex((t) => t.id === value);
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(at + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(at - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(items.length - 1);
        break;
    }
  };

  /* If the value matches no tab, the first tab keeps the tab stop so the list
   * is still reachable from the keyboard. */
  const selectedIndex = Math.max(0, items.findIndex((t) => t.id === value));

  return (
    <div role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} className={cx("flex flex-wrap gap-1", className)}>
      {items.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={controls}
            tabIndex={i === selectedIndex ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cx(
              "btn",
              size === "sm" && "btn-sm",
              selected ? (t.side ? `seg-${t.side}` : "btn-light") : "btn-ghost",
            )}
          >
            {t.label}
            {t.count != null ? (
              <span className={cx("micro num", selected && !t.side ? "text-void" : "text-dim")}>{t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* THE TAB LIVES IN THE URL, so a refresh, a shared link or the back button
 * lands on the same tab. The default tab is left out of the URL to keep links
 * clean, and anything in the URL that is not a known tab falls back to it.
 *
 * useSearchParams makes a page opt out of static rendering up to the nearest
 * Suspense boundary, so any page using this must wrap the component in
 * <Suspense>, or `next build` fails. */
export function useUrlTab<T extends string>(param: string, ids: readonly T[], fallback: T): [T, (id: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = params.get(param);
  const value = raw !== null && (ids as readonly string[]).includes(raw) ? (raw as T) : fallback;

  const set = useCallback(
    (id: T) => {
      const next = new URLSearchParams(params.toString());
      if (id === fallback) next.delete(param);
      else next.set(param, id);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname, param, fallback],
  );

  return [value, set];
}
