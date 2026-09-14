# Stonk Wars design direction

Adopted Sunday 13 September 2026 for the hackathon build. The deadline is Friday 18 September, 4pm ET.

This document grows the "arena" system in `src/app/globals.css`. It does not replace it. Three rules stay fixed:
- Cyan is P1, the challenger. Pink is P2, the answerer.
- Green and red mean a price move and nothing else. Green also marks the winner and the money they take.
- COOKED orange is used for exactly one thing.

The work packages that build this are in section 12.

---

## 1. Essence

**The brand in two sentences.** Stonk Wars is a fighting game played with real stocks: two corners, one bell, and a result nobody can argue with, because signed prices and a Solana program decided it. The site is the fight HUD laid over a live market: packed and precise when nothing is happening, loud only when something real happens.

**The feeling.** An arcade built inside a trading terminal. Within ten seconds, without reading a sentence, a visitor should know three things:
- someone is fighting right now, or exactly how long ago someone last did
- who they are and what they staked
- they can take the other side in two taps, with no wallet extension and no SOL

**Five rules that make it intentional**

1. **A colour always means something.** Cyan and pink say which side. Green and red say which way a price moved. Orange says COOKED. Everything else is ink, dim or a surface colour. Using a colour as decoration makes a false claim.
2. **Loud only when something real happens.** Hit flashes, screen shake, K.O. and toasts fire only on real state changes. A quiet board says it is quiet and shows a real age ("Last bell 3h ago").
3. **Every number can be traced.** Each figure comes from an on-chain account, a transaction or a named price source, and the page can show which one.
4. **A board, not a sales pitch.** The first screen is data. Big type is kept for one live thing per screen: a ticker in a corner, a clock, or a K.O.
5. **Thumb first.** Every page works one-handed at 375px, with the next action within reach of the thumb.

---

## 2. Scorecard: the live site on Sunday 13 September

Each page is scored out of 10 on three measures:
- **Look:** craft and brand.
- **Alive:** whether it feels live and reacts to change.
- **Dense:** how much useful data fits on a screen.

| Page | Look | Alive | Dense | What matters most | Fixed in |
|---|---|---|---|---|---|
| Home `/` | 6.5 | 3.5 | 6 | The arena background never renders (a CSS bug). Settled rows don't mark the winner, and the winner's move often shows in red. "Rounds live now 0" gives no age for the last bell. The bottom 45% is marketing billboards. Fighters show as wallet addresses, not handles. On a 375px phone the page is 467px wide and zooms out. | P1, P6 |
| `/fights` | 4 | 2 | 3 | The default tab shows one card a third of the page wide. 16 of the 25 finished fights use test tokens, and two show "?" as the ticker. No sorting, no dates, and the tab isn't kept in the URL. The tabs are a plain underline with no ARIA. The answerer's ticker is cut off on phones. | P6, P8 |
| `/new` | 7 | 4.5 | 5 | Tale of the tape is the best original component on the site. The main button is about 2,600px down. On a weekend the default pair, TSLA vs NVDA, opens with an orange warning. Nothing shows what you would win. The stock pickers scroll inside the page. Token symbols are forced to capitals ("TSLAX"). | P7 |
| `/f` live round | not seen | not seen | n/a | No round was live on 13 Sep. Reading the code, this is the strongest screen (hits, combos, K.O.). But outside market hours the live prices are off by a constant amount, there is no chart, and the final-seconds clock blinks in COOKED orange. | P2, P5 |
| `/f` settled | 7 | 4 | 5 | The COOKED stamp covers the loser's ticker. Both health bars are still full at K.O. The winner's big number is red. Times are raw ISO strings and feed ids have no label. The share box is mostly a raw URL. | P5 |
| `/f` open challenge | 5 | 3 | 3 | About 60% of the screen is empty. Neither side shows a live price. "Take it" is disabled, and the faucet, the real next step, is a small secondary button. | P5 |
| `/f` accepted, waiting | 5 | 2 | 3 | No countdown to the market open. It offers "lock the start prices yourself" while the market is shut. | P5 |
| `/leaderboard` | 4 | 2 | 3 | Every fighter is a wallet address. It is sorted by wins, so a fighter with $5.49 taken ranks #2. Eight "0W 1L $0.00" rows show the $0.00 in green. Rows don't link anywhere. On phones the Taken column is off screen. | P3 |
| `/how` | 4 | 1 | 2 | 15 blocks of prose, 3,370px tall, with no table of contents. Code names like parsePriceFeedUpdatesUnique appear in the copy. The 37 is typed in by hand. | P10 |
| `/privacy`, `/terms` | 5 | n/a | n/a | Readable. A 72px header comes before any content, and the column lines up differently from /how. | P10 |
| Whole site | | | | Keyboard focus is invisible on every button, because the slanted clip-path cuts off the outline. No loading skeletons, no toasts, no 404 or error page, no mobile bottom bar. The colour rules are broken in about 25 places. | P1, P4 |

