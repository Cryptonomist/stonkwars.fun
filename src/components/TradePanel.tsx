"use client";

/* BUY AND SELL, WITHOUT LEAVING THE PAGE.
 *
 * A stock's token against USDC or SOL, routed by Jupiter. The panel asks the
 * server for a live quote as the amount changes, shows what you get, the worst
 * case after slippage, the price impact, the route and the fee, and hands the
 * transaction to your wallet to sign. Stonk Wars never holds a key or a balance:
 * the swap is between your wallet and the market, in one transaction you sign.
 *
 * Only mainnet has markets for these tokens. On devnet the same quote shows,
 * labelled as the mainnet price for reference, and the button is the faucet's
 * free test shares instead. */

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { FaucetButton } from "@/components/FaucetButton";
import { cx } from "@/components/ui/cx";
import { requestConnect } from "@/components/ui/intents";
import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { readableProgramError } from "@/lib/duel";
import { sendAndConfirm } from "@/lib/send";
import { byPreTicker } from "@/lib/prestocks";
import { CLUSTER, tokenSymbol } from "@/lib/stocks";
import { DEFAULT_SLIPPAGE_BPS, SLIPPAGE_CHOICES, type PayWith, type QuoteResponse, type Side } from "@/lib/swap";
import { useHoldings } from "@/lib/useHoldings";

const CHIPS: Record<PayWith, string[]> = { USDC: ["25", "50", "100"], SOL: ["0.1", "0.25", "0.5"] };
const QUOTE_EVERY_MS = 15_000;

const fmt = (n: number, max = 6) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : max, minimumFractionDigits: 0 });

