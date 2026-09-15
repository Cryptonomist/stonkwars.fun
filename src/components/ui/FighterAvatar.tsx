"use client";

import { useState } from "react";

import { useProfiles } from "@/lib/hooks";

import { cx } from "./cx";
import { Identicon } from "./Identicon";

/* A fighter's face: their X picture when the chain carries one, their identicon
 * otherwise.
 *
 * Only a wallet with a vouched handle (useProfiles) asks for a picture at all,
 * through the site's own route (app/api/avatar), so a board full of plain
 * wallets makes no requests. A picture that fails to load, including a handle
 * linked before pictures were written, falls back to the identicon and is not
 * asked for again this visit. Same slanted plate as the identicon, so a row
 * lines up either way. */

const failed = new Set<string>();

export function FighterAvatar({ wallet, size = 20, className }: { wallet: string; size?: number; className?: string }) {
  const { data: handles } = useProfiles();
  const handle = handles?.[wallet];
  const key = `${wallet}:${handle ?? ""}`;
  const [broken, setBroken] = useState(() => failed.has(key));

  if (!handle || broken || failed.has(key)) return <Identicon wallet={wallet} size={size} className={className} />;

  const slant = Math.max(2, Math.round(size * 0.2));
  return (
    <span
      aria-hidden="true"
      className={cx("plate inline-flex shrink-0 overflow-hidden bg-panel-2", className)}
      style={{ width: size + slant, height: size, ["--slant" as string]: `${slant}px` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/avatar/${wallet}?h=${encodeURIComponent(handle)}`}
        alt=""
        width={size + slant}
        height={size}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        onError={() => {
          failed.add(key);
          setBroken(true);
        }}
      />
    </span>
  );
}
