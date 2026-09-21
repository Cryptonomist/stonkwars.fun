/* One sparring tick, run by hand, with the reasons it skipped what it skipped.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/_spar-tick.ts
 *
 * The same sparTick the crank runs every minute, so this really does take
 * fights and really does spend the sparring wallet's devnet SOL. It exists for
 * the question a tick cannot answer from outside: not "did it take anything"
 * but "why not". Env comes from .env.local, which the wrapper sources. */

import { sparConnection, sparKeys, sparTick } from "../src/lib/spar.server";

async function main() {
  const keys = sparKeys();
  if ("error" in keys) {
    console.log("not configured:", keys.error);
    return;
  }
  const tick = await sparTick(sparConnection(), keys);

  console.log(`takes: ${tick.takes.length}`);
  for (const t of tick.takes) {
    console.log(t.ok ? `  TOOK  ${t.duel}` : `  skip  ${t.skipped}`);
  }
  console.log(`seats: ${tick.seats.length}`);
  for (const s of tick.seats) {
    const one = s as Record<string, unknown>;
    console.log(`  ${"opened" in one ? "opened" : "skip"}  ${JSON.stringify(one).slice(0, 140)}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(1);
});
