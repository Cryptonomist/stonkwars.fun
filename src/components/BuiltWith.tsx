import Image from "next/image";

import { PythMark, SolanaMarkBrand } from "@/components/ui/BrandIcons";
import { GROUP_ORDER, INTEGRATIONS, type Integration } from "@/lib/integrations";

/* THE STACK, IN THE FOOTER: WHAT STONK WARS RUNS ON, AND WHAT FOR.
 *
 * Grouped by the job each one does, because "built with" is only worth saying
 * if it says what it is built with them for: the chain and the program, the
 * prices, the stocks, the trading, the wallets. Each row is the owner's logo,
 * the name, and one line of what this app actually does with it.
 *
 * Logos are shown as their owners publish them, in their own colours (the one
 * exception to BrandIcons' ink rule; see there). Each gets a fixed box so a
 * tall mark and a square one sit on the same line, and the clear space several
 * brand kits ask for comes from the gap around the box. Ondo's is its full
 * wordmark, which Ondo asks for when in doubt, so it stands in for the name.
 *
 * Every row links to the owner's site. The line under the grid says what the
 * logos are and are not: integrations, not endorsements. */

const LOGO_BOX = 24;

function Logo({ it }: { it: Integration }) {
  const logo = it.logo;
  if (logo.kind === "solana") return <SolanaMarkBrand size={LOGO_BOX} />;
  if (logo.kind === "pyth") return <PythMark size={LOGO_BOX} className="text-ink" />;
  if (logo.wordmark) {
    const h = 13;
    return <Image src={logo.src} alt="" width={Math.round((h * logo.width) / logo.height)} height={h} unoptimized />;
  }
  /* Fit inside the square box by the longer side. */
  const scale = LOGO_BOX / Math.max(logo.width, logo.height);
  return (
    <Image
      src={logo.src}
      alt=""
      width={Math.round(logo.width * scale)}
      height={Math.round(logo.height * scale)}
      unoptimized={logo.src.endsWith(".svg")}
    />
  );
}

function Row({ it }: { it: Integration }) {
  const wordmark = it.logo.kind === "file" && it.logo.wordmark;
  return (
    <li>
      <a
        href={it.href}
        target="_blank"
        rel="noreferrer"
        aria-label={`${it.name}: ${it.role}. Opens ${it.href.replace(/^https:\/\/(www\.)?/, "")} in a new tab`}
        className="plate group -mx-3 flex min-w-0 flex-col gap-1 px-3 py-2 transition-colors hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none"
      >
        <span className="flex min-h-7 items-center gap-2.5">
          <span
            className={
              wordmark
                ? "flex h-7 shrink-0 items-center"
                : "flex h-7 w-7 shrink-0 items-center justify-center transition-transform duration-150 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            }
          >
            <Logo it={it} />
          </span>
          {wordmark ? null : <span className="truncate text-sm font-semibold text-ink">{it.name}</span>}
        </span>
        <span className="text-meta leading-snug text-dim transition-colors group-hover:text-ink/80">{it.role}</span>
      </a>
    </li>
  );
}

export function BuiltWith() {
  return (
    <section aria-labelledby="built-with" className="flex flex-col gap-6 border-t border-line py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-2">
          <h2 id="built-with" className="label text-ink">
            Built with the Solana ecosystem
          </h2>
          <p className="max-w-xl text-sm text-dim">
            Stonk Wars is Solana all the way down: the chain that holds the stakes, the prices that settle them, the stocks
            people stake, the routes they trade on and the wallets they sign with.
          </p>
        </div>
        <span className="micro num text-faint">{INTEGRATIONS.length} integrations</span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-5">
        {GROUP_ORDER.map((g) => (
          <div key={g} className="flex min-w-0 flex-col gap-2">
            <h3 className="micro text-faint">{g}</h3>
            <ul className="flex flex-col gap-1">
              {INTEGRATIONS.filter((it) => it.group === g).map((it) => (
                <Row key={it.name} it={it} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-meta text-faint">
        Logos belong to their owners. Each names something Stonk Wars is built on or works with, not an endorsement or a
        partnership.
      </p>
    </section>
  );
}
