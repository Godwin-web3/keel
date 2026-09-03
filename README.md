# Keel

Trade BTC and ETH event windows on Somnia. Parlay two assets in one ticket, run a series with cash-out / stop / max-round limits, and claim settlement automatically.

**Live:** https://keel-black-phi.vercel.app  
**Network:** Shannon testnet (chain 50312) · tUSDC collateral. Mainnet is selectable in the wallet sheet.

## What it does

Event Contracts pay only when you redeem, and they only list single windows. Keel sits on top of `@somnia-chain/markets-sdk`:

| | |
|---|---|
| **Parlay** | BTC and ETH, same window. Stake splits. Pays if both sides hit. |
| **Run** | Restakes the next window until cash-out, stop, or max rounds. |
| **Claim** | Watches settlement on your open positions and redeems winners. Losers are skipped (pay 0). Voids redeem both sides. |

Wallet connect only. Browse without connecting.

## Stack

Vite, React, TypeScript, viem, `@somnia-chain/markets-sdk`.

```bash
git clone https://github.com/Godwin-web3/keel.git
cd keel
npm install
npm run dev
```

## Docs

- https://docs.dreamdex.io/developers/event-contracts
- [SDK-FEEDBACK.md](./SDK-FEEDBACK.md)
