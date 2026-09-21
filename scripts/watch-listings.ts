/* What listed since the snapshot was taken.
 *
 *   npx tsx scripts/watch-listings.ts
 *   npx tsx scripts/watch-listings.ts --json          for a cron to read
 *
 * Stocks arrive on Solana every week now, and scripts/data/tokens.json is a
 * snapshot taken by hand. This asks each issuer's own list what it holds today,
 * sets that against the snapshot, and reports what is new.
 *
 * A new mint is not admitted for being new, and never for its symbol: anybody
 * can mint a token called DKNG. It has to come from an issuer's own published
 * list, pass the escrow screen (no live transfer hook, which mint_check.rs
 * refuses; no transfer fee, which would fail the stake's balance check in
 * lib.rs; accounts that do not start frozen, which the escrow could not be paid
 * into), and have a price the oracle can actually read. Anything that fails
 * says why and waits for a person.
 *
 * This registers nothing. Admitting a stock is `register_asset`, an admin
 * instruction, and it stays that way. */

import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  AccountState,
  ExtensionType,
  getExtensionData,
  getMint,
  getTransferFeeConfig,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";

const ROOT = path.resolve(__dirname, "..");
const RPC = process.env.RPC ?? "https://api.mainnet-beta.solana.com";
const JSON_OUT = process.argv.includes("--json");
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; stonkwars-listings/1.0)" };

type Snapshot = { issuer: string; symbol: string; underlying: string; mint: string; status: string }[];

/** A token an issuer publishes today. */
type Listing = { issuer: string; symbol: string; underlying: string; name: string; mint: string };

const say = (...a: unknown[]) => {
  if (!JSON_OUT) console.log(...a);
};

/* ── Where each issuer says what it has ───────────────────────────────────────
 * One function per issuer, each returning the Solana mints it publishes. An
 * issuer that does not answer is reported, never guessed at: a silent list
 * would read as "nothing new listed", which is the one wrong answer. */

type BackedAsset = {
  symbol?: string;
  name?: string;
  underlyingSymbol?: string;
  isTradingHalted?: boolean;
  /** One entry per chain Backed has deployed the token to; ten and counting. */
  deployments?: { network?: string; chain?: string; address?: string }[];
};

const backedSolanaMint = (a: BackedAsset): string | null =>
  (a.deployments ?? []).find((d) => ((d.network ?? d.chain) ?? "").toLowerCase() === "solana")?.address ?? null;

async function xstocks(): Promise<Listing[]> {
  const out: Listing[] = [];
  for (let page = 1; page <= 30; page++) {
    const r = await fetch(`https://api.backed.fi/api/v2/public/assets?page=${page}`, { headers: HEADERS });
    if (!r.ok) throw new Error(`xStocks HTTP ${r.status}`);
    const body = (await r.json()) as { nodes?: BackedAsset[]; page?: { hasNextPage?: boolean } };
    const nodes = body.nodes ?? [];
    if (!nodes.length) break;
    for (const a of nodes) {
      const mint = backedSolanaMint(a);
      if (!mint || !a.symbol || a.isTradingHalted) continue;
      out.push({
        issuer: "xStocks",
        symbol: a.symbol,
        underlying: (a.underlyingSymbol ?? a.symbol.replace(/x$/, "")).toUpperCase(),
        name: a.name ?? a.symbol,
        mint,
      });
    }
    if (!body.page?.hasNextPage) break;
  }
  if (!out.length) throw new Error("answered, but no Solana mints in it: the shape has moved");
  return out;
}

async function backpack(): Promise<Listing[]> {
  const r = await fetch("https://api.backpack.exchange/api/v1/assets", { headers: HEADERS });
  if (!r.ok) throw new Error(`Backpack HTTP ${r.status}`);
  const body = (await r.json()) as { symbol?: string; displayName?: string; tokens?: { blockchain?: string; contractAddress?: string; depositEnabled?: boolean }[] }[];
  const out: Listing[] = [];
  for (const a of body ?? []) {
    if (!a.symbol?.endsWith(".US")) continue;
    const sol = a.tokens?.find((t) => (t.blockchain ?? "").toLowerCase() === "solana" && t.depositEnabled);
    if (!sol?.contractAddress) continue;
    out.push({
      issuer: "Backpack",
      symbol: a.symbol.replace(/\.US$/, ""),
      underlying: a.symbol.replace(/\.US$/, "").toUpperCase(),
      name: a.displayName ?? a.symbol,
      mint: sol.contractAddress,
    });
  }
  return out;
}

