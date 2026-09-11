# Token snapshot

`tokens.json` lists every tokenized stock and ETF on Solana mainnet that we
found, one row per mint, with the facts about each mint read on chain. It was
collected on 2026-09-11. `scripts/build-roster.ts` turns it into the app's
roster.

| Issuer | Where the list comes from |
|---|---|
| xStocks (Backed / Kraken) | `GET https://api.backed.fi/api/v2/public/assets?page=N`, the Solana deployment of each asset (832), plus three only Jupiter lists |
| Ondo Global Markets | The token CSV linked from https://docs.ondo.finance/addresses, column "Solana Deployed Address" |
| Backpack Securities (via Sunrise) | `GET https://api.backpack.exchange/api/v1/assets`, symbols ending `.US` with a Solana contract and deposits enabled |
| Superstate Opening Bell | `GET https://api.superstate.com/v1/assets`, equities with a Solana (chain 900) token |
| Securitize (SECZ), Bullish (BLSH) | The issuers' announcements, checked against Jupiter's verified list |
| Remora rStocks | Jupiter token search; winding down since 2026-02-24 |

Read from each mint on chain: decimals, token program, supply, and the
Token-2022 extensions that decide whether a fight can escrow the token
(default account state, transfer hook program, transfer fee, pausable,
permanent delegate, scaled UI amount multiplier).

Left out of the roster, and why:

- **Allowlist-only tokens** (Superstate, SECZ, BLSH): new token accounts start
  frozen and only the issuer can thaw them, so a fight's escrow account would be
  frozen from birth.
- **Zero supply** (Ondo and Superstate mints created but never issued).
- **Winding down** (Remora) and **halted** tokens.
- Pre-IPO and synthetic tokens (PreStocks, Tessera, Shift) are not share-backed
  and are not in the snapshot at all.

Things every issuer can still do to a live token, including one in escrow:
freeze an account, pause all transfers (all but Ondo), or move tokens out of
any account with a permanent delegate (all but Ondo). A fight inherits those
risks from the token it holds.
