# Keel

**Not a market. A session instrument.**

DreamDEX Event Contracts sell one window. Keel composes them:

- **Parlay** — BTC × ETH, same minute. Combined payout. The venue cannot list this.
- **Run** — cash-out, stop-loss, max rounds. Claims, restakes the successor, halts itself.
- **Reactive claim** — watches settlement on your open windows and pulls USDso. Losing redeem is skipped (pays 0). Voids redeem both sides.

Live: https://keel-black-phi.vercel.app  
Repo: https://github.com/Godwin-web3/keel  
Hackathon: Somnia × DreamDEX Event Contracts — deadline 8 September 2026.

## The problem

Event Contracts do not send winnings. `loadMarkets()` skips finalized markets. There is no parlay. There is no multi-window instrument. A skin on Up/Down is not a product.

## Demo

1. Open the live URL. Markets load without a wallet.
2. Connect. Open a live BTC window. Toggle **Parlay with ETH**. Confirm. Desk shows both legs.
3. Open **Run**. $10 start, cash out $18, stop $5, max 5. Start. Watch hops.
4. Leave it. When a window finalizes, Keel redeems winners without a Claim tap.

## Stack

Vite + React + TypeScript · `@somnia-chain/markets-sdk` ≥ 0.28.1 · viem · Shannon 50312 / mainnet 5031 · injected wallet + session-key fallback.

## Run locally

```bash
git clone https://github.com/Godwin-web3/keel.git
cd keel
npm install
npm run dev
```

## Docs

- https://docs.dreamdex.io/developers/event-contracts
- https://docs.dreamdex.io/developers/event-contracts/recipes
- https://docs.dreamdex.io/developers/event-contracts/gotchas
- [SDK-FEEDBACK.md](./SDK-FEEDBACK.md)