/** Superstate answers with an object keyed by symbol, and calls Solana 900. */
async function superstate(): Promise<Listing[]> {
  const r = await fetch("https://api.superstate.com/v1/assets", { headers: HEADERS });
  if (!r.ok) throw new Error(`Superstate HTTP ${r.status}`);
  const body = (await r.json()) as Record<
    string,
    {
      instrument_symbol?: string;
      instrument_name?: string;
      instrument_domain?: string;
      deploy_status_by_chain?: { by_chain?: Record<string, { type?: string; token_address?: string }> };
    }
  >;
  const out: Listing[] = [];
  for (const a of Object.values(body ?? {})) {
    // Funds are not shares of a listed company; a fight prices companies.
    if (a.instrument_domain !== "Equities" || !a.instrument_symbol) continue;
    const sol = a.deploy_status_by_chain?.by_chain?.["900"];
    if (sol?.type !== "Completed" || !sol.token_address) continue;
    out.push({
      issuer: "Superstate",
      symbol: a.instrument_symbol,
      underlying: a.instrument_symbol.toUpperCase(),
      name: a.instrument_name ?? a.instrument_symbol,
      mint: sol.token_address,
    });
  }
  return out;
}

const SOURCES: { issuer: string; fetch: () => Promise<Listing[]> }[] = [
  { issuer: "xStocks", fetch: xstocks },
  { issuer: "Backpack", fetch: backpack },
  { issuer: "Superstate", fetch: superstate },
];

/* ── The screen ─────────────────────────────────────────────────────────────*/

/** What the chain says about a mint, in the terms the program cares about. */
async function mintFacts(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint);
  if (!info) return { fatal: "no such mint on mainnet" };
  const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : info.owner.equals(TOKEN_PROGRAM_ID)
      ? TOKEN_PROGRAM_ID
      : null;
  if (!programId) return { fatal: `owned by ${info.owner.toBase58()}, not a token program` };

  const m = await getMint(conn, mint, "confirmed", programId);
  const fee = getTransferFeeConfig(m);
  const hook = getExtensionData(ExtensionType.TransferHook, m.tlvData);
  /* A default state of frozen means the issuer thaws each account by hand, and
   * the fight's own escrow would be born frozen. */
  const defaultState = getExtensionData(ExtensionType.DefaultAccountState, m.tlvData);
  const frozen = defaultState ? defaultState[0] === AccountState.Frozen : false;
  /* A hook program of all zeroes is the extension present but switched off. */
  const hookProgram = hook && !new PublicKey(hook.subarray(32, 64)).equals(PublicKey.default);

  return {
    programId: programId.toBase58(),
    decimals: m.decimals,
    supply: m.supply,
    frozen,
    hook: !!hookProgram,
    feeBps: fee ? fee.newerTransferFee.transferFeeBasisPoints : 0,
  };
}

/** Can the oracle read a price for this ticker? Ask the source, do not assume. */
async function priceable(ticker: string): Promise<boolean> {
  const symbol = ticker.replace(/[./]/g, "-");
  const r = await fetch(
    `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbol)}&range=5d&interval=1d`,
    { headers: HEADERS },
  );
  if (!r.ok) return false;
  const body = (await r.json()) as { spark?: { result?: { response?: { meta?: { regularMarketPrice?: number } }[] }[] } };
  const price = body.spark?.result?.[0]?.response?.[0]?.meta?.regularMarketPrice;
  return typeof price === "number" && price > 0;
}

/** Supply for many mints at once, by address; absent if the account is gone. */
async function supplies(conn: Connection, mints: string[]): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(chunk.map((m) => new PublicKey(m)));
    chunk.forEach((mint, j) => {
      const info = infos[j];
      if (!info) return;
      try {
        out.set(mint, unpackMint(new PublicKey(mint), info, info.owner).supply);
      } catch {
        /* Not a mint we can read; leave it out rather than guess. */
      }
    });
  }
  return out;
}

type Verdict = { listing: Listing; admit: boolean; why: string };

