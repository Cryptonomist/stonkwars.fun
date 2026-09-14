"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cx } from "./cx";

/* A panel over the page: a bottom sheet on a phone, where the thumb is, and a
 * centred panel from 640px up.
 *
 * It renders into document.body so no clipped or transformed ancestor can cut
 * it. While open it is modal: focus moves in and cannot Tab out, Escape or a
 * tap on the backdrop closes it, the page behind stops scrolling, and focus
 * goes back to whatever opened it. */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !mounted) return;
    const opener = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    /* Into the content first; the close button only when there is nothing
     * else to focus. */
    const first = body.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();

    return () => {
      document.body.style.overflow = overflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, mounted]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    if (nodes.length === 0) {
      e.preventDefault();
      panel.current.focus();
      return;
    }
    const firstNode = nodes[0];
    const lastNode = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === firstNode || document.activeElement === panel.current)) {
      e.preventDefault();
      lastNode.focus();
    } else if (!e.shiftKey && document.activeElement === lastNode) {
      e.preventDefault();
      firstNode.focus();
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-void/70" aria-hidden="true" onClick={() => closeRef.current()} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "sheet-in relative flex max-h-[85dvh] w-full flex-col bg-panel-2 shadow-overlay ring-1 ring-line-strong focus-visible:outline-none sm:max-w-lg",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="h-section min-w-0 truncate">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => closeRef.current()}
            aria-label="Close"
            className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center text-dim transition-colors hover:text-ink"
          >
            <span aria-hidden="true" className="text-num-lg">
              &times;
            </span>
          </button>
        </div>
        <div ref={body} className="scroll-thin pb-safe min-h-0 overflow-y-auto overscroll-contain">
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
