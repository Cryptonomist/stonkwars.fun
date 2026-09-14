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
