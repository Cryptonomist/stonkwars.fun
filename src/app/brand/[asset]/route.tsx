/* Brand assets, drawn from the same code as the share cards so the type and
 * colours can never drift from the site:
 *
 *   /brand/pfp.png     400x400, the mark on its cabinet ground, for the X
 *                      profile picture (which X crops to a circle)
 *   /brand/banner.png  1500x500, the X header: the arcade title screen over a
 *                      battle royale of tickers, with everything readable
 *                      kept clear of the bottom-left corner the profile
 *                      picture covers on desktop
 *
 * The directions that were not chosen are in the repository's history
 * (lib/brandLab.tsx, removed before the repo went public).
 */

import { battleBanner, markPfp } from "@/lib/brandArt";

export async function GET(_req: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  if (asset === "pfp.png") return markPfp();
  if (asset === "banner.png") return battleBanner();
  return new Response("Not found", { status: 404 });
}
