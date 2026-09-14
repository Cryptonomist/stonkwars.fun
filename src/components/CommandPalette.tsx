"use client";

/* Search everything the app knows, from anywhere: a stock to fight with, a
 * fighter, a fight in play, or an address pasted from somewhere else.
 *
 * Opens on "/", Ctrl+K or Cmd+K (unless somebody is typing in a field), and on
 * PALETTE_EVENT, which the nav's search button fires. It is a ui/Sheet, so on a
 * phone it rises from the bottom and on a wider screen it sits in the middle;
 * either way focus is trapped inside and Escape closes it.
 *
 * NOTHING LOADS UNTIL IT OPENS. The results live in an inner component that
 * mounts with the sheet, so the duel list and handles are asked for only by
 * somebody who is searching. The roster is bundled and costs nothing.
 *
 * The input is a combobox over one listbox: arrows move through every result
 * in order across the sections, Enter goes, and the active option is named
 * with aria-activedescendant so a screen reader follows it. */

import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { FighterName } from "@/components/ui/FighterName";
import { PALETTE_EVENT } from "@/components/ui/intents";
import { Kbd } from "@/components/ui/Kbd";
import { Sheet } from "@/components/ui/Sheet";
import { allDuels, decodeDuel, PROGRAM_ID, STATUS_LIVE, STATUS_OPEN, type DuelView } from "@/lib/duel";
import { shares, shortAddress } from "@/lib/format";
import { useDuels, useProfiles } from "@/lib/hooks";
import { useNow } from "@/lib/useNow";
import { decimalsForMint, ROSTER, tickerForMint, tokenSymbol, tradesAroundTheClock, type Stock } from "@/lib/stocks";

function typingInAField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const combo = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k";
      const slash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (!combo && !slash) return;
      if (typingInAField(e.target)) return;
      e.preventDefault();
      setOpen(combo ? (o) => !o : true);
    };
    const onEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, onEvent);
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return (
    <Sheet open={open} onClose={close} title="Search" className="sm:max-w-xl">
      {open ? <PaletteBody onDone={close} /> : null}
    </Sheet>
  );
}

/* ─── Results ─────────────────────────────────────────────────────────────── */

type Result =
  | { kind: "paste"; id: string; href: string; address: string; isFight: boolean; checking: boolean }
  | { kind: "stock"; id: string; href: string; against: string; stock: Stock }
  | { kind: "fighter"; id: string; href: string; wallet: string }
  | { kind: "fight"; id: string; href: string; duel: DuelView; t1: string; t2: string; live: boolean };

const SECTION: Record<Result["kind"], string> = {
  paste: "Address",
  stock: "Stocks",
  fighter: "Fighters",
  fight: "Fights",
};

/** Letters of `q` in order inside `s`, not necessarily together: "stnk" finds "stonkwars". */
function subsequence(s: string, q: string): boolean {
  let i = 0;
  for (const ch of s) if (ch === q[i] && ++i === q.length) return true;
  return q.length === 0;
}

function asKey(q: string): string | null {
  if (q.length < 32 || q.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(q)) return null;
  try {
    return new PublicKey(q).toBase58() === q ? q : null;
  } catch {
    return null;
  }
}

function PaletteBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const now = useNow(10_000);

  const { connection } = useConnection();
  const { data: duels, isLoading: duelsLoading } = useDuels("all", allDuels());
  const { data: handles } = useProfiles();

  const q = query.trim();
  const lower = q.toLowerCase();

  /* A PASTED ADDRESS IS ASKED ABOUT DIRECTLY. The duel list can still be on
   * its way when somebody pastes and presses Enter, and it leaves out the old
   * test-token fights on purpose, so "not in the list" does not mean "not a
   * fight". One getAccountInfo settles it: an account this program owns that
   * decodes as a Duel is a fight; anything else, including an address with no
   * account at all, is treated as a wallet. */
  const pasted = asKey(q);
  const listed = !!pasted && !!duels?.some((d) => d.address.toBase58() === pasted);
  const probe = useQuery<boolean>({
    queryKey: ["palette-is-duel", pasted],
    enabled: !!pasted && !listed,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const key = new PublicKey(pasted!);
      const info = await connection.getAccountInfo(key, "confirmed");
      if (!info || !info.owner.equals(PROGRAM_ID)) return false;
      try {
        decodeDuel(key, info.data);
        return true;
      } catch {
        return false;
      }
    },
  });
  const pastedIsFight = listed || probe.data === true;
  /* Still asking, and no answer either way yet: Enter waits for it. */
  const checking = !!pasted && !listed && probe.isPending && probe.fetchStatus !== "idle";
  const [waitingFor, setWaitingFor] = useState<string | null>(null);

  const results = useMemo<Result[]>(() => {
    const out: Result[] = [];
    const list = duels ?? [];

    const inPlay = (d: DuelView) =>
      d.status === STATUS_LIVE || (d.status === STATUS_OPEN && (now <= 0 || d.expiresTs > now));
    const fightResult = (d: DuelView): Result => {
      const address = d.address.toBase58();
      return {
        kind: "fight",
        id: `fight:${address}`,
        href: `/f/${address}`,
        duel: d,
        t1: tickerForMint(d.creatorMint) ?? "?",
        t2: tickerForMint(d.opponentMint) ?? "?",
        live: d.status === STATUS_LIVE,
      };
    };
    /* Live rounds first, closest to the bell; then the newest challenges. */
    const byUrgency = (a: DuelView, b: DuelView) =>
      a.status === b.status
        ? a.status === STATUS_LIVE
          ? a.endTs - b.endTs
          : b.createdTs - a.createdTs
        : a.status === STATUS_LIVE
          ? -1
          : 1;

    if (!q) {
      return list.filter(inPlay).sort(byUrgency).slice(0, 5).map(fightResult);
    }

    const key = pasted;
    if (key) {
      out.push({
        kind: "paste",
        id: `paste:${key}`,
        href: pastedIsFight ? `/f/${key}` : `/u/${key}`,
        address: key,
        isFight: pastedIsFight,
        checking,
      });
    }

    /* Stocks: ticker prefix first (an exact ticker before a longer one), then
     * a name that contains the query. */
    const upper = q.toUpperCase();
    const prefix: Stock[] = [];
    const named: Stock[] = [];
    for (const s of ROSTER) {
      if (s.ticker.startsWith(upper)) prefix.push(s);
      else if (lower.length >= 2 && s.name.toLowerCase().includes(lower)) named.push(s);
    }
    prefix.sort((a, b) => a.ticker.length - b.ticker.length || a.ticker.localeCompare(b.ticker));
    for (const s of [...prefix, ...named].slice(0, 8)) {
      out.push({
        kind: "stock",
        id: `stock:${s.ticker}`,
        href: `/new?p1=${encodeURIComponent(s.ticker)}`,
        against: `/new?p2=${encodeURIComponent(s.ticker)}`,
        stock: s,
      });
    }

    /* Fighters: handles the chain vouches for, then wallets that have fought
     * whose address starts with what was typed. */
    const fighters = new Set<string>();
    const needle = lower.replace(/^@/, "");
    if (needle) {
      for (const [wallet, handle] of Object.entries(handles ?? {})) {
        if (subsequence(handle.toLowerCase(), needle)) fighters.add(wallet);
      }
    }
    if (!key && q.length >= 3) {
      for (const d of list) {
        for (const w of [d.creator.toBase58(), d.opponent.toBase58()]) {
          if (w.startsWith(q) && w !== "11111111111111111111111111111111") fighters.add(w);
        }
      }
    }
    for (const wallet of [...fighters].slice(0, 5)) {
      out.push({ kind: "fighter", id: `fighter:${wallet}`, href: `/u/${wallet}`, wallet });
    }

    /* Fights in play with either stock matching. */
    const fights = list
      .filter(inPlay)
      .filter((d) => {
        const t1 = tickerForMint(d.creatorMint) ?? "";
        const t2 = tickerForMint(d.opponentMint) ?? "";
        return t1.startsWith(upper) || t2.startsWith(upper);
      })
      .sort(byUrgency)
      .slice(0, 5);
    for (const d of fights) out.push(fightResult(d));

    return out;
  }, [q, lower, duels, handles, now, pasted, pastedIsFight, checking]);

  useEffect(() => setActive(0), [q]);

  const clamped = results.length ? Math.min(active, results.length - 1) : -1;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => {
    if (clamped < 0) return;
    document.getElementById(`${listId}-opt-${clamped}`)?.scrollIntoView({ block: "nearest" });
  }, [clamped, listId]);

  const go = useCallback(
    (href: string) => {
      onDone();
      router.push(href);
    },
    [onDone, router],
  );

  /* Enter on a pasted address that is still being checked goes as soon as the
   * answer lands, and only if the query is still that address. */
  const pick = (r: Result, against = false) => {
    if (r.kind === "paste" && r.checking) {
      setWaitingFor(r.address);
      return;
    }
    go(r.kind === "stock" && against ? r.against : r.href);
  };
  useEffect(() => {
    if (!waitingFor || checking) return;
    if (pasted !== waitingFor) {
      setWaitingFor(null);
      return;
    }
    go(pastedIsFight ? `/f/${waitingFor}` : `/u/${waitingFor}`);
  }, [waitingFor, checking, pasted, pastedIsFight, go]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) setActive((clamped + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setActive((clamped - 1 + results.length) % results.length);
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      setActive(results.length - 1);
    } else if (e.key === "Enter") {
      const r = results[clamped];
      if (!r) return;
      e.preventDefault();
      /* Shift+Enter on a stock puts it in their corner instead of yours. */
      pick(r, e.shiftKey);
    }
  };

  const heading = !q ? "In play" : null;
  const empty =
    results.length === 0
      ? !q
        ? duelsLoading
          ? "Loading fights in play."
          : "Nothing live or open right now. Type a ticker to pick a fight."
        : `Nothing matches "${q}".`
      : null;

  /* A fixed height, with the results scrolling inside it: a panel that grew and
   * shrank with every keystroke would move the input out from under the eye
   * (and, as a bottom sheet, the whole top edge with it). */
  return (
    <div className="flex h-[min(30rem,65dvh)] flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2 bg-void px-3 ring-1 ring-line ring-inset focus-within:ring-ink">
        <SearchGlyph className="shrink-0 text-dim" />
        <input
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={clamped >= 0 ? optionId(clamped) : undefined}
          aria-autocomplete="list"
          aria-label="Search stocks, fighters, fights or an address"
          placeholder="Ticker, @handle, or paste an address"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-11 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-dim focus:outline-none sm:text-sm"
        />
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {heading ? <p className="label px-1 pb-1">{heading}</p> : null}

        <ul id={listId} role="listbox" aria-label="Results" className="flex flex-col">
          {results.map((r, i) => {
            const first = i === 0 || results[i - 1].kind !== r.kind;
            const selected = i === clamped;
            return (
              <li key={r.id} role="presentation" className="min-w-0">
                {first && q ? (
                  <p className={cx("label px-1 pb-1", i > 0 && "pt-3")} aria-hidden="true">
                    {SECTION[r.kind]}
                  </p>
                ) : null}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={selected}
                  onPointerMove={() => setActive(i)}
                  onClick={() => pick(r)}
                  className={cx(
                    "flex min-h-11 min-w-0 cursor-pointer items-center gap-3 px-3 py-2 transition-colors",
                    selected ? "bg-panel-3" : "bg-panel",
                  )}
                >
                  <ResultLine r={r} />
                  {r.kind === "stock" ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        go(r.against);
                      }}
                      className="btn btn-sm btn-ghost ml-auto shrink-0 px-3 py-1 text-xs"
                    >
                      Against
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {empty ? <p className="px-1 py-2 text-sm text-dim">{empty}</p> : null}
      </div>

      <p className="hidden shrink-0 items-center gap-3 border-t border-line pt-3 text-meta text-dim sm:flex">
        <span className="inline-flex items-center gap-1">
          <Kbd>&uarr;</Kbd>
          <Kbd>&darr;</Kbd> move
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Enter</Kbd> go
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Shift</Kbd>
          <Kbd>Enter</Kbd> stock in their corner
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Kbd>Esc</Kbd> close
        </span>
      </p>
    </div>
  );
}

function ResultLine({ r }: { r: Result }) {
  switch (r.kind) {
    case "paste":
      return (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm text-ink">
            {r.checking ? "Checking this address" : r.isFight ? "Open this fight" : "Open this wallet"}
          </span>
          <span className="num truncate text-meta text-dim">{shortAddress(r.address, 8)}</span>
        </span>
      );
    case "stock":
      return (
        <span className="flex min-w-0 items-center gap-3">
          <span className="w-16 shrink-0 truncate font-display text-hud-xs font-black uppercase text-ink">
            {r.stock.ticker}
          </span>
          <span className="min-w-0 truncate text-meta text-dim">{r.stock.name}</span>
          {tradesAroundTheClock(r.stock.ticker) ? <Badge variant="neutral">24/7</Badge> : null}
        </span>
      );
    case "fighter":
      return <FighterName wallet={r.wallet} href={null} size="md" />;
    case "fight": {
      const d = r.duel;
      return (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex min-w-0 items-baseline gap-1.5 font-display text-hud-xs font-black uppercase">
            <span className="truncate text-p1">{r.t1}</span>
            <span className="text-meta text-dim">vs</span>
            <span className="truncate text-p2">{r.t2}</span>
          </span>
          {r.live ? <Badge variant="live" /> : <Badge variant="neutral">Open</Badge>}
          <span className="num ml-auto hidden shrink-0 truncate text-meta text-dim sm:inline">
            {shares(d.creatorAmount, decimalsForMint(d.creatorMint))}{" "}
            <span className="normal-case">{tokenSymbol(r.t1)}</span>
          </span>
        </span>
      );
    }
  }
}

export function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}
