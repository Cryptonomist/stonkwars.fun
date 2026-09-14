import { cx } from "./cx";

/* WHILE LOADING, SHOW THE SHAPE, NEVER A NUMBER. A zero or a placeholder row
 * shown before the chain answers is a value that never existed, and on a board
 * that claims to be live it is a lie for a second or two. A skeleton the size
 * and shape of the real row says "coming" and nothing else, and the page does
 * not jump when the data lands. The shimmer runs only while it is on screen,
 * and holds still under reduced motion. */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden="true" />;
}

export type SkeletonKind = "fight" | "quote" | "fighter" | "event";

/* Fight rows are 64px, rail rows (quotes, fighters, wire events) 36px, which
 * are the heights the real rows keep. The pieces inside sit roughly where the
 * real row puts its ticker, status and number. */
function SkeletonRow({ kind }: { kind: SkeletonKind }) {
  if (kind === "fight") {
    return (
      <div className="card grid h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-3">
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-2.5 w-24 max-w-full" />
        </div>
        <Skeleton className="h-4.5 w-14" />
        <div className="flex min-w-0 flex-col items-end gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-2.5 w-24 max-w-full" />
        </div>
      </div>
    );
  }
  return (
    <div className="card flex h-9 items-center gap-3 px-3">
      {kind === "fighter" ? <Skeleton className="h-4 w-5 shrink-0" /> : null}
      <Skeleton className={cx("h-3", kind === "event" ? "w-10" : "w-14")} />
      <Skeleton className={cx("h-2.5 min-w-0", kind === "event" ? "flex-1" : "w-20")} />
      <Skeleton className="ml-auto h-3 w-12 shrink-0" />
    </div>
  );
}

export function SkeletonRows({
  kind,
  rows = 3,
  className,
}: {
  kind: SkeletonKind;
  rows?: number;
  className?: string;
}) {
  return (
    <div aria-busy="true" className={cx("flex flex-col gap-2", className)}>
      <span className="sr-only" role="status">
        Loading
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} kind={kind} />
      ))}
    </div>
  );
}