**Overall.** The brand system scores 8. It is more distinctive than pump.fun, fomo, Polymarket or Hyperliquid, and its side-versus-move colour rule is the one Polymarket uses. Execution scores 5:
- the arena background never renders
- keyboard focus is invisible
- fighters have no identity
- the big moments go unmarked
- about a quarter of colour uses break the rules

---

## 3. Colour system

### 3.1 Tokens

New tokens are marked. Every existing value is kept.

```css
@theme {
  /* Surfaces, low to high */
  --color-void: #07070b;        /* page background, under the arena grid */
  --color-panel: #0e0e16;       /* level 1: cards, rows, stat cells */
  --color-panel-2: #15151f;     /* level 2: controls, inputs, sticky bars, overlays */
  --color-panel-3: #1c1c29;     /* NEW level 3: hovered and pressed rows, active menu item */
  --color-line: #25253a;        /* hairlines */
  --color-line-strong: #34344f; /* NEW: hovered or selected borders, overlay rings */

  /* Ink */
  --color-ink: #f3f3f8;         /* primary text, numbers, neutral weight */
  --color-dim: #9090a8;         /* secondary text and labels, 6.5:1 on void */
  --color-faint: #5c5c74;       /* NEW: never text. Chart grid, empty pips, row dividers (3.1:1) */

  /* Sides */
  --color-p1: #2fe0ff;
  --color-p1-deep: #0b4a57;     /* bar tracks, pressed btn-p1 */
  --color-p1-tint: #11232d;     /* NEW: P1 at 10% over panel. Corner wash, selected P1 corner toggle */
  --color-p2: #ff3ea5;
  --color-p2-deep: #5a1239;
  --color-p2-tint: #261324;     /* NEW: P2 at 10% over panel */

  /* Price moves */
  --color-up: #35f28b;
  --color-up-tint: #132924;     /* NEW: up at 12% over panel. Price flash up, winner plate */
  --color-down: #ff4d5e;
  --color-down-tint: #2b161f;   /* NEW: down at 12% over panel. Price flash down */

  /* The finish */
  --color-cooked: #ff7a1a;      /* the COOKED mark, and nothing else */

  /* Light: only on live things and overlays */
  --shadow-glow-p1: 0 0 24px rgb(47 224 255 / 0.35);
  --shadow-glow-p2: 0 0 24px rgb(255 62 165 / 0.35);
  --shadow-glow-up: 0 0 24px rgb(53 242 139 / 0.35);
  --shadow-overlay: 0 16px 40px rgb(0 0 0 / 0.55);
}
```

The raw `rgba(...)` copies in `.arena` and `.pulse-dot` become `color-mix(in srgb, var(--color-x) N%, transparent)`, so each colour is defined in one place.

### 3.2 What each colour may mean

