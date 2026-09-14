"use client";

/* The fight page's half of the nudge: while a fight page is open, ask the
 * server to crank the fight at the moment its price exists.
 *
 * Nobody signs anything and no wallet need be connected. The page only says
 * "this fight is on screen"; the server decides what is due, waits for the
 * price, and pays (app/api/nudge/route.ts). When to ask is nudgeSchedule.ts,
 * shared with the end-to-end script.
 *
 * WHY THE EFFECT WATCHES FOUR FIELDS. The duel query hands back a new object
 * on every three-second poll, so an effect keyed on it would tear the loop
 * down and start it again twenty times a minute, forgetting its backoff each
 * time. The loop restarts only when the job itself changes: another fight, a
 * new status, or new boundaries. Everything else it reads fresh from a ref.
 *
 * WHAT IT PUBLISHES. Its state and the clock skew it measured go into the
 * query cache under ["nudge", address], where useNudgeStatus reads them, so
 * the round clock can count on the server's time and say " · retrying". */

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { STATUS_ACCEPTED, STATUS_LIVE, STATUS_VOID, type DuelView } from "./duel";
import { nextNudgeAt, nudgeJobFor, type NudgeAnswer, type NudgeState } from "./nudgeSchedule";

export type NudgeStatus = {
  /** "idle" before the first answer, "asking" while a request is out,
   *  otherwise the server's last answer. */
  state: "idle" | "asking" | NudgeState;
  /** Failed answers in a row, including requests that got no answer. */
  failures: number;
  /** Seconds to add to this device's clock to read the server's. */
  skew: number;
  last?: NudgeAnswer;
  /** When the next ask is due, on the server's clock; null once it has stopped. */
  nextAt?: number | null;
};

const nudgeKey = (address: string | undefined) => ["nudge", address] as const;
const localNow = () => Date.now() / 1000;

/** The longest one wait lasts before the loop looks at the fight again. */
const SLICE_MS = 15_000;
/** How often a page whose fight waits for a shut market looks again. */
const SHUT_RECHECK_MS = 30_000;

/* A wait that ends early when the effect is torn down or the tab is shown or
 * hidden, so a page brought back to the front asks straight away if it is due
 * and a hidden one stops at the next turn of the loop. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      document.removeEventListener("visibilitychange", done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal.addEventListener("abort", done);
    document.addEventListener("visibilitychange", done);
  });
}

/** Ask once. Always resolves to an answer: a request that got none is a failure. */
async function ask(address: string, signal: AbortSignal, skew: number): Promise<{ answer: NudgeAnswer; skew?: number }> {
  try {
    const res = await fetch("/api/nudge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ duel: address }),
      cache: "no-store",
      signal,
    });
    const received = localNow();
    const body = (await res.json().catch(() => null)) as Partial<NudgeAnswer> | null;
    if (body && typeof body.state === "string" && typeof body.serverTime === "number") {
      return { answer: body as NudgeAnswer, skew: body.serverTime - received };
    }
    return { answer: { state: "failed", serverTime: received + skew, detail: `HTTP ${res.status}` } };
  } catch {
    return { answer: { state: "failed", serverTime: localNow() + skew, detail: "The server did not answer." } };
  }
}

/** Nudge the settler about a fight for as long as its page is open. */
export function useSettlerNudge(d: DuelView | null | undefined): void {
  const qc = useQueryClient();
  const latest = useRef(d);
  useEffect(() => {
    latest.current = d;
  });

  const address = d?.address.toBase58();
  const status = d?.status;
  const acceptedTs = d?.acceptedTs;
  const endTs = d?.endTs;

  useEffect(() => {
    if (!address || (status !== STATUS_ACCEPTED && status !== STATUS_LIVE && status !== STATUS_VOID)) return;
    const stop = new AbortController();
    const signal = stop.signal;

    // The skew outlives a status change: it is this device's, not this job's.
    let skew = qc.getQueryData<NudgeStatus>(nudgeKey(address))?.skew ?? 0;
    let failures = 0;
    let last: NudgeAnswer | null = null;
    const since = localNow() + skew;

    const publish = (patch: Partial<NudgeStatus>) =>
      qc.setQueryData<NudgeStatus>(nudgeKey(address), (old) => ({
        state: "idle",
        ...old,
        ...patch,
        failures,
        skew,
      }));
    publish({ state: "idle", last: undefined, nextAt: undefined });

    void (async () => {
      while (!signal.aborted) {
        const duel = latest.current;
        if (!duel || duel.address.toBase58() !== address) return;
        // A hidden tab asks nothing; the next visibilitychange wakes the loop.
        if (document.hidden) {
          await pause(SHUT_RECHECK_MS, signal);
          continue;
        }

        const now = localNow() + skew;
        const job = nudgeJobFor(duel, now, { since });
        const at = nextNudgeAt(job, last, failures, now);
        if (at === null) {
          publish({ nextAt: null });
          // A shut market opens by the clock alone, so look again later; anything else is over.
          if (job && "shut" in job) {
            await pause(SHUT_RECHECK_MS, signal);
            continue;
          }
          return;
        }
        if (at > now) {
          publish({ nextAt: at });
          await pause(Math.min((at - now) * 1_000, SLICE_MS), signal);
          continue;
        }

        publish({ state: "asking" });
        const got = await ask(address, signal, skew);
        if (signal.aborted) return;
        if (got.skew !== undefined) skew = got.skew;
        last = got.answer;
        failures = last.state === "failed" ? failures + 1 : 0;
        publish({ state: last.state, last });
        // The chain moved (or somebody moved it): read the fight now, not at the next poll.
        if (last.state === "sent" || last.state === "done") void qc.invalidateQueries({ queryKey: ["duel", address] });
      }
    })();

    return () => stop.abort();
    /* The data object itself is deliberately not a dependency: see the note at
     * the top. `qc` is stable for the life of the app. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, status, acceptedTs, endTs]);
}

/** The nudge's state for a fight, as useSettlerNudge last published it. */
export function useNudgeStatus(address: string | undefined): NudgeStatus | undefined {
  const qc = useQueryClient();
  const query = useQuery<NudgeStatus | null>({
    queryKey: nudgeKey(address),
    // Never fetched: the nudge loop writes this entry, and this only watches it.
    queryFn: () => qc.getQueryData<NudgeStatus>(nudgeKey(address)) ?? null,
    enabled: false,
    staleTime: Infinity,
  });
  return query.data ?? undefined;
}
