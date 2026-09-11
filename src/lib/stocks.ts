/* The roster: which stocks can fight, their Pyth feeds, and (per cluster) the
 * token each one is staked as.
 *
 * Feed ids are Pyth's, identical on every chain: Equity.US.<TICKER>/USD. The
 * mints are not. On devnet they are test mints the setup script creates and
 * registers (src/data/stocks.devnet.json); on mainnet they would be the issuer's
 * tokenized shares. A stock with no mint on this cluster is shown with its
 * price but cannot be staked.
 */

import { PublicKey } from "@solana/web3.js";

import devnet from "@/data/stocks.devnet.json";
import { TOKEN_2022_PROGRAM_ID, type StakeAsset } from "@/lib/duel";

export type Stock = {
  ticker: string;
  name: string;
  /** Pyth feed id, hex, no 0x. */
  feed: string;
  /** Accent for the ticker badge. */
  color: string;
};

export const ROSTER: Stock[] = [
  { ticker: "NVDA", name: "NVIDIA", feed: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", color: "#76B900" },
  { ticker: "TSLA", name: "Tesla", feed: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", color: "#E82127" },
  { ticker: "AAPL", name: "Apple", feed: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688", color: "#A2AAAD" },
  { ticker: "MSFT", name: "Microsoft", feed: "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1", color: "#00A4EF" },
  { ticker: "GOOGL", name: "Alphabet", feed: "5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6", color: "#4285F4" },
  { ticker: "AMZN", name: "Amazon", feed: "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a", color: "#FF9900" },
  { ticker: "META", name: "Meta", feed: "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe", color: "#0866FF" },
  { ticker: "AMD", name: "AMD", feed: "3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e", color: "#ED1C24" },
  { ticker: "PLTR", name: "Palantir", feed: "11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0", color: "#C9CBCC" },
  { ticker: "COIN", name: "Coinbase", feed: "fee33f2a978bf32dd6b662b65ba8083c6773b494f8401194ec1870c640860245", color: "#0052FF" },
  { ticker: "HOOD", name: "Robinhood", feed: "306736a4035846ba15a3496eed57225b64cc19230a50d14f3ed20fd7219b7849", color: "#CCFF00" },
  { ticker: "MSTR", name: "Strategy", feed: "e1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09", color: "#F7931A" },
  { ticker: "SPY", name: "S&P 500 ETF", feed: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5", color: "#E6E6E6" },
  { ticker: "QQQ", name: "Nasdaq-100 ETF", feed: "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d", color: "#8C3FFF" },
];

export const CLUSTER = (process.env.NEXT_PUBLIC_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta";

type Deployment = {
  tokenProgram: string;
  decimals: number;
  mints: Record<string, string>;
};

const DEPLOYMENTS: Record<string, Deployment> = { devnet: devnet as Deployment };

const deployment: Deployment | undefined = DEPLOYMENTS[CLUSTER];

export const STAKE_DECIMALS = deployment?.decimals ?? 8;

export const byTicker = (ticker: string) => ROSTER.find((s) => s.ticker === ticker);
export const byFeed = (feed: string) =>
  ROSTER.find((s) => s.feed === feed.replace(/^0x/, "").toLowerCase());

/** The token a stock is staked as on this cluster, or null if it has none. */
export function stakeAssetFor(ticker: string): StakeAsset | null {
  const mint = deployment?.mints[ticker];
  if (!mint) return null;
  return {
    mint: new PublicKey(mint),
    tokenProgram: new PublicKey(deployment?.tokenProgram ?? TOKEN_2022_PROGRAM_ID.toBase58()),
  };
}

export function tickerForMint(mint: PublicKey | string): string | undefined {
  const m = typeof mint === "string" ? mint : mint.toBase58();
  return Object.entries(deployment?.mints ?? {}).find(([, v]) => v === m)?.[0];
}

/** "NVDAx": the tokenized share's symbol. */
export const tokenSymbol = (ticker: string) => `${ticker}x`;
