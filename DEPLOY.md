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
| The page nudge's fee key (step 3) | 0.5 |

About **8.5 SOL** in all, and 4.2 free at the moment of the deploy.
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

And one more for the page nudge (section 8), funded with half a SOL and no
more. Its balance is the ceiling on what visitors can make the server spend,
and a key of its own lets the chain tell a nudge from the cron from a person.

```bash
solana-keygen new --no-bip39-passphrase -o keys/nudge-devnet.json
solana transfer --url devnet --allow-unfunded-recipient $(solana-keygen pubkey keys/nudge-devnet.json) 0.5
cat keys/nudge-devnet.json   # the value of NUDGE_SECRET_KEY
```

The nudge key is optional, but set it before relying on the nudge. Without
`NUDGE_SECRET_KEY` the nudge pays from the crank key, so the nudge and the cron
share one balance and there is no separate ceiling on what visitors can make
the server spend: the whole crank key is the ceiling. In that mode the nudge
stops at a higher floor (0.3 SOL by default, see `NUDGE_MIN_BALANCE_SOL`) to
leave the cron room, and logs once that it is paying from the crank key.

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
| `RPC_URL` | a **keyed devnet** endpoint, e.g. `https://devnet.helius-rpc.com/?api-key=...`. It stays on the server. Not `api.devnet.solana.com`: the settler, the page nudge and `/api/rpc` (visitors' page polling, when `NEXT_PUBLIC_RPC_URL` is `/api/rpc`) all read through it, and the public node's rate limit fails whole settler passes. Not a mainnet URL either: every devnet read would come back empty |
| `PYTH_API_KEY` | from step 4 |
| `HERMES_URL` | `https://hermes.pyth.network` |
| `FAUCET_SECRET_KEY` | from `.env.local` after step 2 |
| `ORACLE_SECRET_KEY` | from `.env.local` after step 2 |
| `CRANK_SECRET_KEY` | the byte array from step 3 |
| `CRON_SECRET` | any long random string, e.g. `openssl rand -hex 24` |
| `NUDGE_SECRET_KEY` | recommended: the nudge key's byte array from step 3. Unset, the nudge pays from `CRANK_SECRET_KEY` and shares its balance with the cron |
| `NUDGE_MIN_BALANCE_SOL` | optional. Default `0.05` on the nudge's own key, `0.3` when it falls back to the crank key. Below this the nudge sends nothing and answers "settler low" (and logs it); the manual button still appears on schedule |
| `NUDGE_DISABLED` | optional: `1` switches the page nudge off. Leave unset |
| `JUPITER_API_KEY` (or `JUP_API_KEY`) | optional: a Jupiter API key for the trade panel's quotes and swaps. Unset, it uses Jupiter's keyless host |
| `NEXT_PUBLIC_SWAP_FEE_BPS` | optional: the platform's cut of a swap, 0 to 100 bps. 0 or unset charges nothing |
| `SWAP_FEE_OWNER` | optional: the treasury's public key. A swap fee is charged only when this wallet already has the token account for what the user receives |
| `NEXT_PUBLIC_SPAR_WALLET` | optional, devnet only: the sparring wallet's PUBLIC key (`solana-keygen pubkey keys/spar-devnet.json`). A public key, so the prefix is fine here |
| `SPAR_SECRET_KEY` | optional, devnet only: `cat keys/spar-devnet.json`. With both set, the crank keeps three open seats on the board and the wallet takes any timed challenge of 24 hours or less addressed to it. Leave both unset and sparring never appears |

No key, secret or keyed URL in this table may ever be given a `NEXT_PUBLIC_`
name: that prefix compiles the value into the page for anyone to read.

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
`error` means the chain could not be read that minute. Add `?wait=1` to the URL
by hand to run a pass before the answer and see its results in the body.

**Why the route answers 200 even when a pass goes wrong.** cron-job.org counts
two things as a failure: a status that is not 2xx, and a request that takes
longer than 30 seconds. After enough failures in a row it switches the job off,
silently, and every fight nobody is watching then waits for a person. A pass
that waits for prices and confirms what it sends can take most of a minute, and
a keyed RPC still has the odd bad minute. So the route lists, answers 200 at
once, and works afterwards; and a listing that fails still answers 200, with
`"ok": false` and the error in the body, where the job history shows it. Only
mistakes a person must fix (the secret, the crank key) get an error status,
because only those should ever stop the job.

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

Without any of this, fights still settle: the page nudge (section 8) cranks any
fight whose page is open, and anyone can press **Settle it yourself** on a fight
page once the settler is three minutes late. The result is the same whoever
posts it.

## 8. The page nudge (no step required)

While a fight page is open it asks `POST /api/nudge` with the fight's address,
and the server cranks the fight the moment its price can exist: the round goes
live a second or two after the start price, and settles a second or two after
the end price, with nobody signing anything. The cron stays the backstop for
fights nobody is watching, and waits past each price so it does not race a
page: six seconds for a fight priced by signed quotes, and 45 seconds for one
with a Pyth side, whose two or three transactions take a page far longer to
send. An unwatched Pyth fight is therefore cranked by the cron about 45 to 75
seconds after its price, rather than within a few.

It spends only what a crank costs, and only on fights that are really due. A
fight with nothing to do, a shut market, or a price more than ten seconds away
is answered from one cached account read, with no price source asked. A crowd of
pages on one fight becomes one crank; each IP gets 20 asks a minute, and each
instance at most 30 crank attempts a minute (an attempt that sent nothing does
not count). The key is `NUDGE_SECRET_KEY`; keep it on 0.5 SOL, since its
balance is then the hard ceiling on what visitors can make the server spend.

**Without `NUDGE_SECRET_KEY` there is no such ceiling.** The nudge falls back to
`CRANK_SECRET_KEY`, so the nudge and the cron spend one balance, and what
visitors can make the server spend is bounded only by that key. The nudge then
stops at 0.3 SOL instead of 0.05, so the cron keeps some room, but a "settler
low" alert in this mode means the cron is running short too. Set the nudge key.

What to watch for in the Vercel function log, one JSON line per crank:
`{"nudge":true,"duel":...,"state":"sent"|"done"|"not-yet"|"failed",...}`, and
`"alert":"settler low"` when the paying key is below the floor. The line says
`"sharedWithCron":true` when that key is the crank key. Top it up then. With a
nudge key of its own, the cron carries on meanwhile on its own balance; with a
shared key, the cron has at most the floor left, so top up at once. Either way
the manual button appears on its usual schedule.

To switch the nudge off, set `NUDGE_DISABLED=1` and redeploy. Pages then leave
everything to the cron and, three minutes after a price exists, to whoever is
looking. Optionally add a Vercel firewall rule of 60 requests a minute per IP on
`/api/nudge` as a second fence in front of the in-memory one.

## 9. Solana Actions (no step required)

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
4. With the page open, the round goes live on its own a second or two after its
   start price exists (for a minute-bar price, 25 to 85 seconds after the
   accept, depending on the second it was taken), with real moves. No button
   asks anyone to sign.
5. After the bell it settles on its own a second or two after the end price
   exists (80 seconds after a bell on the minute), and the loser is cooked. A **Lock the start prices yourself** or **Settle it
   yourself** button appearing means the nudge and the cron were both more than
   three minutes late: check the function log.
