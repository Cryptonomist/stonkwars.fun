# Stonk Wars: deploy to devnet and stonkwars.fun

Written to be followed once, in order. Everything in a code block runs from
`~/stockduel` in WSL. Steps marked **(you)** need an account only the owner has.

## 1. Program on devnet

What the deploy wallet spends on devnet:

| For | SOL |
|---|---|
| The program (413 KB of program data) | 2.1, plus 2.1 more during the upload, refunded after |
| 1,033 test stocks: a mint and a registry entry each | 2.5 |
| The faucet, to hand out SOL and pay for players' token accounts | 2 |
| The settler's fee key (step 3) | 1 |

About **8 SOL** in all, and 4.2 free at the moment of the deploy.
**(you)** Top up `HoYb6BCszJUY89WhKt2itTpxtLHMJKuoEwXwQPdbhtVu` at
https://faucet.solana.com (signing in with GitHub raises the limit).

```bash
anchor build
solana program deploy --url devnet \
  --program-id target/deploy/duel-keypair.json target/deploy/duel.so
```

The program id is `Hxr3N4cSJXTzPqiaUrdnKKyYSzMrAPkrGk5MzJhazc3D` (in
`declare_id!`, `Anchor.toml` and the IDL). The upgrade authority is the deploy
wallet.

## 2. Test stocks and the registry

```bash
RPC=https://api.devnet.solana.com FAUCET_SOL=2 npx tsx scripts/setup-devnet.ts
git add src/data/stocks.devnet.json && git commit -m "Devnet test stocks" && git push
```

This initialises the config (the deploy wallet becomes admin), makes an oracle
key and names it in the config, creates a Token-2022 test mint for each of the
1,033 stocks in `src/data/roster.json` and registers it with its feed id and
price source (eight at a time; a re-run picks up where a failure stopped),
writes `src/data/stocks.devnet.json`, and puts `FAUCET_SECRET_KEY` and
`ORACLE_SECRET_KEY` in `.env.local`.

## 3. The settler's key

A separate keypair that pays crank fees. It holds no stake and decides nothing.

```bash
solana-keygen new --no-bip39-passphrase -o keys/crank-devnet.json
solana transfer --url devnet --allow-unfunded-recipient $(solana-keygen pubkey keys/crank-devnet.json) 1
cat keys/crank-devnet.json   # the value of CRANK_SECRET_KEY
```

## 4. Pyth

**(you)** Sign up at https://pythdata.app/signup and copy the API key. Hermes
has required one since the Pyth Core upgrade of 2026-08-26. The free plan
grants TSLA, QQQ and VOO, which is what `scripts/build-roster.ts` registers
with the Pyth source; every other stock is priced by the oracle. The key is
only ever read on the server.

## 5. Vercel

**(you)** vercel.com → Add New → Project → import `Cryptonomist/stonkwars.fun`.
Framework preset Next.js, everything else default. Environment variables, for
Production and Preview:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_CLUSTER` | `devnet` |
| `NEXT_PUBLIC_RPC_URL` | `https://api.devnet.solana.com` (or a Helius devnet URL behind a proxy; never a raw keyed URL) |
| `NEXT_PUBLIC_SITE_URL` | `https://stonkwars.fun` |
| `RPC_URL` | same as above, or a keyed RPC: this one stays on the server |
| `PYTH_API_KEY` | from step 4 |
| `HERMES_URL` | `https://hermes.pyth.network` |
| `FAUCET_SECRET_KEY` | from `.env.local` after step 2 |
| `ORACLE_SECRET_KEY` | from `.env.local` after step 2 |
| `CRANK_SECRET_KEY` | the byte array from step 3 |
| `CRON_SECRET` | any long random string, e.g. `openssl rand -hex 24` |

Deploy. You get a `*.vercel.app` URL straight away.

## 6. The domain

**(you)** Vercel → Project → Settings → Domains → add `stonkwars.fun` and
`www.stonkwars.fun`. Then in Cloudflare → stonkwars.fun → DNS:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` | `76.76.21.21` | **DNS only** |
| CNAME | `www` | `cname.vercel-dns.com` | **DNS only** |

Grey cloud, not orange: Cloudflare's proxy in front of Vercel breaks Vercel's
certificate issuance. Use Vercel's values if its dashboard shows different ones.

## 7. The settler, once a minute

**(you)** https://cron-job.org (free) → Create cronjob:

- URL: `https://stonkwars.fun/api/crank`
- Schedule: every minute
- Advanced → Headers: `Authorization: Bearer <CRON_SECRET>`

Check it: the job's history should show HTTP 200 with `{"results": [...]}`.
Without it, fights still settle: anyone can press **Settle it yourself** on a
fight page after the bell, and the result is the same whoever does.

## 8. Blinks on X (optional)

Fight links already serve a Solana Action (`/actions.json`,
`/api/actions/fight/<duel>`). For X to unfurl them as Blinks for wallet users,
register the domain at https://dial.to/register. Until then, every fight page
has a **Preview the Blink** link that opens it on dial.to.

## Smoke test after deploy

1. Open the site, connect the **Guest wallet (devnet)**, press **Get test stocks**.
2. Pick a fight, 5 minutes. Copy the link.
3. In a private window (a second guest wallet), open the link, get test stocks, take it.
4. Within a minute the fight page shows the round live with real moves.
5. After the bell, within a minute of the cron, it settles and the loser is cooked.
