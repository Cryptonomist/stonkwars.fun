"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cx } from "./cx";

/* A tooltip that works on a phone.
 *
 * `title=` does nothing under a finger, so explanations that lived there were
 * invisible to most visitors. This opens on hover, on keyboard focus, and on a
 * tap (a second tap, or a tap anywhere else, closes it). The bubble renders in
 * a portal so a clipped plate cannot cut it, and flips below its trigger when
 * there is no room above.
 *
 * Screen readers get the text through aria-describedby on the trigger, which
 * points at a hidden copy that is always in the page, so the description is
 * there the moment focus lands and not only once the bubble has drawn.
 *
 * Wrap text, not a control: the trigger is itself a button. */

export function Tip({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const lastPointer = useRef<string>("mouse");
  const wasOpen = useRef(false);
  const id = useId();

  const place = useCallback(() => {
    const t = trigger.current;
    const b = bubble.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const bw = b?.offsetWidth ?? 0;
    const bh = b?.offsetHeight ?? 0;
    const edge = 8;
    const gap = 8;
    const above = r.top - gap - bh >= edge;
    const left = Math.min(Math.max(edge, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - edge);
    setPos({ position: "fixed", left: Math.round(left), top: Math.round(above ? r.top - gap - bh : r.bottom + gap) });
  }, []);

  /* Draw once off-screen to measure, then place. */
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (trigger.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-describedby={id}
        onPointerDown={(e) => {
          /* A tap focuses the button before it clicks it, and focus opens the
           * tip, so the click must toggle from the state before the tap. */
          lastPointer.current = e.pointerType;
          wasOpen.current = open;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => {
          if (lastPointer.current !== "mouse") setOpen(!wasOpen.current);
        }}
        className={cx(
          "inline cursor-help text-left underline decoration-faint decoration-dotted underline-offset-4",
          className,
        )}
      >
        {children}
      </button>
      <span id={id} className="sr-only">
        {label}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={bubble}
              role="tooltip"
              aria-hidden="true"
              style={pos ?? { position: "fixed", left: -9999, top: -9999 }}
              className="pointer-events-none z-40 max-w-64 bg-panel-2 px-3 py-2 text-meta text-ink shadow-overlay ring-1 ring-line-strong"
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
