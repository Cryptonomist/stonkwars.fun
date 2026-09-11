/* Getting into a wallet from a phone browser. Carried over from Commish.
 *
 * On a phone there is no extension to find, so the way in is the wallet's own
 * in-app browser: a universal link hands it this URL, the wallet injects
 * itself, and the Wallet Standard finds it exactly as it does on a desktop. A
 * web page cannot ask a phone what is installed (both platforms removed that
 * as a fingerprinting surface), so the honest move is to offer the link and put
 * the store beside it. The Phantom link is the exact string
 * @solana/wallet-adapter-phantom redirects to; Solflare's is from its own docs.
 */

export type Platform = "ios" | "android" | "desktop";

export function detectPlatform(userAgent: string): Platform {
  const ua = userAgent.toLowerCase();
  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios";
  return "desktop";
}

/** iPadOS 13+ pretends to be a Mac. A Mac with a touch screen is an iPad. */
export function isIpadPretendingToBeAMac(userAgent: string, maxTouchPoints: number): boolean {
  return /macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export type MobileWallet = {
  id: string;
  name: string;
  note: string;
  browse: (href: string, origin: string) => string;
  store: { ios: string; android: string };
};

export const MOBILE_WALLETS: MobileWallet[] = [
  {
    id: "phantom",
    name: "Phantom",
    note: "The one most people already have.",
    browse: (href, origin) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(origin)}`,
    store: {
      ios: "https://apps.apple.com/app/phantom-solana-wallet/id1598432977",
      android: "https://play.google.com/store/apps/details?id=app.phantom",
    },
  },
  {
    id: "solflare",
    name: "Solflare",
    note: "Solana only, with a documented browse link.",
    browse: (href, origin) =>
      `https://solflare.com/ul/v1/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(origin)}`,
    store: {
      ios: "https://apps.apple.com/app/solflare/id1580902717",
      android: "https://play.google.com/store/apps/details?id=com.solflare.mobile",
    },
  },
];

export function storeFor(w: MobileWallet, platform: Platform): string {
  return platform === "android" ? w.store.android : w.store.ios;
}

/** Already inside a wallet's in-app browser: an injected wallet is present. */
export function inWalletBrowser(userAgent: string): boolean {
  return /phantom|solflare|backpack|jupiter/i.test(userAgent);
}
