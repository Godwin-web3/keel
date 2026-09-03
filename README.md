# Keel

**Event Contracts that actually pay out.**

Stake Up or Down on BTC/ETH windows in plain language. When the window settles, Keel finds the USDso sitting in finalized markets and pulls it back.

Live: https://keel-black-phi.vercel.app  
Repo: https://github.com/Godwin-web3/keel  
Hackathon: Somnia × DreamDEX Event Contracts (DoraHacks) — deadline 8 September 2026.

## The problem

DreamDEX Event Contracts do not send winnings to the wallet on expiry. Positions sit in ERC-6909 outcome tokens on settled windows until someone calls redeem. `loadMarkets()` skips finalized markets, so a naïve app reports nothing to claim while the money is still on-chain.

Keel is that missing layer.

## What it does

1. **Markets** — live BTC/ETH windows, odds bar, countdown, probability chart scoped to the window (not the recycled pool's whole history). Ticket copy is “bet $10, win about $X, lose at most $10.”
2. **Edge line** — book implied-Up vs how far spot has already moved this window (`Book 62% Up · spot already +0.4% this window`).
3. **Desk** — open and claimable positions from the local journal **and** on-chain (`getPortfolio` + `getClaimable` + finalized scan). Survives a new browser.
4. **Auto-claim** — opt-in redeem of **winners** as soon as settlement is visible. Losing sides are skipped (redeeming them succeeds and pays 0). Voids redeem both sides at 0.5.
5. **Down is a buy of `#NO`**, not a sell of `#YES`.
6. **Writes gated** on on-chain status `1` (Trading). IOC so unfilled size does not rest.

## Stack

- Vite + React + TypeScript
- `@somnia-chain/markets-sdk` ≥ 0.28.1
- viem
- Shannon (50312) by default; mainnet selectable
- Injected wallet (MetaMask / Rabby) plus session-key fallback

## Run

```bash
git clone https://github.com/Godwin-web3/keel.git
cd keel
npm install
npm run dev
```

Browse with no wallet. Connect to bet. Use a throwaway Shannon key if you skip the injected wallet — never a key that holds the rest of your funds.

## Demo script

1. Open the live URL. Markets load without connecting.
2. Connect Rabby (Shannon). Stake a small Up or Down. Hash lands in Activity.
3. Wait for settle (or pick a window that already resolved). Unclaimed pill lights up.
4. Auto-claim or tap Claim. Explorer hash. Balance moves.
5. New tab, reconnect. Desk still shows on-chain leftovers. Sweep.

## Networks

| | Shannon | Mainnet |
|---|---|---|
| Chain ID | 50312 | 5031 |
| Indexer | https://dev.smk.somnia.host/v1/graphql | https://prd.smk.somnia.host/v1/graphql |
| Collateral | tUSDC (6 decimals) | USDso (18 decimals) |

## Docs

- https://docs.dreamdex.io/developers/event-contracts
- https://docs.dreamdex.io/developers/event-contracts/recipes
- https://docs.dreamdex.io/developers/event-contracts/gotchas
- https://github.com/somnia-chain/dreamdex-bot-kit
- [SDK-FEEDBACK.md](./SDK-FEEDBACK.md) — notes for the optional hackathon feedback report
