# SDK / docs feedback (Event Contracts Hackathon)

Optional DoraHacks attachment. Things we hit while building Keel on `@somnia-chain/markets-sdk` ≥ 0.28.1.

## What worked

- `listLiveBinaryMarkets` + typed `asset` / `expiry` / `tradingStart` on the indexer row. Do not parse the question text.
- `getMarketOnchain` status gating before writes. Indexer lag is real.
- `trader.redeem({ marketId, market, outcomeToken, outcomeIdx, amount })` with `getOutcomeBalance({ outcomeToken, account, id })` as an object, not positional args.
- `getPortfolio` / `getClaimable` for positions that `loadMarkets()` will never return.
- Unified `createOrder` on `#YES` / `#NO` tradable symbols, IOC.
- `watchMarkets({ discover: true })` and `watchPrice("BTC"|"ETH")` instead of blasting 50 order books every 15s.

## Gotchas the recipes should put in the first screen

1. **Winnings are claimed, not received.** A bot that never redeems looks broke. `loadMarkets()` skips finalized binary markets. Use `listBinaryMarkets({ status: "Finalized" })`, `listPastBinaryMarkets`, or `getClaimable`.
2. **Losing redeem succeeds and pays 0.** Check the winning outcome before spending gas.
3. **Voids: redeem both sides** at 0.5. There is no inferred winner.
4. **Candles and fills are keyed on pool, and pools are recycled.** Scope `getCandles` with `from`/`to` for this market's `tradingStart`–`expiry`, or you chart the last 40 windows.
5. **`getOutcomeBalance` takes `{ outcomeToken, account, id }`.** Positional arguments throw.
6. **Down is `#NO` buy**, not `#YES` sell, unless you already hold Up inventory.
7. SDK 0.28.0+ for tick-grid prices. Below 0.23.0 `loadMarkets` fails on the dropped `longOpenInterest` column.

## Docs nit

The Event Contracts landing page still reads like a bot kit. A one-pager for a consumer app (discover → IOC stake → wait → redeem) would have saved us a day of guessing method names.

Keel implements that one-pager: https://github.com/Godwin-web3/keel
