# SDK & docs feedback — `@somnia-chain/markets-sdk`

Constructive notes from building **Keel** (consumer Event Contracts UI + commit–reveal escrow) against `@somnia-chain/markets-sdk` ≥ 0.28.1 on Somnia / DreamDEX.

Audience: DreamDEX / markets-sdk maintainers. Tone: what worked, what surprised us, and a few concrete doc asks — not a rant.

**Repo:** https://github.com/Godwin-web3/keel  
**Live:** https://keel-black-phi.vercel.app  
**Event Contracts docs:** https://docs.dreamdex.io/developers/event-contracts

---

## What worked

These APIs and shapes carried most of the product:

- **`listLiveBinaryMarkets`** with typed `asset` / `expiry` / `tradingStart` on the indexer row. Do not parse the question text for those fields.
- **`getMarketOnchain`** status gating before writes. Indexer lag is real; on-chain status saved us from bad reveals.
- **`trader.redeem({ marketId, market, outcomeToken, outcomeIdx, amount })`** with **`getOutcomeBalance({ outcomeToken, account, id })`** as an object — redeem shapes are clear once you use the object form.
- **`getPortfolio` / `getClaimable`** for positions that `loadMarkets()` will never return (finalized / claimable).
- Unified **`createOrder`** on `#YES` / `#NO` tradable symbols, IOC — good fit for Event Contract stakes.
- **`watchMarkets({ discover: true })`** and **`watchPrice("BTC"|"ETH")`** instead of blasting ~50 order books every 15s. Material for a consumer UI.

Keel's board and claim flow sit on this path end-to-end.

---

## Gotchas that still hold

Worth putting near the top of any Event Contracts / bot-kit guide:

1. **Winnings are claimed, not received.** A bot (or UI) that never redeems looks broke. `loadMarkets()` skips finalized binary markets. Use `listBinaryMarkets({ status: "Finalized" })`, `listPastBinaryMarkets`, or `getClaimable`.
2. **Losing redeem succeeds and pays 0.** Check the winning outcome before spending gas.
3. **Voids: redeem both sides** at 0.5. There is no inferred winner.
4. **Candles and fills are keyed on pool, and pools are recycled.** Scope `getCandles` with `from`/`to` for this market's `tradingStart`–`expiry`, or you chart the last N windows on a reused pool.
5. **`getOutcomeBalance` takes `{ outcomeToken, account, id }`.** Positional arguments throw.
6. **Down is `#NO` buy**, not `#YES` sell, unless you already hold Up inventory.
7. **SDK 0.28.0+** for tick-grid prices. Below 0.23.0 `loadMarkets` fails on the dropped `longOpenInterest` column.

---

## Indexer: `RegistryMarkets` / `LiveBinaryMarkets` + heavy `MarketFields`

### What we hit

`listLiveBinaryMarkets` (and related registry loads) often pull a large **`MarketFields`** GraphQL fragment — perp / funding / fields Keel never needs for a binary board. Under load that selection **times out** (`IndexerError` / signal timed out), which takes the whole market list down with it.

### What Keel does

On timeout (or empty live list), Keel falls back to a **lean GraphQL** query against the same indexer: only `marketId`, `asset`, `expiry`, `tradingStart`, `intervalSec`, `strike`, `poolAddress`, `lastPrice`, tokens, status, etc. See `leanListLiveBinaryMarkets` in `src/lib/sdk.ts`.

That fallback is enough to paint Markets and drive seal/reveal. We still prefer the SDK path when it returns.

### Doc ask

Call out **`MarketFields` cost** in the indexer / `listLiveBinaryMarkets` docs: which fields are required for binary Event Contracts vs the full fragment, and that a minimal selection is a supported pattern for consumer UIs. A first-class `fields: "lean" | "full"` (or a documented lean query) would remove the need for app-side GraphQL.

---

## Indexer rows lack ccxt symbols

### What we hit

Live binary indexer rows expose `asset` / `expiry` / `tradingStart` (great) but **not** the ccxt-style trading symbol string used for books and `createOrder` (e.g. `BTC-0-12AUG26-1600/USDso#YES`). Symbol synthesis lives in the trading layer, not the indexer row.

### What Keel does

1. Build a **`marketId → trading symbol`** map from **`loadMarkets()`**.
2. Join indexer rows by `marketId`.
3. If books are thin, use a validated **`lastPrice`** (plausible probability in (0, 1)) as an odds fallback for the chance ring.

### Doc ask

Document **symbol synthesis / `marketId` join**: how consumer apps should go from `listLiveBinaryMarkets` → tradable `#YES`/`#NO` symbols, and that `loadMarkets` is the intended join key. Mention `lastPrice` semantics (fixed-point vs probability) if the indexer exposes it.

---

## Wallet provider `getCode` on the wrong chain ≠ missing contract

### What we hit

Injected wallet RPCs often answer **`eth_getCode` for the wallet's active chain**, not the app's selected Shannon/mainnet. A user on Ethereum mainnet in MetaMask gets `0x` for the Shannon KeelSeal address — which looks exactly like "contract not deployed."

### What Keel does

**Code and read checks for canonical KeelSeal use a public HTTP RPC** for that network (`getHttpPublicClient`), not the wallet provider. Writes still go through the wallet after the user switches chain.

### Doc ask

In any "verify deployment / getCode" recipe: **use HTTP RPC (or a pinned public client) for reads**; do not treat wallet-provider `getCode === 0x` as proof the contract is missing when the UI may be on another chain.

---

## Consumer path vs bot-kit docs tone

Current Event Contracts material reads strongest for **bots / market makers** (discover loops, candles, inventory). Keel is a **consumer** path:

**discover live binaries → IOC stake (or seal → reveal → place) → wait → redeem / claim**

That path is short and deserves a first screen. Bot-kit depth can stay; a parallel "build a simple Event Contracts UI" recipe would have saved us several wrong turns (positional `getOutcomeBalance`, assuming `loadMarkets` returns claimables, etc.).

### Doc ask

**First-screen consumer recipe** (10–15 lines): list live → resolve symbols → IOC `#YES`/`#NO` → `getClaimable` / redeem object shapes → note indexer lag + `getMarketOnchain` before writes. Link the bot-kit pages from there, not the other way around.

---

## Summary table for maintainers

| Area | Observation | Keel mitigation | Suggested docs / SDK tweak |
|---|---|---|---|
| Live list | Heavy `MarketFields` → timeouts | Lean GraphQL fallback | Document cost; lean fields option |
| Symbols | Indexer lacks ccxt symbols | `loadMarkets` `marketId` map + `lastPrice` odds fallback | Document join + `lastPrice` units |
| Reads | Wallet `getCode` wrong chain | HTTP RPC for contract presence | Warn in deploy/verify recipes |
| Docs tone | Bot-kit first | Consumer flow in app + these notes | First-screen consumer recipe |
| Redeem / claim | Easy to miss | Object redeem + `getClaimable` | Keep gotchas #1–3 prominent |

---

## Thanks

Happy to clarify any of the above with a short call or a PR against the docs repo. Keel depends on this SDK staying pleasant for consumer apps as well as bots — the primitives above already work; a little front-loaded guidance would make the next builder faster.
