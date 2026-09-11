import "server-only";

/* Hermes, with the key. Server only: since the Pyth Core upgrade (2026-08-26)
 * every price request needs a Pyth API key, and this module is the only place
 * that reads it. */

import { HermesClient } from "@pythnetwork/hermes-client";

/** The endpoint Pyth's docs use since the Core upgrade. hermes.pyth.network
 *  also serves keyed requests; HERMES_URL picks either. */
export const DEFAULT_HERMES_URL = "https://pyth.dourolabs.app/hermes";

let client: HermesClient | null = null;

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
    timeout: 8_000,
  });
  return client;
}

export const isFeedId = (s: string) => /^(0x)?[0-9a-f]{64}$/i.test(s);
export const bareFeed = (s: string) => s.replace(/^0x/, "").toLowerCase();
