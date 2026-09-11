/* The brand, in one place, so the name can change without a hunt. */

export const BRAND = {
  name: "Stonk Wars",
  short: "STONK WARS",
  domain: "stonkwars.fun",
  x: "@stonkwars",
  tagline: "Win, and you own their stock.",
  pitch:
    "Stake real tokenized shares of your stock. They stake theirs. At the bell, whichever moved more in percent takes every share on the table. Signed prices decide it, anyone can settle it, and no house takes a cut.",
} as const;

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || `https://${BRAND.domain}`;
