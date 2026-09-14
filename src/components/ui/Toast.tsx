"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { cx } from "./cx";

/* Toasts: small notices about real things that just happened.
 *
 * THE STORE IS A MODULE, NOT A CONTEXT. A transaction can confirm, or a
 * watcher can notice a fight change, in code that has no React tree above it
 * or before the Toaster has mounted. So `toast.push` writes to plain module
 * state and never throws, and the Toaster, whenever it mounts, reads that
 * state through useSyncExternalStore. Timers live in the store too, so a toast
 * pushed with nothing mounted still expires on time instead of piling up.
 *
 * Tones: neutral (ink), win (a green rule and title: money was taken), and
 * cooked (the mini COOKED stamp before the title). No success green and no
 * error red: a toast that says something went through is ink with a check.
 *
 * At most three show, newest first. Hovering or focusing one pauses its
 * timer; Escape dismisses the newest. The stack is a polite live region. */

export type ToastTone = "neutral" | "win" | "cooked";

export type ToastInput = {
  title: string;
  body?: string;
  tone?: ToastTone;
  href?: string;
  hrefLabel?: string;
  /** Put a check glyph before the title: something the viewer did went through. */
  check?: boolean;
  ttlMs?: number;
};

export type ToastItem = Required<Pick<ToastInput, "title" | "tone" | "ttlMs">> &
  Omit<ToastInput, "title" | "tone" | "ttlMs"> & { id: string };

const MAX_SHOWN = 3;
const MAX_KEPT = 20;

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
/* Per toast: the pending timer, when it started, and how long it had left. */
const timers = new Map<string, { handle: ReturnType<typeof setTimeout> | null; startedAt: number; remaining: number }>();
const EMPTY: ToastItem[] = [];

function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* A broken listener must not stop the others. */
    }
  }
}

function arm(id: string, ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const handle = setTimeout(() => dismiss(id), ms);
  timers.set(id, { handle, startedAt: Date.now(), remaining: ms });
}

function disarm(id: string) {
  const t = timers.get(id);
  if (t?.handle) clearTimeout(t.handle);
  timers.delete(id);
}

function push(input: ToastInput): string {
  const id = `toast-${++seq}`;
  /* On the server this module is shared by every request, so a toast kept
   * here would leak into somebody else's page. There is nobody to show it to
   * anyway. */
  if (typeof window === "undefined") return id;
  const item: ToastItem = {
    id,
    title: input.title,
    body: input.body,
    tone: input.tone ?? "neutral",
    href: input.href,
    hrefLabel: input.hrefLabel,
    check: input.check,
    ttlMs: input.ttlMs ?? 6_000,
  };
  const dropped = items.slice(MAX_KEPT - 1);
  for (const d of dropped) disarm(d.id);
  items = [item, ...items.slice(0, MAX_KEPT - 1)];
  arm(id, item.ttlMs);
  emit();
  return id;
}

function update(id: string, patch: Partial<ToastInput>): void {
  let found = false;
  items = items.map((t) => {
    if (t.id !== id) return t;
    found = true;
    return { ...t, ...patch, tone: patch.tone ?? t.tone, ttlMs: patch.ttlMs ?? t.ttlMs };
  });
  if (!found) return;
  if (patch.ttlMs !== undefined) {
    disarm(id);
    arm(id, patch.ttlMs);
  }
  emit();
}

function dismiss(id: string): void {
  disarm(id);
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

function pause(id: string): void {
  const t = timers.get(id);
  if (!t?.handle) return;
  clearTimeout(t.handle);
  timers.set(id, { handle: null, startedAt: 0, remaining: Math.max(0, t.remaining - (Date.now() - t.startedAt)) });
}

function resume(id: string): void {
  const t = timers.get(id);
  if (!t || t.handle) return;
  arm(id, Math.max(1_500, t.remaining));
}

export const toast = { push, update, dismiss };

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  );
}

const external = (href: string) => /^https?:\/\//.test(href);

function ToastCard({ t }: { t: ToastItem }) {
  const linkClass = "link text-sm";
  return (
    <div
      className={cx(
        "toast-in pointer-events-auto flex min-w-0 items-start gap-3 bg-panel-2 p-4 shadow-overlay ring-1 ring-line-strong",
        t.tone === "win" && "border-l-2 border-up",
      )}
      onMouseEnter={() => pause(t.id)}
      onMouseLeave={() => resume(t.id)}
      onFocus={() => pause(t.id)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume(t.id);
      }}
    >
      <div className="min-w-0 flex-1">
        <p className={cx("flex min-w-0 items-center gap-2 text-sm font-semibold", t.tone === "win" ? "text-up" : "text-ink")}>
          {t.tone === "cooked" ? <span className="stamp-cooked-sm">Cooked</span> : null}
          {t.check && t.tone !== "cooked" ? (
            <span aria-hidden="true" className="shrink-0">
              &#10003;
            </span>
          ) : null}
          <span className="min-w-0">{t.title}</span>
        </p>
        {t.body ? <p className="num mt-1 text-meta text-dim">{t.body}</p> : null}
        {t.href ? (
          <p className="mt-2">
            {external(t.href) ? (
              <a href={t.href} target="_blank" rel="noreferrer" className={linkClass}>
                {t.hrefLabel ?? "Open"}
                <span aria-hidden="true"> &#8599;</span>
              </a>
            ) : (
              <Link href={t.href} className={linkClass} onClick={() => dismiss(t.id)}>
                {t.hrefLabel ?? "Open"}
              </Link>
            )}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(t.id)}
        aria-label="Dismiss"
        className="-my-3 -mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center text-dim transition-colors hover:text-ink"
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  );
}

export function Toaster() {
  const all = useToasts();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const shown = all.slice(0, MAX_SHOWN);
  const newest = shown[0]?.id;

  useEffect(() => {
    if (!newest) return;
    const onKey = (e: KeyboardEvent) => {
      /* A sheet or menu that handled Escape marks it handled; closing that is
       * what the key was for, not the toast behind it. */
      if (e.key !== "Escape" || e.defaultPrevented) return;
      dismiss(newest);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newest]);

  if (!mounted) return null;
  return createPortal(
    <div role="status" aria-live="polite" className="toast-stack flex flex-col-reverse gap-2 sm:flex-col">
      {shown.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>,
    document.body,
  );
}
