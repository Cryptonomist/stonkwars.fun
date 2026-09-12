import Link from "next/link";

/* The shape both legal pages share: a plain column, set wide enough to read
 * and no wider. Nothing decorative. These are meant to be read, and to be
 * short enough that reading them is realistic. */

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
    <div className="py-10">
      <p className="label">Stonk Wars</p>
      <h1 className="display mt-2 text-6xl sm:text-7xl">{title}</h1>
      <p className="mt-3 text-sm text-dim">Last updated {updated}</p>
      <p className="mt-6 max-w-2xl text-lg text-dim">{intro}</p>
      <div className="mt-10 flex max-w-2xl flex-col gap-8">{children}</div>
      <p className="mt-12 max-w-2xl text-sm text-dim">
        Questions: <a className="text-ink underline decoration-line underline-offset-4" href="mailto:hello@stonkwars.fun">hello@stonkwars.fun</a>.
        The other document is{" "}
        <Link className="text-ink underline decoration-line underline-offset-4" href={title === "Privacy" ? "/terms" : "/privacy"}>
          {title === "Privacy" ? "the terms" : "the privacy policy"}
        </Link>
        .
      </p>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="display text-3xl">{title}</h2>
      <div className="mt-2 flex flex-col gap-3 text-dim">{children}</div>
    </section>
  );
}
