# A native buy, and a wallet people can recover

Research for two gaps: the guest wallet in `src/lib/guestWallet.ts` is a keypair in `localStorage`
with no recovery and is refused on mainnet, and on mainnet there is no way to get shares inside the
app. Written 2026-09-12. Every price, limit and version below was read or run on that date.

Constraints this was researched against: the owner will not hold user keys, cost must stay near
zero, and a working demo must not break before Friday 2026-09-18.

---

## The short version

**Use Privy for the wallet.** It is free up to 499 monthly active users with 50,000 signatures a
month, it has genuine Solana support, it offers email, Google and X login (which matches the X
handle feature the app already has in `ConnectX.tsx`), and the keys are split three ways so that
neither Privy alone nor the app can sign. Most importantly for this codebase, Privy documents a way
to expose its embedded wallet as a Solana Wallet Standard wallet, which is exactly the thing
`@solana/wallet-adapter-react` already discovers. If that works as written, `useWallet`, `useSend`
and all eight files that touch them do not change at all.

**Use Jupiter Swap for the buy.** It works today without an API key, xStocks route well at fight
sized amounts, and I confirmed it against real mints from this repo (numbers below).

**Cost today: zero.** Privy free tier plus Jupiter keyless. The first real bill arrives at 500
monthly active users, and it is $299 a month.

**Before Friday: do almost nothing to the wallet.** Create the Privy account so it exists, and ship
a read-only quote preview if there is appetite. The wallet swap is a two to four day job and it
touches the one thing a demo cannot survive losing.

**Do not use Turnkey.** Its free tier is 25 signatures per month. One fight is at least four
signatures.

---

## Provider comparison

| | **Privy** | **Crossmint** | **Para** | **Dynamic** | **Turnkey** |
|---|---|---|---|---|---|
| **Free tier, exact** | 0 to 499 MAU, 50,000 signatures/mo, $1M transaction volume | 1,000 monthly active wallets, up to 2,000 transactions | 1,200 MAU, 1 project, REST API 30 req/min | Up to 1,000 MAU | 1,000 wallets, **25 signatures/mo** |
| **First paid step** | $299/mo (500 to 2,499 MAU); $499/mo (2,500 to 9,999) | overages from $0.05 per MAU | $200/mo to 2,500 MAU, then $0.06/MAU | $249/mo (1,000 to 5,000 MAU) | $0.10/signature, or $99/mo + $0.05/sig |
| **Above that** | PAYG $2,000 base, $0.05/MAU over 10,000, $0.01/sig over 50,000; enterprise from $0.001/sig | volume discounts | $500/mo to 10,000 MAU; $1,000/mo to 25,000 | $0.05/MAU beyond 5,000 | enterprise from $0.0015/sig |
| **Solana** | Yes, first class | Yes, but passkey signers are EVM only | Yes, incl. an explicit web3.js v1 package | Yes, gasless listed for EVM and Solana | Yes, enclave parses Solana txs |
| **Sign-in** | email, SMS, Google, Apple, X/Twitter, Discord, Telegram, Farcaster, passkey (login only) | email OTP, SMS OTP, device, external wallet, server, cloud KMS | email, phone, social, passkey | email, social, wallets | email, OAuth, passkey |
| **Who holds the key** | 3 way Shamir split, 2 of 3 needed: device share, Privy TEE share, recovery share | configurable per signer type | 2 of 2 MPC: device share behind a passkey in a secure enclave, plus Para infra share | TSS-MPC: user device share plus server share in a TEE | keys live in TEEs; sub-organization per end user |
| **Does the app become a custodian** | No. Privy states neither Privy nor the integrating app ever sees the key | **Only if you pick the wrong signer.** Server signer and cloud KMS put keys in your infrastructure. Device or email OTP does not | No. Para states neither Para nor the app holds a complete key | No, if the user holds the device share | **Depends on configuration.** Safe only when the end user is the root user of their own sub-org; if your backend holds the root quorum, you can sign, and that is custody |
| **Recovery** | automatic (default), or password, or cloud via iCloud / Google Drive | email or phone OTP for the non-custodial signers | passkey in the device secure enclave | device share plus server share | sub-org auth methods |
| **wallet-adapter** | Not automatic. Privy documents a manual `registerWallet()` recipe that makes the embedded wallet a Wallet Standard wallet, which wallet-adapter then discovers | React SDK, `@solana/web3.js` ^1.98.1 as a peer | `ParaSolanaWeb3Signer` and `useParaSolanaSigner`; no wallet-adapter adapter found | **Replaces it.** Access is `useDynamicContext`, `primaryWallet`, `useUserWallets` | signer libraries, no wallet-adapter adapter found |
| **npm today** | `@privy-io/react-auth` v3.42.0, peer `react: ^18 \|\| ^19` | `@crossmint/client-sdk-react-ui` v4.6.0, peer react >=17.0.2 | `@getpara/react-sdk` v3.18.0; `@getpara/solana-web3.js-v1-integration` v3.18.0, peer `@solana/web3.js` ^1.98.0 | `@dynamic-labs/sdk-react-core` v5.8.0, peer react >=18 <20 | `@turnkey/sdk-react` v6.0.9, peer react incl. ^19 |
| **Ownership change** | **Acquired by Stripe, announced 2025-06-11.** Continues as an independent product | independent | independent | **Acquired by Fireblocks, announced 2025-10-23** | independent |

