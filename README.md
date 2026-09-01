# Keel

Event Contracts with a fixed line. Stake in plain language. Redeem what settled. Roll the next window.

Built for the Somnia × DreamDEX Event Contracts Hackathon (DoraHacks). Deadline 8 September 2026.

## What it does

Event Contract prices are Up probabilities between 0 and 1. Windows expire and respawn. Winnings do not arrive in the wallet until someone redeems.

Keel is the missing layer:

1. **Markets** — live BTC/ETH 15-minute and 1-hour windows with a one-sentence ticket: chance, stake, redeem-if-win, max loss.
2. **Desk** — open positions from the local journal, **Redeem all** on settled windows, optional select of the next live window for a roll.
3. **Journal** — trades, redeems, and rolls stored in the browser, with transaction hashes when the SDK returns them.

## Stack

- Vite + React + TypeScript
- `@somnia-chain/markets-sdk` ≥ 0.28.1
- `viem`
- Shannon testnet (chain ID 50312) by default; mainnet selectable

Writes are gated on on-chain market status `1` (Trading). Market and pool addresses are never hardcoded.

## Run

```bash
git clone https://github.com/Godwin-web3/keel.git
cd keel
npm install
npm run dev
```

Open the printed localhost URL. Click **Connect & load windows** for read-only market data.

To trade or redeem, paste a **session / trading** private key only. Do not use a wallet that holds the rest of your funds. The key stays in React state in this browser tab; it is not uploaded.

Docs:

- https://docs.dreamdex.io/developers/event-contracts
- https://docs.dreamdex.io/developers/event-contracts/recipes
- https://github.com/somnia-chain/dreamdex-bot-kit

## Networks

| | Shannon testnet | Mainnet |
|---|---|---|
| Chain ID | 50312 | 5031 |
| Indexer | https://dev.smk.somnia.host/v1/graphql | https://prd.smk.somnia.host/v1/graphql |
| WS RPC | wss://api.infra.testnet.somnia.network/ws | wss://api.infra.mainnet.somnia.network/ws |
| Collateral | tUSDC (6 decimals) | USDso |

## Demo script

1. Connect on Shannon without a key. Show live windows and read one ticket aloud.
2. Connect with a funded test key. Stake a small Up or Down.
3. After a window resolves, open Desk and Redeem.
4. With roll enabled, the next Trading window is selected automatically.

## Known limits

- Position discovery for unjournaled historical holdings needs ERC-6909 balance reads. This MVP tracks fills through the local journal plus live market status.
- `redeemOutcome` is called through the trader/client surface. If your installed SDK names the method differently, adjust `src/lib/sdk.ts`.
- Indexer lag is real. Status is re-read on-chain before every write.

## DoraHacks

- Title: **Keel — Event Contracts, redeem and roll**
- Repo: https://github.com/Godwin-web3/keel
