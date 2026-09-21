/* Fonts for share cards. Satori needs raw TTF/OTF bytes, not woff2, so this
 * asks Google Fonts for a subset of just the glyphs the card uses, which it
 * serves as TrueType. Returns null on any failure: a card in the fallback face
 * beats no card. */

export async function loadGoogleFont(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(
      Array.from(new Set(text)).join(""),
    )}`;
    const css = await (await fetch(url, { cache: "force-cache", signal: AbortSignal.timeout(3_000) })).text();
    const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
    if (!src) return null;
    const font = await fetch(src[1], { cache: "force-cache", signal: AbortSignal.timeout(3_000) });
    return font.ok ? await font.arrayBuffer() : null;
  } catch {
    return null;
  }
}