MAU counting note, Dynamic only, because it is the one provider that states it: a user counts if
they log in at least once in the month, or when an embedded wallet is created for them, including
pre-generated wallets. The other providers do not publish the rule on their pricing pages.

### Why Privy and not the others

**Privy** wins on the thing that matters most here, which is not features but blast radius. The
`registerWallet()` path means the change is additive: Phantom keeps working, the guest wallet keeps
working on devnet, and Privy appears as one more entry in `useWallet().wallets`. Nothing else in the
app learns a new API. The free signature allowance (50,000) is also the only one large enough that a
signing-heavy app never thinks about it. Privy is a Stripe company as of June 2025, which is a
stability argument more than a risk, but it is a dependency on a payments giant's roadmap.

**Crossmint** has the largest free wallet count (1,000 MAW) and its React SDK peers on
`@solana/web3.js` ^1.98.1, which is exactly this repo's version. It is a real second choice. Two
cautions. Passkey signers are EVM only, so on Solana the non-custodial options narrow to device or
email OTP. And the server signer and cloud KMS options are custody by another name, so the
configuration has to be chosen deliberately and documented, because the platform will happily let
you become the custodian.

**Para** is the best mechanical fit for a web3.js v1 codebase: it publishes
`@getpara/solana-web3.js-v1-integration` exporting `ParaSolanaWeb3Signer`, and its React SDK already
peers on `@tanstack/react-query >=5.0.0`, which the app has. 1,200 free MAU is the largest free tier
of the five. It loses on integration shape: I found no wallet-adapter adapter, so `useSend` and the
components would need rewiring around a Para signer.

**Dynamic** is technically fine and free to 1,000 MAU, but it replaces the wallet layer instead of
plugging into it. That means editing all eight files that use `useWallet` or `useConnection`, which
is the opposite of what a pre-deadline change should look like. Fireblocks acquired it in October
2025.

**Turnkey** is out on arithmetic. 25 free signatures a month, then $0.10 each. A single fight is
create, accept, start, settle, and that is before token account creation. The paid tier is $99/mo
plus $0.05 per signature, which is a per-fight cost the app does not currently have.

---

## The swap

### What Jupiter is today

Two ways in.

**Keyless, no account, works right now.** `https://lite-api.jup.ag/swap/v1/quote` answered every
request I made today with no `x-api-key` header. Jupiter's own rate limit table lists a "Keyless"
tier at 0.5 requests per second, 30 per minute, on a 60 second sliding window.

**With a key**, from portal.jup.ag, base `https://api.jup.ag/swap/v2`:

| Plan | Price | Rate limit | Credits |
|---|---|---|---|
| Keyless | $0 | 0.5 rps, 30 rpm | n/a |
| Free | $0 | 1 rps, 60 rpm | unlimited usage |
| Developer | $25/mo | 10 rps | 25M credits/mo |
| Launch | $100/mo | 50 rps | 100M credits/mo |
| Pro | $500/mo | 150 rps | 500M credits/mo |

