/* Joins class names and drops the falsy ones, so a conditional class reads as
 * `cx("row", live && "rope")` instead of a template string full of empty
 * quotes. Deliberately tiny: no dedupe and no Tailwind conflict merging, so
 * what is written is exactly what ships. */

export type ClassValue = string | false | null | undefined | 0;

export function cx(...parts: ClassValue[]): string {
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    out = out ? `${out} ${p}` : p;
  }
  return out;
}
