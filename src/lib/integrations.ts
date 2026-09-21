/* WHAT STONK WARS IS BUILT WITH, FOR THE FOOTER.
 *
 * Every entry is something the app actually runs on today, and its line says
 * what for. Nothing here is a partner or a sponsor, and the footer says so:
 * a logo names an integration, not an endorsement. Raydium's brand rules ask
 * for exactly that framing, and it is the honest one for all of them.
 *
 * The counts are read from the same data the pages use, so "831 stocks on the
 * roster" cannot drift from the roster. Before adding a name, check the code
 * really uses it: a logo row is a list of claims.
 *
 * THE FILES. Each logo in public/integrations is the owner's own file, from
 * their site, brand kit or GitHub, fetched on 19 September 2026:
 *   helius.svg      helius.dev/brand (Helius-Icon.svg)
 *   jupiter.svg     jup.ag/svg/jupiter-logo.svg
 *   prestocks.svg   prestocks.com/icon.svg
 *   xstocks.svg     xStocks media kit, the white symbol
 *   ondo.svg        ondo.finance, the white wordmark (Ondo asks for the full
 *                   logo when in doubt, and forbids recolouring)
 *   backpack.svg    Backpack media kit, the white icon
 *   meteora.svg     MeteoraAg/brand-kit, the colour symbol
 *   raydium.png     raydium-io/raydium-docs-v1, logo/raydium-r.png
 *   wormhole.svg    static.wormhole.com/logomark-white.svg
 *   anchor.png      anchor-lang.com/icons/anchor.png
 *   phantom.svg     Phantom docs, Phantom_SVG_Icon.svg
 *   solflare.svg    solflare.com, App-Icon.svg
 * Solana and Pyth are drawn inline (components/ui/BrandIcons.tsx). */

import { PRESTOCKS } from "@/lib/prestocks";
import { ROSTER } from "@/lib/stocks";

export type IntegrationLogo =
  | { kind: "file"; src: string; width: number; height: number; wordmark?: boolean }
  | { kind: "solana" }
  | { kind: "pyth" };

export type IntegrationGroup = "Chain" | "Prices" | "Stocks" | "Trading" | "Wallets";

export type Integration = {
  name: string;
  href: string;
  group: IntegrationGroup;
  /** What Stonk Wars uses it for, in a few words. */
  role: string;
  logo: IntegrationLogo;
};

const onRoster = (issuer: string) => ROSTER.filter((s) => s.issuers.includes(issuer)).length;
const meteoraPools = PRESTOCKS.filter((p) => p.dex === "meteora").length;

const file = (src: string, width: number, height: number, wordmark = false): IntegrationLogo => ({
  kind: "file",
  src: `/integrations/${src}`,
  width,
  height,
  wordmark,
});

export const GROUP_ORDER: IntegrationGroup[] = ["Chain", "Prices", "Stocks", "Trading", "Wallets"];

export const INTEGRATIONS: Integration[] = [
  { name: "Solana", href: "https://solana.com", group: "Chain", role: "Holds every stake, in a program", logo: { kind: "solana" } },
  { name: "Anchor", href: "https://www.anchor-lang.com", group: "Chain", role: "The framework the program is written in", logo: file("anchor.png", 512, 512) },
  { name: "Helius", href: "https://www.helius.dev", group: "Chain", role: "The RPC behind the app's reads and writes", logo: file("helius.svg", 400, 400) },

  { name: "Pyth", href: "https://www.pyth.network", group: "Prices", role: "Settles VOO fights on chain", logo: { kind: "pyth" } },
  { name: "Wormhole", href: "https://wormhole.com", group: "Prices", role: "Signs the Pyth prices the program checks", logo: file("wormhole.svg", 255, 255) },

  { name: "xStocks", href: "https://xstocks.fi", group: "Stocks", role: `${onRoster("xStocks").toLocaleString("en-US")} stocks on the roster`, logo: file("xstocks.svg", 800, 801) },
  { name: "Ondo", href: "https://ondo.finance", group: "Stocks", role: `${onRoster("Ondo").toLocaleString("en-US")} stocks on the roster`, logo: file("ondo.svg", 1512, 186, true) },
  { name: "Backpack", href: "https://backpack.exchange", group: "Stocks", role: `${onRoster("Backpack").toLocaleString("en-US")} stocks on the roster`, logo: file("backpack.svg", 67, 98) },
  { name: "PreStocks", href: "https://prestocks.com", group: "Stocks", role: `${PRESTOCKS.length} companies on the pre-IPO desk`, logo: file("prestocks.svg", 296, 296) },

  { name: "Jupiter", href: "https://jup.ag", group: "Trading", role: "Live quotes and swap routing", logo: file("jupiter.svg", 33, 32) },
  { name: "Meteora", href: "https://www.meteora.ag", group: "Trading", role: `${meteoraPools} of the pre-IPO desk's ${PRESTOCKS.length} pools`, logo: file("meteora.svg", 240, 240) },
  { name: "Raydium", href: "https://raydium.io", group: "Trading", role: "Liquidity via Raydium", logo: file("raydium.png", 565, 653) },

  { name: "Phantom", href: "https://phantom.com", group: "Wallets", role: "Connect and sign, desktop or phone", logo: file("phantom.svg", 128, 128) },
  { name: "Solflare", href: "https://www.solflare.com", group: "Wallets", role: "Connect and sign, desktop or phone", logo: file("solflare.svg", 290, 290) },
  /* JUPITER WALLET WAS LISTED HERE AND TAKEN OUT. It connects through the
   * Wallet Standard like the others, but the fights run on devnet, the owner
   * could find no devnet setting in it, and Jupiter's docs name none. A row in
   * this list is a claim that it works, and that one could not be checked.
   * Jupiter stays under Trading, where what it does here is certain. */
];
