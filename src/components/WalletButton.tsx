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
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";

import { xStartHref } from "@/components/ConnectX";
import { useFaucet } from "@/components/FaucetButton";
import { Badge } from "@/components/ui/Badge";
import { XLogo } from "@/components/ui/BrandIcons";
import { cx } from "@/components/ui/cx";
import { FighterAvatar } from "@/components/ui/FighterAvatar";
import { FighterName } from "@/components/ui/FighterName";
import { CONNECT_EVENT } from "@/components/ui/intents";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { shares, shortAddress, usd } from "@/lib/format";
import { GuestWalletName } from "@/lib/guestWallet";
import { explorerAddress, useProfiles } from "@/lib/hooks";
import {
  detectPlatform,
  inWalletBrowser,
  isIpadPretendingToBeAMac,
  MOBILE_WALLETS,
  storeFor,
  type Platform,
} from "@/lib/mobile";
import { CLUSTER, tokenSymbol } from "@/lib/stocks";
import { SOL_DECIMALS, useHoldings } from "@/lib/useHoldings";

type Problem = { title: string; body: string };

export function WalletButton({ className = "" }: { className?: string }) {
  const { wallets, wallet, select, connect, connecting, connected, publicKey } = useWallet();
  const pathname = usePathname();

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
    /* Even with one wallet the sheet opens, because "Continue with X" sits in
     * it too. Mid sign-in (XLinkSheet sent us here) a lone wallet is picked
     * straight away, since X is already done. */
    if (available.length === 1 && /[?&]x=sign\b/.test(window.location.search)) {
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

  /* X first in the sheet: sign in with X, come back to this page, then pick a
   * wallet for the handle (ConnectX). Hidden while that sign-in is already
   * waiting for its wallet. */
  const here = pathname || "/";
  const xRow = picking && typeof window !== "undefined" && /[?&]x=sign\b/.test(window.location.search) ? null : (
    <a
      href={xStartHref(here)}
      className="row flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left focus-visible:-outline-offset-2"
    >
      <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center bg-ink text-void">
        <XLogo size={13} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold text-ink">Continue with X</span>
        <span className="text-meta text-dim">Fight under your X name and picture, then pick a wallet.</span>
      </span>
    </a>
  );

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
        title={needsMobileHelp ? "Open in a wallet" : "Connect"}
      >
        <div className="flex flex-col gap-4">
          {xRow ? <div className="bg-line">{xRow}</div> : null}
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

const MAX_HOLDINGS = 8;

function WalletMenu({ address, className }: { address: string; className?: string }) {
  const { wallet, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const { drip, busy } = useFaucet();
  const guest = wallet?.adapter.name === GuestWalletName;
  const profiles = useProfiles();

  /* Balances are read only while somebody is looking at them (lib/useHoldings). */
  const { sol, holdings, valued, total } = useHoldings(address, open);
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
              <FighterAvatar wallet={address} size={14} />
            </span>
            <span className="num">{shortAddress(address)}</span>
          </>
        }
      >
        <MenuItem href={`/u/${address}`} className="gap-3 py-3">
          <FighterAvatar wallet={address} size={28} />
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

          <p className="mt-3 flex items-baseline justify-between gap-3">
            {/* On devnet these are test tokens, and the total says so. */}
            <span className="label">{CLUSTER !== "mainnet-beta" ? "Test shares" : "Stock tokens"}</span>
            {total !== null ? <span className="num text-meta text-ink">{usd(total)} now</span> : null}
          </p>
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
          <MenuItem href="/trade">Buy or sell shares</MenuItem>
          <MenuItem href="/fights?tab=mine">My fights</MenuItem>
          {/* Every board shows a wallet as an address until its owner links an X
            * handle, and this menu is where people look for account actions. The
            * link flow lives on the wallet's own profile (ConnectX), so the item
            * goes there, and only while the chain vouches for no handle. */}
          {profiles.isSuccess && !profiles.data?.[address] ? (
            <MenuItem href={`/u/${address}#connect-x`}>Show my X handle</MenuItem>
          ) : null}
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