| Colour | Means | Use it for | Never use it for |
|---|---|---|---|
| Cyan / pink | A side | Tickers in a corner or row; side tints; the rope (a 2px top edge, cyan on the left half, pink on the right); health bars; race chart lines; combo counter; the side's primary button (`btn-p1` to create, `btn-p2` to take) | Rank numbers, step numerals, headings, links, tab underlines, focus rings, handles, success messages |
| Green | Price up; the winner; money taken | Positive moves, the `W` badge, "Took $6.48", winner plate, winner glow at K.O. | Live, open or market-session status; 24/7 badges; success messages; $0.00; counts |
| Red | Price down | Negative moves; damage numbers during a live round (a hit is a move in the gap between the two stocks) | Losses in a record, errors, low health, form validation |
| Orange | COOKED | The COOKED stamp at any size: fight page, row mini stamp, share card, the "cooked" toast | K.O., warnings, clocks, headlines, "Winner takes both" |
| Ink | Neutral weight | VS, K.O., selected non-side chips, focus, the LIVE label, notices, success | n/a |
| Dim / faint | Secondary | Labels, meta lines, the L in a record, $0.00 | Anything you need to act on |

### 3.3 States, without adding colours

- **Hover:**
  - Rows go from panel to panel-3.
  - Control borders go from line to line-strong.
  - `btn-p1` and `btn-p2` get `brightness(1.1)` (they have no hover today).
- **Selected option that isn't a side** (stake chip, filter): `btn-light`, ink fill with void text.
- **Selected corner** (Your fighter / Their fighter): side tint fill, side colour text, 2px underline in the side colour.
- **Focus:** ink.
  - Buttons get an inset double ring, void then ink, because clip-path cuts off outlines.
  - Everything else gets a 2px ink outline, offset 2px.
  - Inputs focus in ink, not cyan.
- **Disabled:** the label says why ("Connect to stake"), on top of the existing dimmed filter.
- **Live:** a split dot, left half cyan and right half pink, with an ink pulse ring. It reads as "both corners are in" and can't be mistaken for a price move.
- **Success:** ink with a check glyph, in a toast.
- **Warning and error:** a Notice plate in ink with a glyph and an action. Never red (red is a move) and never orange (orange is COOKED).
- **Winner:** `.plate-win`, green tint fill with green text, showing the money taken.
- **Loser:** ticker at 50% opacity, plus the COOKED stamp placed on the stake-and-move block, never over the ticker.
- **K.O.:** ink letters with a chromatic split shadow, cyan offset left and pink offset right. The orange glow goes.
- **Final ten seconds:** ink, with the existing blink.
- **Low health:** stays in the side colour, with 45-degree danger stripes (`.bar-danger`). Never red.

### 3.4 Where the rules are broken today, and which package fixes each

| Break | Location | Fix | Package |
|---|---|---|---|
| Green live dot; orange final seconds; orange K.O. glow; copied rgba values | `globals.css` | Split dot, ink clock, chromatic K.O., color-mix | P1 |
| Cyan ranks, cyan handle hover, red L, green $0.00; cyan handles and `btn-p1` in ConnectX | `Leaderboard.tsx`, `ConnectX.tsx` | Ink ranks in plates, L dim, $0.00 dim, neutral buttons | P3 |
| Green "Market open" and "Exchange shut · 37 still fighting"; green faucet success; stock popovers | `MarketBadge.tsx`, `FaucetButton.tsx`, `WalletButton.tsx` | Ink plus neutral 24/7 badge; toasts | P4 |
| Green "Round live" and note text; orange K.O.; red low health; cyan share ring | `FightView.tsx`, `FightFx.tsx`, `HealthBars.tsx` | Live dot plus ink; ink K.O.; stripes; ink ring | P5 |
| Orange "Winner takes both."; pink step numerals; cyan trust titles; green 37 and live count; cyan ranks and red L in Who Cooks | `page.tsx`, `SiteTally.tsx`, `TopFighters.tsx` | Green winner line; proof strip; ink stats | P6 |
| Orange weekend warning; green "runs now" note; cyan Pyth badge; green 24/7 | `CreateFight.tsx`, `StockPicker.tsx` | Ink notices; neutral badges | P7 |
| Pink tab underline | `FightsBoard.tsx` | Slanted segment tabs in ink | P8 |
| Green 24/7 tags; stock colour squares (lime, red) next to price moves | `Movers.tsx`, `TickerTape.tsx` | Neutral badge; sparkline or nothing | P9 |

---

## 4. Type scale

The faces don't change: Big Shoulders 900 for display, Big Shoulders Stencil for COOKED only, Geist for body, Geist Mono for numbers and labels. Roughly 19 ad hoc sizes become these named steps. Tailwind v4 turns each `--text-*` token (with its `--line-height` companion) into a utility.

