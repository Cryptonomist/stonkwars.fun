"use client";

import Link from "next/link";

import { shortAddress } from "@/lib/format";
import { useProfiles } from "@/lib/hooks";

import { Badge } from "./Badge";
import { cx } from "./cx";
import { Identicon } from "./Identicon";

/* Who is fighting, the same way on every page.
 *
 * The X handle shows only when the chain vouches for it (a Profile whose X
 * account points back at the same wallet, which is what useProfiles checks).
 * Otherwise it is the wallet, shortened one way everywhere (4...4) and in mono,
 * because an address is something people compare character by character. The
 * full address is always one hover away.
 *
 * Handles are ink, never a side colour: the same person can be cyan in one
 * fight and pink in the next. `href={null}` renders no link, for use inside a
 * row that is already a link. */

const SIZE = {
  sm: { avatar: 14, text: "text-meta", gap: "gap-1.5" },
  md: { avatar: 18, text: "text-sm", gap: "gap-2" },
  lg: { avatar: 24, text: "text-num-lg", gap: "gap-2.5" },
} as const;

export function FighterName({
  wallet,
  href,
  size = "md",
  avatar = true,
  you = false,
  className,
}: {
  wallet: string;
  href?: string | null;
  size?: "sm" | "md" | "lg";
  avatar?: boolean;
  you?: boolean;
  className?: string;
}) {
  const { data: handles } = useProfiles();
  const handle = handles?.[wallet];
  const s = SIZE[size];
  const to = href === undefined ? `/u/${wallet}` : href;

  const name = handle ? (
    <span className={cx("min-w-0 truncate font-sans font-semibold text-ink", s.text)}>@{handle}</span>
  ) : (
    <span className={cx("num min-w-0 truncate text-dim", s.text)}>{shortAddress(wallet)}</span>
  );

  const inner = (
    <>
      {avatar ? <Identicon wallet={wallet} size={s.avatar} /> : null}
      {name}
      {you ? <Badge variant="neutral">You</Badge> : null}
    </>
  );

  const box = cx("inline-flex max-w-full min-w-0 items-center align-middle", s.gap, className);

  if (!to) {
    return (
      <span className={box} title={wallet}>
        {inner}
      </span>
    );
  }
  return (
    <Link
      href={to}
      title={wallet}
      className={cx(box, "decoration-line-strong underline-offset-4 hover:underline")}
    >
      {inner}
    </Link>
  );
}
