/* The brand, in one place, so the name can change without a hunt. */

export const BRAND = {
  name: "Stonk Wars",
  short: "STONK WARS",
  domain: "stonkwars.fun",
  x: "@stonkwars",
  tagline: "Your stock vs theirs. Loser gets cooked.",
  pitch:
    "Stake real tokenized shares on your stock. Your friend stakes theirs. At the bell, whichever moved more takes both stakes. Pyth prices decide, not us.",
} as const;

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || `https://${BRAND.domain}`;