| Step | Size / line height | Face | Use |
|---|---|---|---|
| `micro` | 10 / 12 | Geist Mono 500, +0.12em, uppercase | Badges, pip legends, chip counts |
| `label` | 11 / 14 | Geist Mono, +0.14em, uppercase, dim | Eyebrows, stat labels, column heads |
| `meta` | 12 / 16 | Geist | Second lines: who, stake, when |
| `sm` | 14 / 20 | Geist | Interface copy, row sentences, notices |
| `base` | 16 / 24 | Geist | Reading pages only (/how, legal) |
| `.num` | inherits size | Geist Mono, tabular | Every price, move, amount, clock and address |
| `num-lg` | 20 / 24 | Geist Mono 600, tabular | Live price on the fight page and the ticket |
| `hud-xs` | 18 / 18 | Big Shoulders 900 | Tickers in the tape, rails and the Wire |
| `hud-sm` | 24 / 24 | Big Shoulders 900 | Section heads, fight-row tickers, stat values |
| `.h-page` | 32 / 32, 40 / 40 at 1024px and up | Big Shoulders 900 | Page titles (replaces the 72px titles) |
| `hud-lg` | 56 / 50 | Big Shoulders 900 | Ticket tickers, open-challenge corners, stock page ticker |
| `hud-xl` | 64 / 54 on phones, 88 / 75 from 640px | Big Shoulders 900 | Fight corners only |
| `clock` | 48 / 48 | Geist Mono 600, tabular | Round countdown |
| `hud-ko` | 88 on phones, 128 from 640px, line height 0.85 | Big Shoulders 900 | K.O. and Draw only |

**Rules**
- **Big Shoulders is for names and counters:** tickers, section heads, stat values, the K.O. Never for prices or percentages.
- **Geist Mono is for anything someone compares:** prices, moves, shares, dollars, clocks, addresses.
- **One `hud-lg` or bigger per viewport,** except the two corners of the fight arena.
- **Token symbols keep their case.** Inside `.display` or `.btn`, wrap `NVDAx` in `normal-case`.
- **Numbers sit right-aligned in fixed-width columns,** so a refresh never shifts a row.
- **No arbitrary sizes** (`text-[9px]`, `text-[10px]`, `text-[1.55rem]`) once P1 lands.
- **Reading pages** keep lines to 68ch.

---

## 5. Space, shape, elevation and grid

**Spacing.** The base unit is 4px. Only 4, 8, 12, 16, 24, 40 and 64 are allowed.

| Between | Space | Tailwind |
|---|---|---|
| Items inside a row | 8 | `gap-2` |
| Cards in a list | 8 (hairline lists use 0 with `border-t border-line`) | `gap-2` |
| Blocks in a column | 24 | `gap-6` |
| Page sections | 40 | `mt-10` |
| Page top, under the nav | 24 | `py-6` |
| Space above the footer | 64 | `mt-16` |

**Padding** comes in three sizes only:
- **Dense** `px-3 py-2.5`: rows, stat cells, stock tiles.
- **Standard** `p-4`: rails, notices, menus, ticket.
- **Arena** `p-5 sm:p-8`: the fight arena only.

**Radius** is zero. Only status dots are round. Avatars, rank numbers, tabs and buttons are slanted plates.

**Shapes**

| Shape | Definition | Used on |
|---|---|---|
| Slant 10px (`.btn`, `.plate`) | Parallelogram clip-path | Buttons, tabs, rank plates, avatars, badges in the nav |
| Notch 10px (`.plate-card`) | Top-right corner cut. Void shows through the cut, deliberately. | Arena, fight ticket, podium cards, stock page header |
| Slant 14px (`.plate-left`, `.plate-right`) | Existing | Health bars |
| Rope (`.rope`) | 2px top edge: cyan left half, pink right half | Anything that holds two sides: fight rows, the arena, the ticket, closing-soon cards |

Anything that pops out of a clipped container (menus, tooltips, sheets) renders in a portal on `document.body`, so the clip-path never cuts it.

