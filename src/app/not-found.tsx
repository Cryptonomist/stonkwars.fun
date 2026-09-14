import type { Metadata } from "next";

import { Empty } from "@/components/ui/Empty";

/* A bad link lands here instead of the framework's white page. It says what
 * happened in one line and offers the two places a visitor most likely wanted.
 * Fight pages handle their own missing accounts, because a cancelled fight
 * closes its account and that deserves its own explanation. */

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div className="py-6">
      <Empty
        title="Nothing in this corner."
        body="No page lives at this address. Check the link, or start from a fight."
        action={[
          { href: "/new", label: "Pick a fight", tone: "p1" },
          { href: "/fights", label: "All fights", tone: "ghost" },
        ]}
        className="py-16"
      />
    </div>
  );
}
