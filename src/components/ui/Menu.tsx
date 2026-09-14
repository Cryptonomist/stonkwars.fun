"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cx } from "./cx";

/* A popover menu anchored to the button that opens it.
 *
 * It renders into document.body and positions itself from the trigger's
 * on-screen box, because the nav and every plate on the site carry a
 * clip-path that would slice a menu drawn inside them.
 *
 * Behaviour follows the menu button pattern: the trigger says it has a popup
 * and whether it is open; opening focuses the first item; arrows, Home and End
 * move between items; Escape, Tab, choosing an item or a click outside close
 * it, and every close except a click elsewhere puts focus back on the trigger.
 *
 * Anything that is not a MenuItem (a header, a balance, a notice) can sit
 * inside it too; only items take part in arrow-key movement. */

type MenuCtx = { close: (refocus?: boolean) => void };
const Ctx = createContext<MenuCtx | null>(null);

const ITEMS = '[role="menuitem"]:not([aria-disabled="true"])';

export function Menu({
  trigger,
  triggerClassName,
  triggerLabel,
  align = "end",
  children,
  className,
  onOpenChange,
}: {
  /** What the trigger button shows. */
  trigger: ReactNode;
  triggerClassName?: string;
  /** An accessible name for the trigger when its content is not text. */
  triggerLabel?: string;
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  const setOpenState = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChangeRef.current?.(next);
  }, []);

  const close = useCallback(
    (refocus = true) => {
      setOpenState(false);
      if (refocus) triggerRef.current?.focus();
    },
    [setOpenState],
  );

  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const gap = 8;
    const edge = 8;
    /* Below the trigger by default; above it when the trigger sits low on the
     * screen (a bottom bar, a sticky action) and there is more room up there. */
    const below = window.innerHeight - r.bottom - gap - edge;
    const above = r.top - gap - edge;
    const up = below < 240 && above > below;
    const style: CSSProperties = up
      ? { position: "fixed", bottom: Math.round(window.innerHeight - r.top + gap), maxHeight: Math.round(above) }
      : { position: "fixed", top: Math.round(r.bottom + gap), maxHeight: Math.round(below) };
    if (align === "end") style.right = Math.max(edge, Math.round(window.innerWidth - r.right));
    else style.left = Math.max(edge, Math.round(r.left));
    style.maxWidth = `calc(100vw - ${edge * 2}px)`;
    setPos(style);
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  /* Focus the first item once the panel is on screen: when it opens, not on
   * every reposition while it is open. */
  const placed = pos !== null;
  useEffect(() => {
    if (!open || !placed) return;
    const first = panel.current?.querySelector<HTMLElement>(ITEMS);
    (first ?? panel.current)?.focus();
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => {
      if (items.length === 0) return;
      items[((i % items.length) + items.length) % items.length].focus();
    };
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        e.preventDefault();
        close();
        break;
      case "ArrowDown":
        e.preventDefault();
        focusAt(at + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusAt(at < 0 ? items.length - 1 : at - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(items.length - 1);
        break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        onClick={() => setOpenState(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpenState(true);
          }
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && pos
        ? createPortal(
            <Ctx.Provider value={{ close }}>
              <div
                ref={panel}
                id={menuId}
                role="menu"
                tabIndex={-1}
                style={pos}
                onKeyDown={onKeyDown}
                className={cx(
                  "menu-in scroll-thin z-40 min-w-56 overflow-y-auto bg-panel-2 py-1 shadow-overlay ring-1 ring-line-strong focus-visible:outline-none",
                  className,
                )}
              >
                {children}
              </div>
            </Ctx.Provider>,
            document.body,
          )
        : null}
    </>
  );
}

const ITEM_CLASS =
  "flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-panel-3 focus:bg-panel-3 focus-visible:-outline-offset-2";

export function MenuItem({
  href,
  onSelect,
  children,
  closeOnSelect = true,
  disabled = false,
  external = false,
  className,
}: {
  href?: string;
  onSelect?: () => void;
  children: ReactNode;
  /** Keep the menu open after choosing, for a two-step action like disconnect. */
  closeOnSelect?: boolean;
  disabled?: boolean;
  /** Open href in a new tab. */
  external?: boolean;
  className?: string;
}) {
  const ctx = useContext(Ctx);
  const choose = () => {
    if (disabled) return;
    onSelect?.();
    if (closeOnSelect) ctx?.close(!href);
  };
  const cls = cx(ITEM_CLASS, disabled && "cursor-not-allowed text-dim hover:bg-transparent", className);

  if (href && !disabled) {
    return external ? (
      <a role="menuitem" tabIndex={-1} href={href} target="_blank" rel="noreferrer" onClick={choose} className={cls}>
        {children}
      </a>
    ) : (
      <Link role="menuitem" tabIndex={-1} href={href} onClick={choose} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={choose}
      className={cls}
    >
      {children}
    </button>
  );
}