**Elevation.** Surfaces carry the hierarchy: void, then panel, panel-2, panel-3. Drop shadows appear only on overlays (sheet, menu, toast), which use `--shadow-overlay`, a `line-strong` ring and a void/70 backdrop. Glows appear only on live things:
- the leading corner during a live round
- the race chart's line tips
- the winner plate during the K.O.

Glow never goes on a resting card or button.

**Stacking:** nav 20, bottom nav 30, sticky action bars 35, sheets and menus 40, toasts 50, K.O. 60.

**Grid**

*General rules*
- **Container:** `max-w-7xl` (1280px) with `px-4` on every page, up from 6xl. Reading pages use a centred 68ch column.
- **Breakpoints:** designed and checked at 375, 768, 1024 and 1440 wide.
- **No sideways scroll:** every grid or flex child holding text gets `min-w-0`. The page body never scrolls sideways; a wide list becomes stacked rows before it becomes a scroller.
- **Touch targets** are at least 40px on phones.
- **Fixed bars** reserve their own height through `--bottom-nav-h`.

*Page templates*

| Page | Layout |
|---|---|
| Home | xl: Ring 5fr, Wire 4fr, rail 3fr. lg: Ring and Wire stacked (7fr) beside the rail (5fr). Below lg: one column. |
| Fight | Arena full width, then 8fr (chart, receipt) and 4fr (actions, share). |
| `/new` | Picker 7fr, sticky ticket 5fr. |
| Profile | History 8fr, rail 4fr. |

---

## 6. Motion

Things move only to confirm that something changed: a real state change or a user action.

| What | Trigger (must be real) | Duration and easing | With reduced motion |
|---|---|---|---|
| Press | Pointer down | 80ms, translateY 1px, scale 0.99 | None |
| Hover | Pointer over | 120ms, colour only | Same |
| Price flash | A displayed price or move changes | 400ms ease-out, up-tint or down-tint to transparent | Colour changes, no flash |
| New row | An event id not seen on the last poll | 400ms, 6% ink fade | None |
| Digit roll | A countdown or live price digit changes | 300ms, translateY 60% to 0 | Instant |
| Chart tip ping | A new point is added | 600ms ring, once | None |
| Health bars | A new move | 700ms width | Instant |
| Hit flash, damage number, combo | The gap moves at least 0.01 percentage points | 320ms, 1.2s, 420ms | Damage hidden, the rest static |
| Shake | Heavy hit, at least 0.06 percentage points | 260ms | None |
| Final ten seconds | Clock under 10s | 1s stepped blink, ink | Static ink |
| K.O. | The fight settles while the page is open | 2.6s, once, only if witnessed | Static text |
| COOKED stamp | Loser shown | 420ms slam, once | Static |
| Toast | A notice arrives | 220ms in, 160ms out | Appears |
| Sheet, menu | User opens it | 240ms, 120ms | Appears |
| Live dot | Status is LIVE | 1.6s loop | Static |
| Tape | Always | 70s linear, pauses on hover | Static |
| Skeleton shimmer | While loading only | 1.4s loop | Static |

**Never animate:**
- entrance animations on page load, scroll-triggered reveals, parallax
- looping glows, animated gradients
- bouncing or pulsing buttons
- confetti, carousels
- rows re-sorting in animation
- counting a number up from zero on load (it shows values that never existed)
- the arena background

**Sound** is off by default. Four cues are synthesised with WebAudio, so there are no audio files:
- the bell when a round goes live
- a lead change, when the gap changes sign on a real price tick
- a tick each second in the final ten seconds
- the K.O.

The setting is remembered per viewer in localStorage. It stays off under reduced motion unless the viewer turns it on.

**The browser tab title** shows live state on fight pages, for example `NVDA +0.42% vs AAPL -0.10% · 4:12`, so the fight keeps moving in a background tab.

---

## 7. Component language

### 7.1 Shared primitives (P1, `src/components/ui/`)