`/swap/v2/execute` has its own bucket: 20 rps keyless, 50 rps free, 100 rps on paid plans.

**Fees.** Jupiter charges by pair category: 0 bps for Jupiter tokens and pegged pairs, 2 bps
SOL-to-stable, 5 bps LST-to-stable, **10 bps for most pairs, which is the xStocks case**, and 50 bps
for tokens under 24 hours old. On top of that, an integrator can take 50 to 255 bps by setting
`referralAccount` and `referralFee`, and Jupiter keeps 20% of that. Setting a referral fee disables
the JupiterZ router, so routing narrows.

### Do xStocks route

Yes. Run today, 2026-09-12, against real mints from `scripts/data/tokens.json`.

```
GET https://lite-api.jup.ag/swap/v1/quote
    ?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v   # USDC, 6 decimals
    &outputMint=XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB   # TSLAx, 8 decimals
    &amount=25000000                                          # 25.00 USDC
    &slippageBps=100
```

| Route tested | In | outAmount (raw) | priceImpactPct | Route |
|---|---|---|---|---|
| USDC to TSLAx | 25 USDC | 6837242 (0.06837242 TSLAx) | 0.00056 | Whirlpool, 1 hop |
| USDC to NVDAx `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | 25 USDC | 11383398 | 0 | HumidiFi + Raydium CLMM + Whirlpool, split |
| USDC to TSLAx | 1,000 USDC | 273352428 | 0.00107 | Riptide, 1 hop |
| SOL to TSLAx | 0.1 SOL | 2781326 | 0.00047 | Byreal + Whirlpool |

A $25 stake, which is the app's default, moves the price by roughly half a basis point. This does
not contradict the README's argument that thin DEX pools must not *price* a fight. Pricing a fight
needs a number nobody can push at the bell; routing $25 into a share needs only that a route exists
at acceptable impact. Both are true at once.

### The production call sequence

```
GET https://api.jup.ag/swap/v2/order
    ?inputMint=<USDC>&outputMint=<xStock mint>&amount=<raw>&taker=<user pubkey>
    header: x-api-key: <key>
  -> { transaction: "<base64 VersionedTransaction>", requestId, feeBps, platformFee, ... }

  user signs the deserialized transaction

POST https://api.jup.ag/swap/v2/execute
    header: x-api-key: <key>
    body: { signedTransaction: "<base64>", requestId }
  -> { code: 0, signature, ... }   // negative codes are errors, see below