async function screen(conn: Connection, l: Listing): Promise<Verdict> {
  let mint: PublicKey;
  try {
    mint = new PublicKey(l.mint);
  } catch {
    return { listing: l, admit: false, why: "the issuer's list gave an address that is not a pubkey" };
  }

  const facts = await mintFacts(conn, mint);
  if ("fatal" in facts && facts.fatal) return { listing: l, admit: false, why: facts.fatal };
  if (facts.supply === BigInt(0)) return { listing: l, admit: false, why: "created but never issued (no supply)" };
  if (facts.frozen) return { listing: l, admit: false, why: "accounts start frozen (allowlist only)" };
  if (facts.hook) return { listing: l, admit: false, why: "transfer hook" };
  if (facts.feeBps) return { listing: l, admit: false, why: `transfer fee ${facts.feeBps}bps` };
  if (!(await priceable(l.underlying))) return { listing: l, admit: false, why: "no price the oracle can read" };

  return { listing: l, admit: true, why: `${facts.decimals}dp, supply ${facts.supply}, escrowable and priceable` };
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/data/tokens.json"), "utf8")) as Snapshot;
  const known = new Set(snapshot.map((t) => t.mint));
  say(`snapshot holds ${snapshot.length} tokens`);

  const listings: Listing[] = [];
  const broke: string[] = [];
  for (const s of SOURCES) {
    try {
      const got = await s.fetch();
      listings.push(...got);
      say(`${s.issuer.padEnd(11)} lists ${got.length}`);
    } catch (e) {
      broke.push(`${s.issuer}: ${e instanceof Error ? e.message : String(e)}`);
      say(`${s.issuer.padEnd(11)} DID NOT ANSWER`);
    }
  }

  const fresh = listings.filter((l) => !known.has(l.mint));
  if (!fresh.length) {
    say(broke.length ? `nothing new from the issuers that answered` : `nothing new: every published mint is already in the snapshot`);
  }

  /* The other direction: a token the snapshot has that its issuer no longer
   * publishes. It has been delisted, wound down, or halted, and the roster
   * should stop offering new fights on it. Only for issuers that answered:
   * a list that failed to load has not dropped anything. */
  const answered = new Set(SOURCES.map((s) => s.issuer).filter((i) => !broke.some((b) => b.startsWith(`${i}:`))));
  const published = new Set(listings.map((l) => l.mint));
  const gone = snapshot.filter((t) => answered.has(t.issuer) && t.status === "live" && !published.has(t.mint));

  const conn = new Connection(RPC, "confirmed");
  const verdicts: Verdict[] = [];
  for (const l of fresh) verdicts.push(await screen(conn, l));

  const admit = verdicts.filter((v) => v.admit);
  const hold = verdicts.filter((v) => !v.admit);

  /* Being dropped from a list is not the same as being wound down: the mint
   * usually still exists, and people still hold it. Ask the chain which it is
   * rather than reading a delisting into an absence. */
  const left = gone.length ? await supplies(conn, gone.map((t) => t.mint)) : new Map<string, bigint>();
  const emptied = gone.filter((t) => (left.get(t.mint) ?? BigInt(0)) === BigInt(0));
  const stillHeld = gone.filter((t) => (left.get(t.mint) ?? BigInt(0)) > BigInt(0));

  if (JSON_OUT) {
    console.log(JSON.stringify({ at: new Date().toISOString(), admit, hold, emptied, stillHeld, unreachable: broke }, null, 2));
  } else {
    if (admit.length) {
      say(`\nready to admit (${admit.length}):`);
      for (const v of admit) say(`  ${v.listing.underlying.padEnd(8)} ${v.listing.issuer.padEnd(11)} ${v.listing.mint}  ${v.why}`);
      say(`\nTo add them: put these rows in scripts/data/tokens.json, run build-roster.ts,`);
      say(`then setup-devnet.ts, which registers only what is not registered yet.`);
    }
    if (hold.length) {
      say(`\nheld for a person (${hold.length}):`);
      for (const v of hold) say(`  ${v.listing.underlying.padEnd(8)} ${v.listing.issuer.padEnd(11)} ${v.why}`);
    }
    if (emptied.length) {
      say(`\nwound down: dropped from the issuer's list and no supply left (${emptied.length}):`);
      for (const t of emptied.slice(0, 15)) say(`  ${t.underlying.padEnd(8)} ${t.issuer.padEnd(11)} ${t.mint}`);
      if (emptied.length > 15) say(`  ...and ${emptied.length - 15} more`);
      say(`  These should stop taking new fights. Open ones still settle.`);
    }
    if (stillHeld.length) {
      say(`\ndropped from the issuer's list, but still held on chain (${stillHeld.length}):`);
      for (const t of stillHeld.slice(0, 10)) say(`  ${t.underlying.padEnd(8)} ${t.issuer.padEnd(11)} ${t.mint}`);
      if (stillHeld.length > 10) say(`  ...and ${stillHeld.length - 10} more`);
      say(`  Not proof of anything: a list can change for its own reasons, and`);
      say(`  people still hold these. Worth asking the issuer before acting.`);
    }
    if (broke.length) say(`\nissuers that did not answer:\n  ${broke.join("\n  ")}`);
  }

  // A source that failed is not the same as a quiet week; let a cron know.
  process.exit(broke.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
