/* Signals between components that share no parent.
 *
 * A "Connect to take it" button deep in a fight page needs the wallet picker
 * that lives in the nav, and a toast that follows a fight needs to know which
 * fights this viewer has opened. Threading either through props or context
 * would couple every page to the shell, so they travel as a window event and a
 * localStorage list instead. Every function here is safe to call during a
 * server render, where it does nothing. */

/** Fired on window to ask the wallet button to open its picker. */
export const CONNECT_EVENT = "stonk:connect";

/** Fired on window to ask the command palette to open. */
export const PALETTE_EVENT = "stonk:palette";

/** localStorage key holding the fights this viewer has opened, newest first. */
export const WATCH_KEY = "stonk:watched";

/** localStorage key holding the viewer's sound setting. */
export const SOUND_KEY = "stonk:sound";

const WATCH_LIMIT = 30;

export function requestConnect(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONNECT_EVENT));
}

export function requestPalette(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}

/* Storage can be missing (a server render), full, or refused outright (a
 * private window, a browser that blocks site data), and the accessor itself
 * can throw. None of that is worth breaking a fight page over, so every read
 * and write swallows it and the list simply stays empty. */

/** The fights this viewer has opened, newest first, or [] when unknown. */
export function watchedFights(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WATCH_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, WATCH_LIMIT);
  } catch {
    return [];
  }
}

/** Stop following a fight: no more toasts for it until it is opened again. */
export function unwatchFight(address: string): void {
  if (typeof window === "undefined" || !address) return;
  try {
    window.localStorage.setItem(WATCH_KEY, JSON.stringify(watchedFights().filter((a) => a !== address)));
  } catch {
    /* Storage refused: nothing was being followed anyway. */
  }
}

/** Remember that this viewer opened a fight. Keeps the newest 30, unique. */
export function watchFight(address: string): void {
  if (typeof window === "undefined" || !address) return;
  try {
    const next = [address, ...watchedFights().filter((a) => a !== address)].slice(0, WATCH_LIMIT);
    window.localStorage.setItem(WATCH_KEY, JSON.stringify(next));
  } catch {
    /* Storage refused. The fight still loads; it just will not be followed. */
  }
}

/* WHEN THIS WALLET WAS LAST HERE, AND WHAT IT HAS BEEN TOLD (lib/sinceLastVisit).
 *
 * Kept per wallet, in this browser, like everything else here: there are no
 * accounts, so there is nowhere else for it to live, and a fighter on a new
 * device simply starts fresh. Both swallow every storage failure, as above. */

const LAST_SEEN_PREFIX = "stonk:lastSeen:";
const TOLD_KEY = "stonk:told";
const TOLD_LIMIT = 200;

/** Unix seconds this wallet was last seen in this browser, or null. */
export function lastSeen(wallet: string): number | null {
  if (typeof window === "undefined" || !wallet) return null;
  try {
    const n = Number(window.localStorage.getItem(LAST_SEEN_PREFIX + wallet));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function markSeen(wallet: string, at = Math.floor(Date.now() / 1000)): void {
  if (typeof window === "undefined" || !wallet) return;
  try {
    window.localStorage.setItem(LAST_SEEN_PREFIX + wallet, String(at));
  } catch {
    /* Storage refused: the next visit will look like a first one, and say nothing. */
  }
}

/** Notice ids already shown, so a result is never told twice across visits. */
export function toldNotices(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TOLD_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function markTold(ids: string[]): void {
  if (typeof window === "undefined" || !ids.length) return;
  try {
    const next = [...new Set([...ids, ...toldNotices()])].slice(0, TOLD_LIMIT);
    window.localStorage.setItem(TOLD_KEY, JSON.stringify(next));
  } catch {
    /* Storage refused: at worst a result is mentioned again. */
  }
}
