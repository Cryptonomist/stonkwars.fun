"use client";

import { useEffect, useRef } from "react";

import { clock } from "@/lib/format";
import { useNow } from "@/lib/useNow";

import { cx } from "./cx";

/* A clock counting down to a unix time.
 *
 * Each character sits in its own span keyed by its position from the right
 * and the character, so only digits that actually changed remount and roll
 * into place. In the final seconds it blinks in ink (orange is the COOKED
 * mark, not a clock).
 *
 * Before the first client tick there is no "now", and a clock computed from
 * zero would print a number of days that never existed, so the space is held
 * by an invisible placeholder the width of a short clock.
 *
 * Screen readers: the ticking digits are hidden, and a separate polite live
 * line says how long is left. It is rounded to 10 seconds under a minute, to
 * the minute under an hour and to the minute beyond, so it changes at most
 * every ten seconds, instead of reading out a number every second. */

function spokenLeft(left: number): string {
  if (left <= 0) return "Time is up";
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (left < 60) return `${plural(Math.ceil(left / 10) * 10, "second")} left`;
  if (left < 3_600) return `${plural(Math.ceil(left / 60), "minute")} left`;
  if (left < 86_400) {
    return `${plural(Math.floor(left / 3_600), "hour")} ${plural(Math.floor((left % 3_600) / 60), "minute")} left`;
  }
  return `${plural(Math.floor(left / 86_400), "day")} ${plural(Math.floor((left % 86_400) / 3_600), "hour")} left`;
}

/** Which spoken bucket a remaining time falls in; the line changes with it. */
function bucket(left: number): number {
  if (left <= 0) return -1;
  if (left < 60) return Math.ceil(left / 10);
  if (left < 3_600) return 1_000 + Math.ceil(left / 60);
  return 100_000 + Math.floor(left / 60);
}

type CountdownProps = {
  /** Unix seconds to count down to. */
  to: number;
  /** Unix seconds now. When absent the clock ticks on its own. */
  now?: number;
  finalSecs?: number;
  size?: "clock" | "num";
  className?: string;
};

export function Countdown(props: CountdownProps) {
  return props.now === undefined ? <TickingCountdown {...props} /> : <CountdownFace {...props} now={props.now} />;
}

function TickingCountdown(props: CountdownProps) {
  const now = useNow();
  return <CountdownFace {...props} now={now} />;
}

/* A no-break space, so "1d 04:12:09" keeps its gap inside an inline-flex. */
const NBSP = "\u00a0";

function CountdownFace({ to, now, finalSecs = 10, size = "num", className }: CountdownProps & { now: number }) {
  const spoken = useRef<{ bucket: number; text: string } | null>(null);
  /* The last clock face committed to the screen. Only a character that differs
   * from it rolls, so the first face shown just appears: rolling every digit
   * in on page load would be an entrance animation, not a change. */
  const shown = useRef<string | null>(null);
  const sizing = size === "clock" ? "text-clock font-semibold" : "";

  const left = now ? Math.max(0, to - now) : 0;
  const text = now ? clock(left) : null;

  useEffect(() => {
    shown.current = text;
  }, [text]);

  if (text === null) {
    return (
      <span className={cx("num invisible whitespace-nowrap", sizing, className)} aria-hidden="true">
        0:00
      </span>
    );
  }

  const b = bucket(left);
  if (!spoken.current || spoken.current.bucket !== b) spoken.current = { bucket: b, text: spokenLeft(left) };

  const prev = shown.current;
  const chars = Array.from(text);

  return (
    <span
      role="timer"
      className={cx(
        "num inline-flex whitespace-nowrap",
        sizing,
        left > 0 && left <= finalSecs && "final-seconds",
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex">
        {chars.map((ch, i) => {
          const fromRight = chars.length - i;
          const before = prev === null ? undefined : prev[prev.length - fromRight];
          const rolls = prev !== null && /\d/.test(ch) && before !== ch;
          return (
            <span key={`${fromRight}-${ch}`} className={rolls ? "digit-roll" : undefined}>
              {ch === " " ? NBSP : ch}
            </span>
          );
        })}
      </span>
      <span className="sr-only" aria-live="polite">
        {spoken.current.text}
      </span>
    </span>
  );
}
