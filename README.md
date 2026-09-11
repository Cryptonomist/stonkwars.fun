<div align="center">

# STONK WARS

**Your stock vs theirs. Loser gets cooked.**

Stake real tokenized shares on your stock. Your friend stakes theirs.
At the bell, whichever moved more takes both stakes. Pyth prices decide, not us.

[stonkwars.fun](https://stonkwars.fun) · Built on Solana · Prices by Pyth · Entry for [Stocklana](https://hackathons.solana.com/hackathons/stocklana)

</div>

---

## The idea

Every group chat has the argument. *NVDA is going to eat TSLA this week.* Somebody says bet, and then nothing happens, because there is no way to put the stock where your mouth is. A brokerage cannot hold a bet between two friends, a sportsbook will not take one on a stock, and a prediction market needs a market maker and an order book for a two-person grudge.

Tokenized stocks make it one transaction. You stake shares of the stock you back; whoever takes the fight stakes the same dollar value of theirs. At the bell, Solana checks two signed Pyth prices for each stock, and the stock with the bigger percentage move takes both stakes, **paid in shares, not cash**. The loser is cooked, and the share card says so.

That last part is only possible because the stocks are tokens. Nobody can hand their friend "my shares of Tesla" at a brokerage when they lose.

## A fight, start to finish

1. **Call it.** Pick your fighter (NVDA), theirs (TSLA), a stake ($25 each, sized in integers from the live Pyth price), and a round: 5 minutes, an hour, the next closing bell, or Friday's. Add a taunt; it is written on chain with the fight.
2. **They answer.** The link unfurls on X as a VS card. Whoever takes it stakes exactly the terms offered. A fight can be open to anyone or addressed to one wallet.
3. **The round runs** from the first Pyth price at least two seconds after the accept. The fight page is a fighting-game HUD: live moves, health bars that drain with the gap between the two stocks, a clock to the bell.
4. **The bell.** The first Pyth price at or after the end, for each stock. Bigger percentage move wins both stakes; an exact tie refunds each side. The settler posts it within a minute, and anyone can post it from the fight page.

## Why nobody can rig it

The whole design is that **nobody decides who won**. Not us, not an oracle key, not a referee.

| Nobody can... | Because... |
|---|---|
| Fake a price | Prices are Pyth `PriceUpdateV2` accounts, written only by the Pyth receiver after it checks Wormhole guardian signatures. The program checks the owner, the discriminator, the feed and that verification is **Full**. |
| Shop for a better print | Pyth prints several times a second, but every update records the publish time of the one before it. The program accepts only the update with `prev_publish_time < boundary <= publish_time`: the unique first price at or after the bell. It is the rule Pyth's own EVM contract enforces as `parsePriceFeedUpdatesUnique`. |
| Time the start | The start boundary is two seconds after the accept, so the start price did not exist when the taker signed. |
| Round in their favour | The winner is decided by cross-multiplying integer prices, `c_end * o_start` against `o_end * c_start`, with exponents aligned. No division, no floats, no basis points in the decision. |
| Refuse to settle | Starting and settling are permissionless. Any wallet can post the prices and crank it; the result is identical whoever does. |
| Take the stakes | Stakes sit in token accounts owned by the fight's own PDA. They leave by exactly three paths, each naming its recipient: back to the challenger (`cancel_duel`), to the winner (`settle_duel`), or home to both (`refund_duel`). There is no admin withdrawal. |
| Stake a lookalike | Only mints the admin registered next to their Pyth feed can be staked. Anyone can mint a token called NVDAx; it cannot fight. |
| Strand a fight | A fight whose price never arrives (a halted feed, a delisting) refunds to both sides after a week. A fight that cannot start fairly (the market reopens more than five days later, or inside the last minute of a fixed-end round) is void at once. |

## What is in the repo

```
programs/duel/        the Anchor program (Anchor 1.1.2)
  src/pyth.rs         PriceUpdateV2 parsed by hand, and the one-price rule
  src/outcome.rs      the exact, integer winner test
  src/mint_check.rs   which Token-2022 mints can sit in escrow
  src/lib.rs          10 instructions, 3 ways out
tests/duel.ts         22 LiteSVM tests against the built binary
tests-web/            market clock, stake sizing, HUD maths
src/                  the Next.js app
  app/f/[duel]/       the fight page and its share card
  app/api/prices      live Pyth prices (the API key stays on the server)
  app/api/pyth        a boundary's signed update, for settling from the browser
  app/api/faucet      devnet only: test shares and SOL
  lib/duel.ts         the client half of the program: PDAs, instructions
scripts/
  setup-devnet.ts     config, test stock mints, the registry
  settler.ts          the permissionless cranks, on a timer
  dev-crank.ts        local validator only: the settler with Pyth faked
```

### The program

| Instruction | Who | What |
|---|---|---|
| `create_duel` | challenger | fixes both stakes and the round, escrows the challenger's shares |
| `cancel_duel` | challenger, or anyone after expiry | stake back to the challenger |
| `accept_duel` | anyone, or the invitee | escrows the other stake on the offered terms |
| `start_duel` | anyone | records the start prices from Pyth |
| `settle_duel` | anyone | records the end prices, pays the winner both stakes |
| `refund_duel` | anyone | void or stalled: each stake home |
| `close_duel` | challenger | reclaim a finished fight's rent |
| `init_config`, `set_paused`, `register_asset`, `set_asset` | admin | the stock registry; pause blocks new fights, never a payout |

**Why the Pyth account is parsed by hand.** `pyth-solana-receiver-sdk` supports Anchor up to 0.31, and this program is on 1.1. The one account type needed is 134 bytes with a fixed layout, so `pyth.rs` reads it directly and checks every field. `scripts/pyth-layout-probe.ts` parses live mainnet and devnet accounts with the same layout, and did so after Pyth's August 2026 Core upgrade.

**Token-2022.** Tokenized stocks are Token-2022 mints. The program uses the token interface throughout, so a fight can pair a classic SPL mint with a Token-2022 one, and refuses only the two extensions that would stop an escrow paying out: a live transfer hook and non-transferable. A fee-on-transfer mint fails at the stake, because the program checks the escrow received the full amount.

### The app

Next.js 15 on the Stonk Wars look: a fighting-game ring, P1 in cyan, P2 in magenta, gold for the pot, green and red strictly for price moves, and a stencilled COOKED stamp for exactly one thing. On test clusters a **guest wallet** (a keypair in localStorage) and a **faucet** let someone fight within a minute of landing, with no extension and no devnet SOL required.

## Run it

Everything below runs in WSL/Linux with the Solana toolchain (Anchor 1.1.2, Agave 3.1) and Node 24.

```bash
npm install
anchor build                       # programs/duel -> target/deploy/duel.so
cargo test -p duel                 # 20 unit tests: parsing, the one-price rule, the outcome
npm test                           # 22 LiteSVM tests against the binary
npx mocha --import=tsx 'tests-web/**/*.test.ts'
```

**A whole fight on your machine, no API key needed** (surfpool forks devnet; prices are synthetic):

```bash
surfpool start --network devnet --no-tui --no-deploy
solana program deploy --url localhost --program-id target/deploy/duel-keypair.json target/deploy/duel.so
RPC=http://127.0.0.1:8899 npx tsx scripts/setup-devnet.ts
RPC=http://127.0.0.1:8899 npx tsx scripts/dev-crank.ts &
NEXT_PUBLIC_CLUSTER=localnet NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 RPC_URL=http://127.0.0.1:8899 DEV_FAKE_PRICES=1 npm run dev
```

**Devnet, with real Pyth prices:** copy `.env.example` to `.env.local`, add a Pyth API key (Hermes has required one since the Core upgrade of 2026-08-26), deploy, run `scripts/setup-devnet.ts`, then `scripts/settler.ts` beside the app.

## Honest limits

- **Dividends.** Pyth prices the underlying stock. A stock that goes ex-dividend mid-fight drops by the dividend, which counts against it, while an issuer's token typically compensates holders through its scaled amount. For rounds of minutes to days this is rarely material; it is not yet corrected for.
- **Extended hours.** A round runs on whatever Pyth publishes. The app only offers end times inside the regular session (the "bell" is 3:59:30 PM ET) so that a price follows within a second.
- **Who can hold tokenized stocks.** Issuers generally offer them to non-US persons only. The live demo runs on devnet with test shares that stand in for them, and real Pyth prices. Know the rules where you live.

## Disclaimer

Stonk Wars is a demonstration of peer-to-peer escrow on Solana. Nothing here is financial, investment, gambling or legal advice.
