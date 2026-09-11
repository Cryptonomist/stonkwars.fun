import { ACTION_HEADERS } from "@/lib/actions.server";

/* Tells Blink clients that a fight page (/f/<duel>) has an Action behind it,
 * so a fight link posted on X can unfurl as a card someone can take the fight
 * from, without leaving their feed. */
export const GET = () =>
  new Response(
    JSON.stringify({ rules: [{ pathPattern: "/f/*", apiPath: "/api/actions/fight/*" }] }),
    { headers: ACTION_HEADERS },
  );

export const OPTIONS = () => new Response(null, { headers: ACTION_HEADERS });