export function TradePanel({
  ticker,
  className,
  initialSide = "buy",
  initialAmount,
  embedded = false,
  onTraded,
}: {
  ticker: string;
  className?: string;
  initialSide?: Side;
  /** What the amount box starts at: USDC for a buy, shares for a sell. */
  initialAmount?: string;
  /** Inside a sheet that has its own title: no card, no heading, no page anchor. */
  embedded?: boolean;
  /** Told once a trade has landed, so a sheet can close itself. */
  onTraded?: () => void;
}) {
  const onMainnet = CLUSTER === "mainnet-beta";
  /* A private company: no exchange, no faucet, and never stakeable. */
  const preIpo = byPreTicker(ticker);
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const qc = useQueryClient();

  const [side, setSide] = useState<Side>(initialSide);
  const [pay, setPay] = useState<PayWith>("USDC");
  /* 25 is dollars. Opened straight on Sell (the phone bar, "Sell" beside a
   * holding) it was read as 25 SHARES, a $9,000 sale of TSLA as the first thing
   * on screen; a sell starts from the small amount choose() uses. */
  const [amount, setAmount] = useState(initialAmount ?? (initialSide === "buy" ? "25" : "0.05"));
  const [debounced, setDebounced] = useState(amount);
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [busy, setBusy] = useState(false);

  const symbol = tokenSymbol(ticker);
  const holdings = useHoldings(onMainnet && publicKey ? publicKey.toBase58() : null, onMainnet && !!publicKey);
  const held = holdings.valued.find((h) => h.ticker === ticker);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(amount), 350);
    return () => clearTimeout(id);
  }, [amount]);

  // Switching sides starts from an amount that makes sense for that side.
  const choose = (next: Side) => {
    setSide(next);
    setAmount(next === "buy" ? CHIPS[pay][0] : held ? String(Number(held.raw) / 10 ** held.decimals) : "0.05");
  };

  const quote = useQuery<QuoteResponse, Error>({
    queryKey: ["swap-quote", side, ticker, pay, debounced, slippageBps],
    enabled: Number(debounced) > 0,
    queryFn: async () => {
      const q = new URLSearchParams({ side, ticker, pay, amount: debounced, slippageBps: String(slippageBps) });
      const r = await fetch(`/api/swap/quote?${q}`, { cache: "no-store" });
      const body = (await r.json()) as QuoteResponse & { error?: string };
      if (!r.ok) throw new Error(body.error ?? "No quote right now");
      return body;
    },
    refetchInterval: QUOTE_EVERY_MS,
    retry: false,
  });
  const s = quote.data?.summary;
  /* THE REAL TOKEN'S MINT, FROM THE QUOTE ALREADY ON SCREEN. This used to be
   * looked up in lib/swapPairs.ts, whose own first line says "server and tests
   * only": it carries the whole mainnet token list, and importing it here put
   * 230 kB of data into every page with a ticket, to build one link. The quote
   * names the same mint: what is bought on a buy, what is sold on a sell. */
  const realMint = quote.data ? (side === "buy" ? quote.data.quote.outputMint : quote.data.quote.inputMint) : null;

  const inputSymbol = side === "buy" ? pay : symbol;
  const chips = useMemo(() => {
    if (side === "buy") return CHIPS[pay].map((v) => ({ label: pay === "USDC" ? `$${v}` : `${v} SOL`, value: v }));
    if (!held || held.raw === 0n) return [];
    const whole = Number(held.raw) / 10 ** held.decimals;
    return [0.25, 0.5, 1].map((f) => ({ label: f === 1 ? "Max" : `${f * 100}%`, value: String(+(whole * f).toFixed(held.decimals)) }));
  }, [side, pay, held]);

  async function trade() {
    if (!publicKey || !signTransaction) {
      requestConnect();
      return;
    }
    if (!quote.data) return;
    setBusy(true);
    try {
      const r = await fetch("/api/swap/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote: quote.data.quote, user: publicKey.toBase58(), feeAccount: quote.data.feeAccount }),
      });
      const body = (await r.json()) as { transaction?: string; lastValidBlockHeight?: number; error?: string };
      if (!r.ok || !body.transaction) throw new Error(body.error ?? "Could not build the trade");
      const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
      const signed = await signTransaction(tx);
      const signature = await sendAndConfirm(connection, signed, {
        blockhash: tx.message.recentBlockhash,
        lastValidBlockHeight: body.lastValidBlockHeight ?? 0,
      });
      toast.push({
        title: side === "buy" ? `Bought about ${fmt(s!.output.amount)} ${symbol}` : `Sold ${fmt(s!.input.amount)} ${symbol}`,
        check: true,
        href: `https://solscan.io/tx/${signature}`,
        hrefLabel: "View",
      });
      await qc.invalidateQueries();
      onTraded?.();
    } catch (e) {
      toast.push({ title: "The trade did not go through.", body: readableProgramError(e) });
    } finally {
      setBusy(false);
    }
  }

  const tab = (value: Side, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={side === value}
      onClick={() => choose(value)}
      className={cx("btn btn-sm flex-1", side === value ? (value === "buy" ? "btn-buy" : "btn-sell") : "btn-ghost")}
    >
      {label}
    </button>
  );

  const body = (
    <>
      {embedded ? null : (
        <SectionHead id="trade-head" title={`Trade ${symbol}`} count={onMainnet ? "Solana mainnet" : "Mainnet prices"} />
      )}

      <div role="tablist" aria-label="Buy or sell" className="flex gap-2">
        {tab("buy", "Buy")}
        {tab("sell", "Sell")}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="trade-amount" className="label">
            {side === "buy" ? "You pay" : "You sell"}
          </label>
          <div role="group" aria-label={side === "buy" ? "Pay with" : "Receive"} className="flex gap-1">
            {(["USDC", "SOL"] as PayWith[]).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={pay === p}
                onClick={() => {
                  setPay(p);
                  if (side === "buy") setAmount(CHIPS[p][0]);
                }}
                className={cx("btn btn-sm num px-2", pay === p ? "btn-light" : "btn-ghost")}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <input
            id="trade-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className="input num min-w-0 flex-1 py-2"
          />
          <span className="num shrink-0 text-sm text-dim">{inputSymbol}</span>
        </div>
        {chips.length ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                aria-pressed={amount === c.value}
                onClick={() => setAmount(c.value)}
                className={cx("btn btn-sm num", amount === c.value ? "btn-light" : "btn-ghost")}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : side === "sell" && onMainnet && publicKey ? (
          <p className="text-meta text-dim">No {symbol} in this wallet yet.</p>
        ) : null}
      </div>

      <dl className="flex flex-col border-t border-line text-sm" aria-live="polite">
        {quote.isError ? (
          <p className="py-3 text-sm text-dim">{quote.error.message}</p>
        ) : !s ? (
          <div className="flex flex-col gap-2 py-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <>
            <Row label="You get">
              <span className="num text-ink">
                {fmt(s.output.amount)} {s.output.symbol}
              </span>
            </Row>
            <Row label="At least" hint="What the trade still fills at after the slippage you allow; below this it cancels.">
              <span className="num">
                {fmt(s.output.minimum)} {s.output.symbol}
              </span>
            </Row>
            <Row label="Price">
              <span className="num">
                {pay === "USDC" ? `$${fmt(s.pricePerShare, 2)}` : `${fmt(s.pricePerShare)} SOL`} per share
              </span>
            </Row>
            <Row label="Price impact">
              {/* Ink and weight, not red: red here means a price fell. */}
              <span className={cx("num", s.priceImpactPct >= 1 ? "font-semibold text-ink" : "")}>
                {s.priceImpactPct.toFixed(2)}%{s.priceImpactPct >= 1 ? " · high" : ""}
              </span>
            </Row>
            {s.fee ? (
              <Row label="Stonk Wars fee">
                <span className="num">
                  {(s.fee.bps / 100).toFixed(2)}% ({fmt(s.fee.amount)} {s.fee.symbol})
                </span>
              </Row>
            ) : null}
            <Row label="Route">
              <span className="truncate">{s.route.join(", ") || "Jupiter"}</span>
            </Row>
          </>
        )}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Slippage</span>
        {SLIPPAGE_CHOICES.map((bps) => (
          <button
            key={bps}
            type="button"
            aria-pressed={slippageBps === bps}
            onClick={() => setSlippageBps(bps)}
            className={cx("btn btn-sm num px-2", slippageBps === bps ? "btn-light" : "btn-ghost")}
          >
            {bps / 100}%
          </button>
        ))}
      </div>

      {onMainnet ? (
        <button
          type="button"
          onClick={() => void trade()}
          disabled={busy || (!!publicKey && !s)}
          className={cx("btn min-h-11 w-full", side === "buy" ? "btn-buy" : "btn-sell")}
        >
          {!publicKey ? "Connect to trade" : busy ? "Confirm in your wallet..." : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
        </button>
      ) : (
        <Notice title="These are live mainnet prices, for reference.">
          {/* A private company has no test version. The faucet mints test
            * shares of listed stocks so a fight can be had on devnet, and there
            * is no fight to have here, so offering a faucet button would be
            * offering something that does not exist. */}
          {preIpo ? (
            <span className="flex flex-col gap-2">
              <span>
                {preIpo.name} trades on Solana mainnet only. There is no test version of a private company, so this
                price is the real one and the buy happens in your own wallet.
              </span>
              <a
                href={`https://jup.ag/swap/USDC-${preIpo.mint}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm btn-buy self-start"
              >
                Buy {preIpo.name} on Jupiter
              </a>
            </span>
          ) : (
            /* Both doors, not one. The faucet is how somebody tries a fight in
             * thirty seconds without funding a wallet, which is the point of
             * running the fights on devnet at all. But the token beside it is
             * real and trades on mainnet right now, and until this said so the
             * only way to buy one from here was to already know that. The
             * PreStocks branch above has offered exactly this link all along. */
            <span className="flex flex-col gap-2">
              <span>
                Fights here run on devnet, where the shares are free. The real {symbol} trades on Solana mainnet, in
                your own wallet.
              </span>
              <span className="flex flex-wrap gap-2">
                <FaucetButton tickers={[ticker]} label={`Get test ${symbol}`} className="self-start" />
                {realMint ? (
                  <a
                    href={`https://jup.ag/swap/USDC-${realMint}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-sm btn-buy self-start"
                  >
                    Buy the real one on Jupiter
                  </a>
                ) : null}
              </span>
            </span>
          )}
        </Notice>
      )}

      <p className="text-meta text-dim">
        Routed by Jupiter. You sign in your own wallet; Stonk Wars never holds your funds. These tokens are not offered
        to US persons, and the issuer&apos;s terms restrict them to holders who are not.
      </p>
    </>
  );

  if (embedded) return <div className={cx("flex flex-col gap-4", className)}>{body}</div>;
  return (
    <Plate as="section" pad="std" id="trade" className={cx("flex scroll-mt-20 flex-col gap-4", className)} aria-labelledby="trade-head">
      {body}
    </Plate>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 min-w-0 items-center justify-between gap-3 border-b border-line py-1.5" title={hint}>
      <dt className="label shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right text-dim">{children}</dd>
    </div>
  );
}
