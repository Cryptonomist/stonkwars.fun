"use client";

/* The connect button, written against `useWallet` directly. Carried over from
 * Commish with its fixes intact, restyled for the arena:
 *
 * HYDRATION. The first client render says what the server said ("Connect"),
 * because autoConnect often restores a wallet before hydration and a mismatch
 * makes React rebuild the subtree, which resets the click's intent ref and eats
 * the click with no error anywhere.
 *
 * SELECT THEN CONNECT. `select()` lands on a later render, so the click records
 * intent and an effect connects once the selection has taken, deferred one
 * microtask so the provider's own one-shot auto-connect goes first and this
 * backs off instead of issuing a second, silently swallowed, connect.
 *
 * PHONES. A phone browser has no extension to find. When nothing is installed
 * the button opens a panel of universal links into wallets' in-app browsers.
 *
 * Any button on any page can open the picker by firing CONNECT_EVENT (see
 * ui/intents), so "Connect to take it" deep in a fight page reaches this one.
 *
 * CONNECTED, A CLICK OPENS A MENU. It used to disconnect on the spot, which is
 * one stray tap from losing a wallet mid-fight. The menu shows what the wallet
 * holds, and disconnecting takes a second click inside three seconds. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";

import { useFaucet } from "@/components/FaucetButton";
import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { FighterName } from "@/components/ui/FighterName";
import { Identicon } from "@/components/ui/Identicon";
import { CONNECT_EVENT } from "@/components/ui/intents";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/duel";
import { shares, shortAddress, usd } from "@/lib/format";
import { GuestWalletName } from "@/lib/guestWallet";
import { explorerAddress } from "@/lib/hooks";
import {
  detectPlatform,
  inWalletBrowser,
  isIpadPretendingToBeAMac,
  MOBILE_WALLETS,
  storeFor,
  type Platform,
} from "@/lib/mobile";
import { stakeValue, usePrices } from "@/lib/prices";
import { CLUSTER, tokenForMint, tokenSymbol } from "@/lib/stocks";

type Problem = { title: string; body: string };

export function WalletButton({ className = "" }: { className?: string }) {
  const { wallets, wallet, select, connect, connecting, connected, publicKey } = useWallet();

  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const wantsConnect = useRef(false);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const [platform, setPlatform] = useState<Platform>("desktop");
  const [insideWallet, setInsideWallet] = useState(false);
  const [href, setHref] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setHref(window.location.href);
    setOrigin(window.location.origin);
    const ua = navigator.userAgent;
    setPlatform(isIpadPretendingToBeAMac(ua, navigator.maxTouchPoints) ? "ios" : detectPlatform(ua));
    setInsideWallet(inWalletBrowser(ua));
  }, []);

  const available = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );
  const installed = available.filter((w) => w.readyState === WalletReadyState.Installed);
  const handoff = available.find((w) => w.readyState === WalletReadyState.Loadable);

  const needsMobileHelp =
    hydrated && !connected && platform !== "desktop" && !insideWallet && installed.length === 0;

  /* The wallet's own error text is written for developers ("WalletConnectionError:
   * User rejected the request"), so the page says what happened in its words. */
  const tryConnect = useCallback(() => {
    connect().catch(() =>
      setProblem({
        title: "The wallet did not connect.",
        body: "Nothing was signed. Try again, or pick another wallet.",
      }),
    );
  }, [connect]);

  useEffect(() => {
    if (!wantsConnect.current || !wallet || connected || connecting) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !wantsConnect.current) return;
      const a = wallet.adapter as { connecting?: boolean; connected?: boolean };
      if (a.connecting || a.connected) return;
      wantsConnect.current = false;
      tryConnect();
    });
    return () => {
      cancelled = true;
    };
  }, [wallet, connected, connecting, tryConnect]);

  const choose = useCallback(
    (name: WalletName) => {
      setProblem(null);
      setPicking(false);
      if (wallet?.adapter.name === name) {
        tryConnect();
        return;
      }
      wantsConnect.current = true;
      select(name);
    },
    [wallet, select, tryConnect],
  );

  const openPicker = useCallback(() => {
    setProblem(null);
    if (connected) return;
    if (needsMobileHelp) {
      setPicking(true);
      return;
    }
    if (available.length === 0) {
      setProblem({
        title: "No Solana wallet in this browser.",
        body: "Install Phantom or Solflare, then come back to this page.",
      });
      return;
    }
    if (available.length === 1) {
      choose(available[0].adapter.name);
      return;
    }
    setPicking(true);
  }, [connected, available, choose, needsMobileHelp]);

  /* Another component asked for the picker. A ref, so the listener is added
   * once and still calls the picker as it is on the latest render. */
  const openRef = useRef(openPicker);
  useEffect(() => {
    openRef.current = openPicker;
  });
  useEffect(() => {
    const onConnect = () => openRef.current();
    window.addEventListener(CONNECT_EVENT, onConnect);
    return () => window.removeEventListener(CONNECT_EVENT, onConnect);
  }, []);

  const closeSheet = useCallback(() => {
    setPicking(false);
    setProblem(null);
  }, []);

  if (hydrated && connected && publicKey) {
    return <WalletMenu address={publicKey.toBase58()} className={className} />;
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={openPicker}
        disabled={hydrated && connecting}
        aria-haspopup="dialog"
        className="btn btn-sm btn-light"
      >
        {hydrated && connecting ? "Connecting..." : "Connect"}
      </button>

      <Sheet
        open={picking || !!problem}
        onClose={closeSheet}
        title={needsMobileHelp ? "Open in a wallet" : "Connect a wallet"}
      >
        <div className="flex flex-col gap-4">
          {problem ? (
            <Notice tone="error" title={problem.title}>
              {problem.body}
            </Notice>
          ) : null}

          {needsMobileHelp ? (
            <>
              <p className="text-sm text-dim">
                Phone browsers cannot hold a wallet. Open this page inside a wallet app and it connects there.
              </p>
              {handoff ? (
                <button type="button" onClick={() => choose(handoff.adapter.name)} className="btn btn-sm btn-light w-full">
                  Use an installed wallet
                </button>
              ) : null}
              <ul className="flex flex-col gap-2">
                {MOBILE_WALLETS.map((w) => (
                  <li key={w.id} className="card flex flex-col gap-2 p-4">
                    <span className="h-section">{w.name}</span>
                    <span className="text-meta text-dim">{w.note}</span>
                    <span className="flex gap-2">
                      <a href={w.browse(href, origin)} className="btn btn-sm btn-light flex-1">
                        Open
                      </a>
                      <a
                        href={storeFor(w, platform)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="btn btn-sm btn-ghost flex-1"
                      >
                        Install
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : available.length > 0 ? (
            <ul className="flex flex-col gap-px bg-line">
              {available.map((w) => (
                <li key={w.adapter.name}>
                  <button
                    type="button"
                    onClick={() => choose(w.adapter.name)}
                    className="row flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left focus-visible:-outline-offset-2"
                  >
                    {w.adapter.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={w.adapter.icon} alt="" width={24} height={24} className="shrink-0" />
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-ink">
                        {w.adapter.name === GuestWalletName ? "Guest wallet" : w.adapter.name}
                      </span>
                      {w.adapter.name === GuestWalletName ? (
                        <span className="text-meta text-dim">A test key kept in this browser. Devnet only.</span>
                      ) : w.readyState === WalletReadyState.Loadable ? (
                        <span className="text-meta text-dim">Opens the wallet app</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}

/* ─── Connected ───────────────────────────────────────────────────────────── */

const SOL_DECIMALS = 9;
const MAX_HOLDINGS = 8;

type Holding = { ticker: string; raw: bigint; decimals: number };

/* The amount in an SPL token account, read from the raw bytes: mint in the
 * first 32, amount as a little-endian u64 at 64. Token-2022 accounts share the
 * same base layout, with any extensions after it. */
function readTokenAccount(data: Uint8Array): { mint: string; amount: bigint } | null {
  if (data.length < 72) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { mint: new PublicKey(data.subarray(0, 32)).toBase58(), amount: view.getBigUint64(64, true) };
}

function WalletMenu({ address, className }: { address: string; className?: string }) {
  const { connection } = useConnection();
  const { wallet, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const { drip, busy } = useFaucet();
  const guest = wallet?.adapter.name === GuestWalletName;

  /* Balances are read only while somebody is looking at them. */
  const sol = useQuery<number>({
    queryKey: ["sol-balance", address],
    enabled: open,
    queryFn: () => connection.getBalance(new PublicKey(address), "confirmed"),
    refetchInterval: open ? 20_000 : false,
  });

  const holdings = useQuery<Holding[]>({
    queryKey: ["holdings", address],
    enabled: open,
    queryFn: async () => {
      const owner = new PublicKey(address);
      const [classic, t22] = await Promise.all([
        connection.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
        connection.getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
      ]);
      const byTicker = new Map<string, Holding>();
      for (const a of [...classic.value, ...t22.value]) {
        const acct = readTokenAccount(a.account.data);
        if (!acct || acct.amount === BigInt(0)) continue;
        const token = tokenForMint(acct.mint);
        if (!token) continue;
        const had = byTicker.get(token.ticker);
        byTicker.set(token.ticker, {
          ticker: token.ticker,
          raw: (had?.raw ?? BigInt(0)) + acct.amount,
          decimals: token.decimals,
        });
      }
      return [...byTicker.values()];
    },
    refetchInterval: open ? 20_000 : false,
  });

  const tickers = open ? (holdings.data ?? []).map((h) => h.ticker) : [];
  const prices = usePrices(tickers, 10_000);
  const valued = (holdings.data ?? [])
    .map((h) => ({ ...h, usd: stakeValue(h.raw, h.decimals, prices.data?.quotes[h.ticker]) }))
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.ticker.localeCompare(b.ticker));
  const shown = valued.slice(0, MAX_HOLDINGS);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3_000);
    return () => clearTimeout(id);
  }, [armed]);

  /* The async clipboard is refused in some wallets' in-app browsers and in
   * embedded frames, which is exactly where people open this menu on a phone,
   * so the old selection copy is tried before giving up. When both fail the
   * toast carries the full address, to copy by hand. */
  const copy = async () => {
    let done = false;
    try {
      await navigator.clipboard.writeText(address);
      done = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = address;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        done = document.execCommand("copy");
      } catch {
        done = false;
      }
      area.remove();
    }
    if (done) toast.push({ title: "Address copied", check: true, ttlMs: 3_000 });
    else toast.push({ title: "Could not copy the address.", body: address });
  };

  return (
    <div className={className}>
      <Menu
        triggerLabel={`Wallet ${shortAddress(address)}, open menu`}
        triggerClassName="btn btn-sm btn-ghost font-mono normal-case tracking-normal"
        className="w-80"
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setArmed(false);
        }}
        trigger={
          <>
            <span className="hidden sm:inline-flex">
              <Identicon wallet={address} size={14} />
            </span>
            <span className="num">{shortAddress(address)}</span>
          </>
        }
      >
        <MenuItem href={`/u/${address}`} className="gap-3 py-3">
          <Identicon wallet={address} size={28} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <FighterName wallet={address} href={null} avatar={false} />
            <span className="flex min-w-0 items-center gap-2 text-meta text-dim">
              {guest ? <Badge variant="neutral">Guest · devnet</Badge> : <span className="truncate">{wallet?.adapter.name}</span>}
              <span aria-hidden="true">·</span>
              <span className="shrink-0">My profile</span>
            </span>
          </span>
        </MenuItem>

        <div className="border-y border-line px-3 py-3">
          {sol.isError || holdings.isError ? (
            <Notice tone="error" title="Could not reach Solana." className="mb-3 p-3">
              Balances fill in when it answers.
            </Notice>
          ) : null}

          <div className="flex items-baseline justify-between gap-3">
            <span className="label">SOL</span>
            {sol.data !== undefined ? (
              <span className="num text-sm text-ink">{shares(BigInt(sol.data), SOL_DECIMALS)}</span>
            ) : sol.isError ? (
              <span className="num text-sm text-dim">--</span>
            ) : (
              <Skeleton className="h-3 w-16" />
            )}
          </div>

          <p className="label mt-3">Stock tokens</p>
          {holdings.data === undefined && !holdings.isError ? (
            <div aria-busy="true" className="mt-2 flex flex-col gap-2">
              <span className="sr-only">Loading</span>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ) : shown.length > 0 ? (
            <ul className="mt-1">
              {shown.map((h) => (
                <li key={h.ticker} className="flex min-w-0 items-baseline gap-2 py-1">
                  <span className="w-14 shrink-0 truncate font-display text-base font-black uppercase leading-none text-ink">
                    {h.ticker}
                  </span>
                  <span className="num min-w-0 truncate text-meta text-dim">
                    {shares(h.raw, h.decimals)} <span className="normal-case">{tokenSymbol(h.ticker)}</span>
                  </span>
                  <span className={cx("num ml-auto shrink-0 text-meta", h.usd === null ? "text-dim" : "text-ink")}>
                    {h.usd === null ? "no price" : usd(h.usd)}
                  </span>
                </li>
              ))}
              {valued.length > shown.length ? (
                <li className="text-meta text-dim">and {valued.length - shown.length} more</li>
              ) : null}
            </ul>
          ) : holdings.data ? (
            <p className="mt-1 text-meta text-dim">No stock tokens in this wallet yet.</p>
          ) : null}
        </div>

        <div className="py-1">
          <MenuItem href="/fights?tab=mine">My fights</MenuItem>
          {CLUSTER !== "mainnet-beta" ? (
            <MenuItem onSelect={() => void drip()} disabled={busy}>
              {busy ? "Minting..." : "Get test shares"}
            </MenuItem>
          ) : null}
          <MenuItem onSelect={() => void copy()}>Copy address</MenuItem>
          <MenuItem href={explorerAddress(address, CLUSTER)} external>
            View on explorer
            <span aria-hidden="true" className="text-dim">
              &#8599;
            </span>
          </MenuItem>
        </div>
        <div className="border-t border-line py-1">
          <MenuItem
            closeOnSelect={armed}
            onSelect={() => {
              if (armed) {
                setArmed(false);
                disconnect().catch(() => {});
              } else {
                setArmed(true);
              }
            }}
            className={armed ? "font-semibold" : undefined}
          >
            <span aria-live="polite">{armed ? "Click again to disconnect" : "Disconnect"}</span>
          </MenuItem>
        </div>
      </Menu>
    </div>
  );
}
