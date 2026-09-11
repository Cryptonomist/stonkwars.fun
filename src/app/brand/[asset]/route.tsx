/* Brand assets, drawn from the same code as the share cards so the type and
 * colours can never drift from the site:
 *
 *   /brand/pfp.png     400x400, the mark on its cabinet ground, for the X
 *                      profile picture (which X crops to a circle)
 *   /brand/banner.png  1500x500, the X header: the arcade title screen, with
 *                      everything readable kept clear of the bottom-left
 *                      corner the profile picture covers on desktop
 *
 * The directions that were not chosen live at /brand/lab/<name>/<asset>.
 */

import { arcadeBanner, markPfp } from "@/lib/brandArt";

export async function GET(_req: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  if (asset === "pfp.png") return markPfp();
  if (asset === "banner.png") return arcadeBanner();
  return new Response("Not found", { status: 404 });
}
