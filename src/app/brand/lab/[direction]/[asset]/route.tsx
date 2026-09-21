import { DIRECTIONS } from "@/lib/brandLab";

/* Candidate brand directions, rendered as they would ship:
 *   /brand/lab/<direction>/pfp.png     400x400
 *   /brand/lab/<direction>/banner.png  1500x500 */
export async function GET(_req: Request, { params }: { params: Promise<{ direction: string; asset: string }> }) {
  /* A workbench, not a page: local development only. In production it was an
   * unlinked URL that rendered an image per request for whoever found it. */
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { direction, asset } = await params;
  const d = DIRECTIONS[direction];
  if (!d) return new Response("No such direction", { status: 404 });
  if (asset === "pfp.png") return d.pfp();
  if (asset === "banner.png") return d.banner();
  return new Response("Not found", { status: 404 });
}
