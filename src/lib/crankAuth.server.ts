import { timingSafeEqual } from "crypto";

/* Who may make this server spend the crank wallet's SOL on fees.
 *
 * Lives here rather than beside the route because a Next route file may export
 * only handlers and its config; anything else fails the build with "does not
 * match the required types of a Next.js Route". Which is fair enough: this is
 * logic, not a route, and it is the part worth testing. */

const same = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};

export type Verdict = { ok: true } | { ok: false; why: string };

/* Strict about the secret, forgiving about everything around it, and specific
 * about what went wrong.
 *
 * A bare 401 cost hours here. The settler is configured by typing into a web
 * form on another site, and the only place that form ever shows an answer is
 * its execution history, which prints the response body. So the body has to
 * carry the diagnosis; there is nowhere else anyone can look.
 *
 * Nothing sent is ever echoed back. The commonest misconfiguration is the
 * secret pasted with no scheme in front of it, so quoting even a few characters
 * of what arrived would publish the thing this check exists to protect. Lengths
 * and classifications only. */
export function authorise(header: string | null, secret: string | undefined): Verdict {
  const no = (why: string) => ({ ok: false as const, why });

  if (!secret) return no("CRON_SECRET is not set on this deployment, so nothing can authenticate it. Set it in the environment.");
  if (header === null) {
    return no(
      "No Authorization header arrived. Either it is not configured, or it was dropped in transit: " +
        "a redirect strips it, so check the URL is exactly https, with no trailing slash, on the production host.",
    );
  }
  const m = /^(\S+)[ \t]+(\S.*)$/.exec(header.trim());
  if (!m) {
    return no(
      "The Authorization header carries no scheme, just one run of characters. " +
        "The value must read: Bearer <secret>, with a single space after Bearer.",
    );
  }
  const [, scheme, rest] = m;
  if (!/^bearer$/i.test(scheme)) return no(`The scheme is not Bearer. What arrived was ${scheme.length} characters long.`);

  /* A trailing newline on a pasted value is not an intruder, it is a text
   * field, and refusing it teaches nobody anything. */
  const sent = rest.trim();
  if (same(sent, secret.trim())) return { ok: true };
  return no(
    `The token after Bearer does not match CRON_SECRET. It is ${sent.length} characters; ` +
      `${secret.trim().length} were expected. Re-copy the secret and take the whole of it.`,
  );
}
