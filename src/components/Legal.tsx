import Link from "next/link";

import { PageHeader } from "@/components/ui/PageHeader";

/* The shape both legal pages share: a plain column, set wide enough to read
 * and no wider. Nothing decorative. These are meant to be read, and to be
 * short enough that reading them is realistic.
 *
 * The column is the one /how reads in: 68 characters, centred on the page, with
 * the page title at the size every other page uses. A reader moving between
 * the rules and the terms finds the text where they left it, instead of a
 * 72px heading and a column that starts somewhere else. */

export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-[68ch] pb-10 text-base">
      <PageHeader eyebrow="Stonk Wars" title={title} className="pb-2" />
      <p className="text-meta text-dim">Last updated {updated}</p>
      <p className="mt-6 text-ink">{intro}</p>
      <div className="mt-10 flex flex-col gap-10">{children}</div>
      <p className="mt-16 border-t border-line pt-6 text-sm text-dim">
        Questions:{" "}
        <a className="link" href="mailto:hello@stonkwars.fun">
          hello@stonkwars.fun
        </a>
        . The other document is{" "}
        <Link className="link" href={title === "Privacy" ? "/terms" : "/privacy"}>
          {title === "Privacy" ? "the terms" : "the privacy policy"}
        </Link>
        .
      </p>
    </article>
  );
}

/* Links inside a section come from the pages themselves. They are held to the
 * same underline as .link here (a line-strong rule that turns ink on hover), so
 * a link reads the same in the body as in the footer line. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="h-section">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-dim [&_a]:decoration-line-strong [&_a:hover]:decoration-ink">
        {children}
      </div>
    </section>
  );
}