**Layout and structure**
- **Plate.** The one container. Props: `notch`, `rope`, `pad` (none, dense, std, arena).
- **PageHeader.** Eyebrow label, `.h-page` title, optional inline stats and an action. Replaces the five 72px headers.
- **SectionHead.** `hud-sm` title, micro count, "all" link.
- **StatStrip.** A grid of stat cells with hairline gaps. The last cell stretches, so no breakpoint ever shows an empty cell. Values in `hud-sm`, labels in `label`.
- **Versus.** Three columns (`minmax(0,1fr) auto minmax(0,1fr)`) that stack below a chosen breakpoint. Replaces the five hand-built versions.

**Identity**
- **Identicon.** A 5x5 mirrored grid seeded from the wallet address (FNV-1a hash), drawn in ink on panel-2 inside a slanted plate. Never in side colours.
- **FighterName.** Identicon plus the X handle when the chain vouches for one (Profile and XClaim accounts). Otherwise a shortened address in one standard 4...4 format. Links to `/u/[wallet]`. Shows the full address on hover.
- **FormPips.** The last 10 results, oldest to newest:
  - W: a filled green square
  - L: a faint outline, not red
  - T: a dim dash

**Status and numbers**
- **Badge.** One micro size, six variants:
  - neutral: line ring, ink text
  - source: Pyth, Exchange, Extended hours, Perp, Last close
  - live: split dot plus "Live"
  - count
  - win: green on green tint
  - cooked: the mini stencil stamp
- **LiveDot.** The split cyan and pink dot.
- **FlashNum.** Wraps a number. When it changes it flashes up or down (price mode) or gives a neutral tint (count mode).
- **Countdown.** Digit-by-digit clock to a unix time with `role="timer"`. Sweats in the final ten seconds. Screen readers get an update at most every ten seconds.
- **Sparkline.** SVG polyline with no axes and a dot on the last point. Tone is set by the data: "move" picks green or red from first to last value; "p1" or "p2" when the line represents a side; "ink" otherwise. Fewer than two points draws a faint dash.
- **ExplorerLink.** Shortened address or signature with an arrow glyph. Opens Solana Explorer on the right cluster.
- **Kbd.** Keyboard hint chip.

**Feedback**
- **Skeleton and SkeletonRows.** Shapes match the real rows: fight row 64px; quote, fighter and event rows 36px. The shimmer runs only while loading.
- **Notice.** Ink plate with an i, ! or x glyph, a title, a body and an optional action (Retry). The only way to show a warning or error.
- **Empty.** Title, one line, and an action that goes somewhere.
- **Toast.** A module store that works before anything is mounted; `push`, `update` and `dismiss`.
  - Tones: neutral, win (green rule), cooked (mini stamp).
  - Up to 3 at once.
  - Position: top-centre on desktop, just above the bottom nav on phones.
  - Stays 6 seconds; hover pauses it; Escape dismisses.
  - Announced politely to screen readers.
- **TxButton.** Runs a transaction through five states: idle, signing, confirming, done, error.
  - Once the signature exists it shows an explorer link.
  - When done it pushes a toast with "Confirmed in 1.4s", measured from the real send and confirm.
  - Errors use the program's own readable message.

**Overlays and controls**
- **Tabs.** Slanted segment plates with `role="tablist"`, `aria-selected`, arrow-key movement and counts. `useUrlTab` keeps the choice in the URL, so a refresh keeps the tab.
- **Sheet.** A bottom sheet on phones and a side or centred panel on desktop. Traps focus, closes with Escape or a backdrop click, locks page scroll.
- **Menu.** Anchored popover with `aria-expanded`, outside-click and Escape to close, and arrow keys through items.
- **Tip.** Tooltip that opens on hover, focus or tap. Replaces `title=` attributes, which do nothing on touch screens.

**Cross-component signals** (`intents.ts`)
- `requestConnect()`: any button can open the wallet picker.
- `watchFight()` and `watchedFights()`: fights a viewer opened, stored in localStorage, so toasts can follow them.

### 7.2 Composites built on top

| Composite | What it is | Package |
|---|---|---|
| FightRow | Dense rope row: side tickers, moves, status badge with age or clock, FighterNames, dollars a side, winner badge, mini COOKED stamp, taunt line, Take chip | P6 |
| RaceChart | The "price to beat" chart: two lines as percent from each on-chain start, dashed start line, glowing tips, bell marker, shaded gap, crosshair | P5 |
| Receipt | Timeline of every on-chain step, with who signed and explorer links | P5 |
| FightTicket | Sticky two-sided ticket with stake and round chips, win preview, next-step button | P7 |
| Wire | Live stream of real fight events with true ages | P6 |
| BottomNav, CommandPalette, account Menu | App shell | P4 |

