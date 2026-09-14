import "server-only";

/* Hermes, with the key. Server only: since the Pyth Core upgrade (2026-08-26)
 * every price request needs a Pyth API key, and this module is the only place
 * that reads it. */

import { HermesClient } from "@pythnetwork/hermes-client";

/** The endpoint Pyth's docs use since the Core upgrade. hermes.pyth.network
 *  also serves keyed requests; HERMES_URL picks either. */
export const DEFAULT_HERMES_URL = "https://pyth.dourolabs.app/hermes";

let client: HermesClient | null = null;

/* FIVE SECONDS, AND NO RETRIES OF ITS OWN.
 *
 * The client retries a 404 or a timeout three times by default. For a fight
 * whose Pyth market is shut, a 404 is the honest answer and asking again
 * cannot change it, yet every crank pass paid for all of it, up to half a
 * minute a pass. Everything that calls this (the crank, the page's price
 * route) comes back on its own schedule, so one quick answer is worth more
 * than a slow certain one. */
const HERMES_TIMEOUT_MS = 5_000;

export class MissingPythKey extends Error {
  constructor() {
    super("PYTH_API_KEY is not set on the server. Get one at pythdata.app and add it to .env.local.");
  }
}

export function hermes(): HermesClient {
  const key = process.env.PYTH_API_KEY;
  if (!key) throw new MissingPythKey();
  client ??= new HermesClient(process.env.HERMES_URL || DEFAULT_HERMES_URL, {
    accessToken: key,
    timeout: HERMES_TIMEOUT_MS,
    httpRetries: 0,
  });
  return client;
}

export const isFeedId = (s: string) => /^(0x)?[0-9a-f]{64}$/i.test(s);
export const bareFeed = (s: string) => s.replace(/^0x/, "").toLowerCase();
