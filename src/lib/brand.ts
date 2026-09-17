/* The brand, in one place, so the name can change without a hunt. */

export const BRAND = {
  name: "Stonk Wars",
  short: "STONK WARS",
  domain: "stonkwars.fun",
  x: "@stonkwarsfun",
  /* "Win, and you own their stock" said two things that are not so. Nobody
   * owns a stock that is still theirs: the shares change hands at the bell, so
   * the sentence has to name the handover, not a contradiction. And what moves
   * is tokenized shares, which is the word the rest of the site uses. */
  tagline: "Win, and their shares are yours.",
  pitch:
    "Stake shares of your tokenized stock. They stake theirs. At the bell, the bigger percentage move takes every share on the table. Signed prices decide it, anyone can settle it, and no house takes a cut.",
} as const;

/* The origin this deployment actually answers on, which is not always the one
 * we intend to own.
 *
 * This string is not decoration. It is the base for og:image and for the icon
 * on every Blink, so pointing it at a domain that does not resolve does not
 * degrade anything gracefully: X unfurls a broken image and the Blink loses its
 * art, on exactly the shares meant to bring people in. Defaulting to the brand
 * domain did that for as long as the DNS was held back.
 *
 * Vercel names the production domain in the environment, and renames it when a
 * custom domain is assigned. Reading it means the preview is right today, right
 * the moment stonkwars.fun starts resolving, and right without anybody
 * remembering to change a variable on the day. An explicit NEXT_PUBLIC_SITE_URL
 * still wins, for anyone hosting this somewhere else; if one is set on Vercel
 * it is worth deleting, because this works out the answer on its own. */
const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL;
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (vercelProduction ? `https://${vercelProduction}` : `https://${BRAND.domain}`);
