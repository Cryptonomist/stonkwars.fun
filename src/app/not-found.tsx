import type { Metadata } from "next";

import { LiveBoard } from "@/components/LiveBoard";
import { Empty } from "@/components/ui/Empty";
import { SectionHead } from "@/components/ui/SectionHead";

/* A bad link lands here instead of the framework's white page. It says what
 * happened in one line and offers the two places a visitor most likely wanted.
 * Fight pages handle their own missing accounts, because a cancelled fight
 * closes its account and that deserves its own explanation.
 *
 * Under the message sits the ring itself, four rows of what is really on
 * chain, so a dead link still lands somewhere with a fight in it. */

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div className="flex flex-col gap-6 py-6">
      <Empty
        title="Nothing in this corner."
        body="No page lives at this address. Check the link, or start from a fight."
        action={[
          { href: "/new", label: "Pick a fight", tone: "p1" },
          { href: "/fights", label: "All fights", tone: "ghost" },
        ]}
        className="py-10"
      />
      <section aria-labelledby="nf-ring" className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-2">
        <SectionHead id="nf-ring" title="In the ring" action={{ href: "/fights", label: "All fights" }} />
        <LiveBoard limit={4} />
      </section>
    </div>
  );
}
