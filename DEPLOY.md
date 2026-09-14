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
| `NEXT_PUBLIC_SITE_URL` | **leave unset on Vercel.** It is the base for og:image and for every Blink's icon, so a value pointing at a domain that does not resolve yet unfurls broken on X. Unset, the app reads Vercel's own production domain and tracks it through the custom-domain switch. Set it only when hosting somewhere else |
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
`www.stonkwars.fun`. Vercel then shows the records it wants. **Use those, not
any written here.** It no longer hands out the shared `76.76.21.21` apex A
record; each project now gets its own hostname and both names are a CNAME to
it, something like:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` | `<project hash>.vercel-dns-nnn.com` | **DNS only** |
| CNAME | `www` | the same value | **DNS only** |

A CNAME on the apex is normally illegal; Cloudflare allows it by flattening,
which is why this works there and would not everywhere.

Grey cloud, not orange, on both. Cloudflare's proxy in front of Vercel breaks
Vercel's certificate issuance.

Then set **`stonkwars.fun` as the primary domain** in Vercel, so `www`
redirects to it rather than the other way round. Whichever is primary is the
one Vercel reports as the production domain, and that is what the app uses to
build og:image and every Blink icon, so it wants to be the name on the brand.

Two things follow the domain and one does not:

- The share card and Blink icons move on their own, but only on the next
  deployment, because the production domain is read at build time. **Redeploy
  after the domain resolves** or every share still names the old host.
- Privy's allowed origins must list whichever hostnames people can reach,
  including `www` if it is reachable at all. That list drives a CSP
  `frame-ancestors` header, so a host missing from it cannot show the login
  iframe at all.
- Privy's **HttpOnly cookies / app domain stays off** until the app is actually
  served from that domain, and there is no reason to switch it on before the
  wallet work is deployed. See `docs/submission.md` and the note in
  `src/components/PrivySignIn.tsx` on the branch.

## 7. The settler, once a minute

**(you)** https://cron-job.org (free) → Create cronjob:

- URL: the **primary** origin, `/api/crank`, so
  `https://stonkwars.fun/api/crank`. Exactly that: `https`, no trailing slash,
  and the primary name rather than a redirecting one. A redirect is the usual
  way an `Authorization` header goes missing in transit, and the `.vercel.app`
  alias still answers if the custom domain is not up yet.
- Schedule: every minute. Method: **GET**.
- Common → **Save responses in job history**: ON. It is off by default, which
  means a failing job shows a bare status code and nothing else. Everything
  below is unreadable without this.
- Advanced → Headers. There are two boxes, a key and a value, and cron-job.org
  supplies the colon between them:

  | box | what goes in it |
  | --- | --- |
  | Key | `Authorization` |
  | Value | `Bearer ` then the secret, with exactly one space after `Bearer` |

  So the word `Bearer` belongs in the **value** box, not the key box. Click away
  from the field before saving: the inputs commit on blur, so a correction that
  still has the cursor in it never reaches the form.
- Advanced → **Requires HTTP authentication**: OFF. It generates a competing
  `Authorization: Basic` header that displaces this one.

Check it: the job's history should show HTTP 200 with
`{"ok": true, "at": ..., "due": [...], "parked": [...]}`. The route answers as
soon as it has listed what is due and does the work after the response, so the
ping stays well inside cron-job.org's 30 second limit; what each job did goes
to the Vercel function log as one JSON line. `parked` lists fights whose market
is shut, which nothing is tried for until it opens. `"ok": false` with an
`error` means the chain could not be read that minute: it is still a 200 on
purpose, so a bad minute at the RPC does not count towards cron-job.org
switching the job off. Add `?wait=1` to the URL by hand to run a pass before
the answer and see its results in the body.

If it shows 401, read the saved response body, which now names the mistake:

- A JSON body with a `why` field means the route itself answered, so the secret
  or the header shape is wrong and `why` says which. Our 401 also carries an
  `x-stonkwars-crank: 1` header.
- Anything else, especially HTML or a `set-cookie: _vercel_sso_nonce`, means
  Vercel answered before the route ran. The job is pointed at a preview or
  branch URL, where deployment protection 401s everything regardless of the
  header. Point it at the production alias.
- An empty body means the method is HEAD rather than GET.

Two things that make a fixed job look still-broken: cron-job.org disables a job
after enough consecutive failures, so re-enable it after correcting anything;
and its **Test run** button executes what is currently on screen including
unsaved edits, so a green test run is not evidence about what the scheduler
sends. Reload the page and confirm the header row is still there.

Without any of this, fights still settle: anyone can press **Settle it yourself**
on a fight page after the bell, and the result is the same whoever does.

## 8. Solana Actions (no step required)

Every fight serves a Solana Action with nothing to configure: `/actions.json`
maps `/f/*` onto `/api/actions/fight/*`, where GET describes the fight and POST
returns an unsigned `accept_duel` for the wallet to sign. Any Actions client can
take a fight through it.

What no longer exists, as of September 2026, is a way to make that unfurl as a
Blink inside X. Wallets only render Blinks for domains on Dialect's registry,
and that path is gone: `dial.to` and its `/register` page return a paused Vercel
deployment, Dialect briefly published and then withdrew a notice that it was
sunsetting Blinks, and the registry has not changed since spring. A fight link
still unfurls on X, as the ordinary VS card from its OpenGraph image, which does
not depend on any of this.

If a registry reappears, nothing in the app needs to change to use it.

## Smoke test after deploy

1. Open the site, connect the **Guest wallet (devnet)**, press **Get test stocks**.
2. Pick a fight, 5 minutes. Copy the link.
3. In a private window (a second guest wallet), open the link, get test stocks, take it.
4. Within a minute the fight page shows the round live with real moves.
5. After the bell, within a minute of the cron, it settles and the loser is cooked.