```

Signed payloads have roughly a two minute TTL, and `/execute` is idempotent for the same
`signedTransaction` plus `requestId` inside that window. Re-quote before executing if anything took
time. Retryable execute codes: -1 (expired order), -1000, -1001, -1004, -2000, -2001, -2003, -2004,
and 429. Not retryable: -2, -3, -1002, -1003.

**Where the key lives.** Not in the bundle. The repo already has the pattern for this: `Providers.tsx`
warns that `NEXT_PUBLIC_RPC_URL` ships in the browser and must never carry a credential, and
`src/app/api/rpc/route.ts` relays the paid node so the Helius key stays on the server. A
`src/app/api/swap/route.ts` that proxies `/order` and `/execute` is the same shape. Or start
keyless against `lite-api`, which needs no secret at all and is what I tested.

### Two Token-2022 details that will bite

**Every xStock is Token-2022.** `scripts/data/tokens.json` gives every one of them
`tokenProgram: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`. Jupiter's Swap API handles this. Its
Recurring (DCA) API explicitly does not support Token-2022, so do not reach for that one.

**Several carry a scaled UI multiplier.** From the same file: AAPLx 1.0032690125398187, NVDAx
1.001701196801074, SPYx 1.005714560286254, TSLAx 1. Jupiter's `outAmount` is in raw base units. A UI
that divides by `10^decimals` and stops will display the wrong share count for any mint whose
multiplier is not 1. Apply the multiplier the way the rest of the app already does.

---

## Effort in this codebase

### What keeps working

**`@solana/wallet-adapter-react` keeps working.** Nothing about Privy forces it out.
`src/components/Providers.tsx` already passes an explicit adapter array, `[new GuestWalletAdapter()]`
off mainnet and `[]` on mainnet, and relies on Wallet Standard discovery for Phantom, Solflare and
Backpack. Privy is additive to that.

**`useSend` in `src/lib/hooks.ts` keeps working, unchanged.** It reads exactly two things from
`useWallet()`: `publicKey` and `signTransaction`. It then builds a legacy `Transaction`, adds a
compute budget instruction, signs, and hands off to `sendAndConfirm`. Neither `src/lib/send.ts` nor
`src/lib/confirm.ts` cares who signed. As long as the new wallet presents itself as a wallet-adapter
wallet, this file is untouched.

**The eight files that touch `useWallet` or `useConnection`** are `lib/hooks.ts`,
`components/WalletButton.tsx`, `components/FaucetButton.tsx`, `components/ConnectX.tsx`,
`components/Providers.tsx`, `app/new/CreateFight.tsx`, `app/fights/FightsBoard.tsx` and
`app/f/[duel]/FightView.tsx`. None of them change under Privy. All of them change under Dynamic.
That is the whole argument between those two providers.

### Two shapes for the wallet change

**Shape A, Wallet Standard registration.** Follow Privy's "Using Solana standard wallets" recipe and
call `registerWallet()` for the embedded wallet once it exists. Privy then appears alongside Phantom
in `useWallet().wallets`, `WalletButton` lists it with no change (it already filters on
`readyState`), and nothing else moves. Cheapest path if the recipe behaves.

**Shape B, an adapter shim.** `src/lib/guestWallet.ts` is already exactly the right skeleton: a
`BaseSignerWalletAdapter` with `readyState`, `connect`, `disconnect` and `signTransaction`. Replace
the body. `connect()` triggers Privy login and resolves the embedded wallet's public key;
`signTransaction()` serializes the web3.js transaction to bytes, calls Privy, and rebuilds from the
returned bytes.

One wrinkle worth knowing before starting. Privy's Solana surface is built on `@solana/kit`, not
`@solana/web3.js` v1: the npm peers on `@privy-io/react-auth` v3.42.0 are `@solana/kit`,
`@solana-program/token`, `@solana-program/system` and `@solana-program/memo`, and
`signTransaction` takes an encoded transaction and returns `{ signedTransaction: Uint8Array }`. The
app is on web3.js v1. The wire format is the same on both sides, so the shim is a serialize, sign,
deserialize sandwich rather than a direct hand-off. It should be a dozen lines. I did not run it.

### The guest wallet

Keep it. Do not delete it in the same change. It is already fenced to non-mainnet by a single
ternary in `Providers.tsx`, and it is what lets a judge with no wallet play in one click. Once Privy
works on devnet, the mainnet arm of that ternary is where Privy goes. Remove `guestWallet.ts` only
after Privy has been live on mainnet long enough to trust.

### The real blocker, which is not the wallet

A brand new Privy wallet has zero SOL. Creating a Token-2022 associated token account costs rent,
and every instruction costs a fee. So the sequence "sign in with Google, buy a share, start a fight"
does not work until something funds that wallet. Three options, none free:

1. An onramp. Solves funding and buying at once, but every card or bank onramp KYCs the buyer, which
   is the thing the app deliberately does not have.
2. A sponsor faucet on mainnet. The app already has `src/app/api/faucet/route.ts` for test clusters.
   A mainnet version costs the owner real SOL per user and invites abuse.
3. Jupiter's gasless paths. The docs describe automatic, JupiterZ and integrator-payer variants with
   eligibility varying by balance, trade size and parameters. Promising, unverified for these pairs.

This, not the wallet library, is what makes the native buy a multi-day job.

### Hours

| Task | Estimate |
|---|---|
| Privy account, app id, login methods, provider wiring | 1 to 2 h |
| Shape A: Wallet Standard registration, if it works as documented | 2 to 4 h |
| Shape B fallback: adapter shim, serialize/deserialize, legacy and versioned tx | 4 to 8 h |
| Buy panel: quote, refresh, slippage, sign, execute, poll balance | 6 to 10 h |
| Server-side Jupiter key proxy, if not staying keyless | 1 to 2 h |
| Funding a zero-SOL wallet on mainnet | a day, and likely deferred |

Roughly **two to four working days** for a version worth shipping. Not a Friday job with a demo to
protect.

---

## KYC

**None of the five force KYC on end users to create a wallet or sign a transaction.** Privy, Turnkey
and Dynamic are non-custodial infrastructure and place AML and KYC at the application layer, which
means the app decides. Para is the same shape. So the app's current no-signup property survives a
wallet provider.

**KYC enters through fiat, not through wallets.** Any card or bank onramp, whether MoonPay, Coinbase
Onramp, Stripe or Crossmint checkout, will verify the buyer. A buy flow that is crypto in and crypto
out, meaning USDC or SOL already in the wallet swapped for an xStock through Jupiter, has no signup
and no KYC anywhere in it. That is the version to build if the no-signup property is deliberate.

**Crossmint is the exception to watch.** It markets built-in KYC and KYB, AML screening via Elliptic
and Persona, and travel rule compliance via Notabene, as part of its payments and stablecoin
products. That is Crossmint's own description on its own site. Using Crossmint wallets without
Crossmint payments should not trigger it, but it is the provider most likely to pull compliance into
the product later.

**Separate from the providers: the shares themselves.** Backed's xStocks are composable with no KYC
at the protocol level and can be bought on Jupiter by anyone with a wallet. Redemption for the
underlying share runs through Backed and is gated to KYC-cleared qualified investors, and Kraken
lists xStocks for non-US users. So a US-based user swapping into TSLAx on a DEX is doing something
the issuer's own distribution does not offer them. That is a question for the owner and for
`src/app/terms/page.tsx`, not a technical one, and it should be answered before a mainnet buy button
ships.

---

## Safe before Friday

The demo runs on devnet with the guest wallet, and the guest wallet works. The correct number of
risky changes before a Friday deadline is zero. In rough order of value per unit of risk:

1. **Change nothing in `Providers.tsx` on the path the demo uses.** The guest wallet is already
   fenced to non-mainnet in one line. Leave that line alone.
2. **Ship a read-only quote preview.** A server route that calls
   `lite-api.jup.ag/swap/v1/quote` and renders "25 USDC buys 0.0684 TSLAx, price impact 0.06 bps".
   No API key, no signing, no new dependency, no wallet code touched. Half a day, and it demonstrates
   the native buy story without building it.
3. **Create the Privy account.** Enable email, Google and X, get the app id, put it in
   `.env.example`. Zero code, zero risk, and Monday starts further along.
4. **If there is appetite for exactly one code change:** add Privy behind
   `NEXT_PUBLIC_PRIVY_APP_ID`, devnet only, mirroring how the guest wallet is already fenced. Absent
   variable means today's behaviour byte for byte. Ship it switched off.

Note for the demo script: Jupiter's API serves mainnet. The quotes above are mainnet quotes. A buy
flow cannot be exercised against the devnet deployment, so anything demoed before Friday is either a
mainnet read-only quote or a mock.

## After the hackathon

1. Privy embedded wallet on mainnet with X, Google and email login, wired through Wallet Standard
   registration so `useWallet` and `useSend` do not change.
2. Solve funding. Pick one of sponsored first transaction, onramp with its KYC, or requiring USDC in.
   Everything else waits on this.
3. The in-app buy: Jupiter Swap v2 through a server route holding the key, with the scaled UI
   multiplier applied to every displayed share count.
4. Only then delete `src/lib/guestWallet.ts`.
5. Later, if volume justifies it, consider the Jupiter integrator referral fee (50 to 255 bps, minus
   Jupiter's 20% cut) as revenue. It disables the JupiterZ router, so measure the routing cost first.

---

## What I could not verify

- **Whether Privy's `registerWallet()` recipe actually puts the embedded wallet into
  `useWallet().wallets`** in this app under React 19 and Next 15. The docs describe manual
  registration and give code. I did not run it. This is the single assumption the recommendation
  rests on, and it is the first thing to test.
- **Whether the serialize, sign, deserialize shim round-trips** for both legacy `Transaction` and
  `VersionedTransaction` from web3.js v1 through Privy's kit-shaped `signTransaction`. The wire
  format should be identical. Untested.
- **How Privy counts a "monthly active user"**, and whether signatures from server-side or automated
  paths count against the 50,000. The pricing page states both numbers but not the counting rules.
  Dynamic is the only one of the five that publishes its rule.
- **What Privy's free-tier "$1M transaction volume" measures**, and how a transfer of tokenized
  shares is valued against it. This app's whole purpose is moving share tokens, so the answer matters.
- **Whether Para publishes a `@solana/wallet-adapter` compatible adapter.** The Solana setup page I
  read lists `ParaSolanaWeb3Signer` and `useParaSolanaSigner` only. A package may exist that I did
  not find.
- **Turnkey's Solana sign-in methods in detail**, and whether its embedded wallet kit registers as a
  Wallet Standard wallet. I stopped once the 25-signature free tier ruled it out on cost.
- **What counts as one of Crossmint's 2,000 free transactions**, and whether a Solana swap is one.
- **Whether Jupiter's gasless paths cover USDC to xStocks for a zero-SOL wallet.** The docs say
  eligibility varies by balance, trade size and parameters, and list disqualifying parameters, but I
  did not test it for these mints. If it works, it removes the funding blocker, so it is worth an
  hour.
- **Whether Jupiter has any devnet endpoint.** I found none and every quote above is mainnet, but I
  did not search exhaustively.
- **Any pricing change at Privy or Dynamic following the Stripe and Fireblocks acquisitions.** Both
  pricing pages read as tabulated above on 2026-09-12. Neither acquisition's effect on pricing is
  documented anywhere I looked.
- **Whether the app may lawfully offer a buy of tokenized shares to its users.** Not a technical
  question and not researched.

---

## Sources

Read or run on 2026-09-12.

- Privy pricing: https://www.privy.io/pricing
- Privy embedded wallets: https://docs.privy.io/wallets/overview/embedded
- Privy and Solana: https://docs.privy.io/recipes/solana/getting-started-with-privy-and-solana
- Privy Solana standard wallets: https://docs.privy.io/recipes/solana/standard-wallets
- Privy Solana signing: https://docs.privy.io/wallets/using-wallets/solana/sign-a-transaction
- Privy on how its wallets work: https://privy.io/blog/how-privy-embedded-wallets-work
- Privy cloud recovery: https://docs.privy.io/wallets/advanced-topics/new-devices/cloud-recovery
- Stripe acquires Privy, 2025-06-11: https://www.coindesk.com/business/2025/06/11/stripe-to-acquire-crypto-wallet-startup-privy-in-bid-to-expand-web3-capabilities
- Turnkey pricing: https://www.turnkey.com/pricing
- Turnkey root quorum: https://docs.turnkey.com/concepts/users/root-quorum
- Crossmint pricing: https://www.crossmint.com/pricing
- Crossmint signers and custody: https://docs.crossmint.com/wallets/signers-and-custody
- Para pricing: https://www.getpara.com/pricing
- Para Solana setup: https://docs.getpara.com/v3/react/guides/web3-operations/solana/setup-libraries
- Dynamic pricing: https://www.dynamic.xyz/pricing
- Dynamic accessing wallets: https://www.dynamic.xyz/docs/wallets/using-wallets/accessing-wallets
- Fireblocks acquires Dynamic, 2025-10-23: https://www.fireblocks.com/blog/fireblocks-acquires-dynamic
- Jupiter rate limits: https://developers.jup.ag/docs/portal/rate-limit
- Jupiter plans and pricing: https://developers.jup.ag/pricing
- Jupiter swap fees: https://developers.jup.ag/docs/swap/v2/fees
- Jupiter order and execute: https://dev.jup.ag/docs/swap/v2/order-and-execute.md
- xStocks on Solana: https://solana.com/news/case-study-xstocks
- npm registry, package versions and peer dependencies, queried directly
- Live Jupiter quotes, run from this machine against mainnet
