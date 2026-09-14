import { cx } from "./cx";

/* The last results, oldest on the left, newest on the right.
 *
 *   W  a filled green square: a win is money taken
 *   L  a faint outline, not red: red means a price went down, and a loss in a
 *      record is not a price move
 *   T  a short dim bar: a dead heat, both stakes home
 *
 * Screen readers get the tally as one sentence instead of a row of squares. */

export type FormResult = "W" | "L" | "T";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function formLabel(results: readonly FormResult[]): string {
  if (results.length === 0) return "No results yet";
  const w = results.filter((r) => r === "W").length;
  const l = results.filter((r) => r === "L").length;
  const t = results.filter((r) => r === "T").length;
  const parts = [plural(w, "win", "wins"), plural(l, "loss", "losses")];
  if (t > 0) parts.push(plural(t, "tie", "ties"));
  return `${parts.join(", ")} in the last ${results.length}`;
}

export function FormPips({
  results,
  max = 10,
  className,
}: {
  results: readonly FormResult[];
  max?: number;
  className?: string;
}) {
  const shown = results.slice(-max);
  return (
    <span role="img" aria-label={formLabel(shown)} className={cx("inline-flex shrink-0 items-center gap-0.5", className)}>
      {shown.length === 0 ? (
        <span className="h-0.5 w-3 bg-faint" />
      ) : (
        shown.map((r, i) =>
          r === "W" ? (
            <span key={i} className="h-1.5 w-1.5 bg-up" />
          ) : r === "L" ? (
            <span key={i} className="h-1.5 w-1.5 border border-faint" />
          ) : (
            <span key={i} className="flex h-1.5 w-1.5 items-center">
              <span className="h-0.5 w-full bg-dim" />
            </span>
          ),
        )
      )}
    </span>
  );
}
