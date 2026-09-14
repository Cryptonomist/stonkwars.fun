"use client";

/* THE RULES PAGE'S TABLE OF CONTENTS, in the two shapes the page needs.
 *
 *   rail     from 1024px, a sticky column beside the text. The section being
 *            read is marked in ink with a rule beside it, found with an
 *            IntersectionObserver, and it changes without animation: a
 *            contents list that slides about while you scroll is one more
 *            thing moving that is not the market.
 *   details  below 1024px, a closed "On this page" at the top, so a phone's
 *            first screen is the rules and not a list of links. Picking a
 *            link closes it again.
 *
 * WHICH SECTION IS CURRENT. The observer watches a band across the upper part
 * of the window, just under the sticky nav. The first section in page order
 * with any part inside that band is the one being read. When none is (a long
 * answer fills the band between two headings) the last one marked stays
 * marked, which is the section still on screen. Near the end of the page the
 * window cannot scroll the short last answers to the top, so two things hold
 * there: scrolled right to the bottom, the last section in the band is the
 * current one, and a section picked from the rail stays marked for as long as
 * it is in the band, rather than the question above it. */

import { useCallback, useEffect, useRef, useState } from "react";

import { cx } from "@/components/ui/cx";

export type Contents = { id: string; label: string }[];

function useCurrent(items: Contents): [string | null, (id: string) => void] {
  const [current, setCurrent] = useState<string | null>(items[0]?.id ?? null);
  const picked = useRef<string | null>(null);
  const inBand = useRef(new Map<string, boolean>());

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const band = inBand.current;
    const order = items.map((i) => i.id);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) band.set(e.target.id, e.isIntersecting);
        if (picked.current && band.get(picked.current)) {
          setCurrent(picked.current);
          return;
        }
        picked.current = null;
        /* At the very end of the page the last few answers can never reach
         * the top, so there the last one in the band is the one being read. */
        const end = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
        const inside = order.filter((id) => band.get(id));
        const next = end ? inside.at(-1) : inside[0];
        if (next) setCurrent(next);
      },
      /* Below the 56px nav, down to 60% of the window. */
      { rootMargin: "-64px 0px -40% 0px", threshold: 0 },
    );
    for (const id of order) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  const pick = useCallback((id: string) => {
    picked.current = id;
    setCurrent(id);
  }, []);

  return [current, pick];
}

export function ContentsRail({ items, className }: { items: Contents; className?: string }) {
  const [current, pick] = useCurrent(items);
  return (
    <nav aria-label="On this page" className={className}>
      <p className="label">On this page</p>
      <ol className="mt-3 flex flex-col border-l border-line">
        {items.map((item) => {
          const on = item.id === current;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={on ? "location" : undefined}
                onClick={() => pick(item.id)}
                className={cx(
                  "-ml-px block border-l-2 py-1.5 pl-3 text-meta",
                  on ? "border-ink text-ink" : "border-transparent text-dim hover:text-ink",
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function ContentsDetails({ items, className }: { items: Contents; className?: string }) {
  return (
    <details className={cx("group card", className)}>
      <summary className="label flex min-h-10 cursor-pointer list-none select-none items-center justify-between gap-2 px-3 hover:text-ink [&::-webkit-details-marker]:hidden">
        On this page
        <span aria-hidden="true" className="text-sm group-open:rotate-180">
          &#9662;
        </span>
      </summary>
      <ol className="flex flex-col border-t border-line px-3 py-1">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="flex min-h-10 items-center text-sm text-dim hover:text-ink"
              onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