---

## 8. Density on board pages

1. **Every row shows four things:** identity (ticker or handle), state, the number that matters, and age. A row missing any of these isn't finished.
2. **Row heights:**
   - 36px in rails (Movers, Wire, Who Cooks)
   - 64px for fight rows
   - nothing on a board taller than 96px on a phone
3. **Numbers sit right-aligned in fixed-width mono columns.** Labels are dim, numbers are ink, and colour is used only for state.
4. **The first desktop viewport (1440x900)** shows the tape, the stats strip, at least 6 fight rows, 8 Wire events and 8 movers. On a phone (375x812) it shows the stats strip and at least 3 fight rows.
5. **Above the fold,** at most one line of prose (the pitch). Explanations live on /how and in Tips.
6. **Truncate, don't wrap.** Every text holder gets `min-w-0`, and handles and names truncate with an ellipsis.
7. **Quiet is shown with a real age.** When no round is live, the strip shows "Last bell 3h ago". Empty states only appear when there has truly never been anything.
8. **Rails show N rows plus an "all" link with a count.** No infinite scroll on the home page.
9. **Money never scrolls off screen.** On phones a table becomes stacked rows before it becomes a sideways scroller.
10. **No test data by default.** Fights on test tokens (ETHt, SOLt, BTCt, or mints not in the roster) are hidden from boards and counted in a visible note that links to them.

---

## 9. Features, in priority order

Every item reads data the app already reaches.

| # | Feature | Real source | Package |
|---|---|---|---|
| 1 | Arena background restored; visible focus; colour rules enforced; shared primitives | `globals.css` | P1 |
| 2 | Honest live prices out of hours:<br>• perpetual futures mid when the exchange is shut<br>• last extended-hours 1-minute bar before and after the session<br>• 1-minute bars route for charts | Hyperliquid `allMids` and `candleSnapshot`; Yahoo v8 chart `interval=1m&includePrePost=true` (already in `oracle.ts`) | P2 |
| 3 | Fighter identity everywhere; fighter profiles `/u/[wallet]`; leaderboard sorted by money, with podium, form and records | Duel accounts (`useDuels("all")`), Profile and XClaim accounts (`useProfiles`), a pure derive layer | P3 |
| 4 | App shell:<br>• toasts for your fights and fights you watch<br>• wallet menu with SOL and share balances<br>• command palette<br>• mobile bottom bar with a called-out count<br>• branded 404 and error pages | Duel list compared between polls; `getBalance`, `getTokenAccountsByOwner`; roster; `invitee` field | P4 |
| 5 | The fight screen:<br>• price to beat per side<br>• race chart<br>• a K.O. that reads correctly (loser bar empty, "Took" plate, stamp off the ticker)<br>• receipt with explorer links and "settled by"<br>• K.O. share card, live tab title, sound, sticky answer bar | On-chain start and end prices; `/api/bars` plus `/api/prices` polls; `getSignaturesForAddress` plus `getTransaction` with Anchor event logs | P5 |
| 6 | Home as a board:<br>• dense fight rows with winner and age<br>• the Wire, a closing-soon strip, "Last bell" age<br>• proof strip instead of billboards<br>• fixed mobile overflow | Duel timestamps (`createdTs`, `acceptedTs`, `startTs`, `endTs`), outcomes, stakes, taunts | P6 |
| 7 | Fight ticket on /new:<br>• 24/7 default pair when the exchange is shut<br>• win preview, round chips with end times<br>• next-step button, `invite` link for rematches | `stakeForDollars`, `pricedAt`, `nextBell`, `weekBell`, live prices | P7 |
| 8 | /fights board: tabs kept in the URL, called-out inbox, filters by wallet or ticker, date dividers | Duel list, `invitee` | P8 |
| 9 | Stock pages `/s/[ticker]`: live price with source, intraday chart, month sparkline, record on chain, open challenges. Tape and Movers link to them. | Roster, `/api/prices`, `/api/bars`, `/api/stats` closes, derive | P9 |
| 10 | /how with table of contents and a worked example built from the latest real settled fight; legal pages aligned; dead code removed | Duel list | P10 |

