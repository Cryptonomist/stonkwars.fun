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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";

import { shortAddress } from "@/lib/format";
import {
  detectPlatform,
  inWalletBrowser,
  isIpadPretendingToBeAMac,
  MOBILE_WALLETS,
  storeFor,
  type Platform,
} from "@/lib/mobile";

export function WalletButton({ className = "" }: { className?: string }) {
  const { wallets, wallet, select, connect, disconnect, connecting, connected, publicKey } =
    useWallet();

  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const tryConnect = useCallback(() => {
    connect().catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not connect."));
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
      setError(null);
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

  const onClick = useCallback(() => {
    setError(null);
    if (connected) {
      disconnect().catch(() => {});
      return;
    }
    if (needsMobileHelp) {
      setPicking((p) => !p);
      return;
    }
    if (available.length === 0) {
      setError("No Solana wallet found in this browser. Install Phantom or Solflare.");
      return;
    }
    if (available.length === 1) {
      choose(available[0].adapter.name);
      return;
    }
    setPicking((p) => !p);
  }, [connected, disconnect, available, choose, needsMobileHelp]);

  const label = !hydrated
    ? "Connect"
    : connected
      ? shortAddress(publicKey?.toBase58() ?? "", 4)
      : connecting
        ? "Connecting..."
        : "Connect";

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={hydrated && connecting}
        className={`btn btn-sm ${connected && hydrated ? "btn-ghost font-mono !normal-case !tracking-normal" : "btn-gold"}`}
      >
        {label}
      </button>

      {picking && needsMobileHelp ? (
        <div className="card absolute right-0 z-30 mt-2 w-72 p-4">
          <p className="label">Open in a wallet</p>
          <p className="mt-2 text-sm text-dim">
            Phone browsers cannot hold a wallet. Open this page inside a wallet app and it connects
            there.
          </p>
          {handoff ? (
            <button type="button" onClick={() => choose(handoff.adapter.name)} className="btn btn-sm btn-gold mt-3 w-full">
              Use an installed wallet
            </button>
          ) : null}
          <ul className="mt-3 flex flex-col gap-3">
            {MOBILE_WALLETS.map((w) => (
              <li key={w.id} className="flex flex-col gap-1.5">
                <span className="font-display text-lg font-extrabold uppercase">{w.name}</span>
                <span className="text-xs text-dim">{w.note}</span>
                <span className="flex gap-2">
                  <a href={w.browse(href, origin)} className="btn btn-sm btn-gold flex-1">
                    Open
                  </a>
                  <a href={storeFor(w, platform)} target="_blank" rel="noreferrer noopener" className="btn btn-sm btn-ghost flex-1">
                    Install
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {picking && !needsMobileHelp ? (
        <ul className="card absolute right-0 z-30 mt-2 w-60 overflow-hidden">
          {available.map((w) => (
            <li key={w.adapter.name}>
              <button
                type="button"
                onClick={() => choose(w.adapter.name)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-panel-2"
              >
                {w.adapter.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.adapter.icon} alt="" width={20} height={20} className="shrink-0" />
                ) : null}
                {w.adapter.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="card absolute right-0 z-30 mt-2 w-64 p-3 text-xs text-down">{error}</p>
      ) : null}
    </div>
  );
}