**Deliberately not built:**
- spectator counts (needs presence infrastructure; a thin number looks worse than none)
- comments (the on-chain taunt is the honest version)
- WebSocket push (the relay can't hold sockets; polling every 3 to 10 seconds is enough)
- replays, badges beyond deterministic ones, a density toggle

**Before the demo:**
- Film live rounds on roster stocks, from wallets you own.
- If P2 hasn't landed, film between 9:30am and 4pm ET.
- Link your own X handle first; zero handles are linked on devnet today.
- Don't use fight 46tp... as the demo, because its stakes were unequal.

---

## 10. Honesty rules (part of the brand)

1. **Every number comes from chain state, the roster or a named price source.** Loading shows skeletons, never zeros or placeholder rows.
2. **Display-only data says so.** The race chart, stock charts and live moves carry the caption "For watching. The result uses only the on-chain start and bell prices."
3. **Prices carry their source:** Pyth, Exchange, Extended hours, Perp, Last close.
4. **Test-token fights are hidden from boards by default** and counted in a visible note. They're never deleted from records, because they really were settled on chain.
5. **Wallets are called wallets.** Say "wallets with a result", never "users".
6. **Quiet looks quiet.** "Last bell 3h ago" is better than a padded board.
7. **Cancelled fights close their account,** so their links stop working. Where a link fails, the page says exactly that.

---

## 11. Voice

A fight announcer who works a trading desk: short, present tense, exact and deadpan. The players bring the trash talk through their taunts; the site stays calm.

**Rules**
- Never use em dashes. Use a period, a colon or " · ". En dashes aren't allowed either; write "to".
- Write sentence case in the source. CSS does the uppercasing. Token symbols keep their case: NVDAx.
- Name units: "percentage points", "NVDAx", "ET".
- Format numbers only through `lib/format.ts` (`pct`, `points`, `shares`, `usd`, `ago`, `etWhen`), so a quiet weekend never prints -0.00%.
- "Cooked" is only for the loser at the bell. "Take", "call", "bell" and "run it back" are the verbs.
- Errors say what happened and what happens next. Never show raw error strings or stack traces.
- No hype words ("revolutionary", "seamless", "unleash", "100x") and no invented urgency.

**Copy bank**

| Place | Copy |
|---|---|
| Buttons | Pick a fight · Take it · stake 0.1145 HOODx · Connect to take it · Get test HOODx · Run it back vs @handle · $26 a side · Call it off · Send both stakes home |
| Status | Live · 4:12 to the bell · Closes in 6d 15:59:50 · Prices from Mon 4:00 AM ET · Final · 3h ago · Dead heat |
| Result | Took 0.0100 METAx · $6.48 · Won by 0.0062 percentage points · Sat 12 Sep, 4:21 to 4:27 PM ET · 6 min round |
| Wire | NVDA vs AAPL opened · 0.11 NVDAx on the table · @handle took it · AAPL cooked NVDA by 0.29 pts · took $25.00 · Dead heat. Both stakes home. |
| Toasts | Your NVDA challenge was taken. · Round live: NVDA vs AAPL. · Bell. You took 0.11 AAPLx. · Cooked. AAPL beat NVDA by 0.29 percentage points. Run it back? · You were called out: NVDA vs AAPL. |
| Empty | Nothing on the wire in the last hour. · Nobody has called you out. · No fights on chain for this wallet yet. |
| Errors | Could not reach Solana. Retrying. · Prices are unavailable right now. Moves fill in when they return. |
| Captions | For watching. The result uses only the on-chain start and bell prices. · Decides nothing. |

---

## 12. Work packages

The workflow runs these one at a time, in order, on the main working tree:
- Package 1 touches only `src/app/globals.css` and new files under `src/components/ui/`.
- Every later package owns a disjoint set of files, and may import package 1's primitives and anything earlier packages created.
- The order puts foundations and correctness first, then the most visible work.
