# Keel

Seal a BTC or ETH Event Contract so the book cannot see Up or Down until you unseal it onto DreamDEX.

**Live:** https://keel-black-phi.vercel.app  
**Network:** Shannon testnet (chain 50312) · tUSDC collateral. Mainnet is selectable in the wallet sheet.

## What it does

Event Contracts are public: side, size, wallet. Keel adds a commit–reveal escrow (`contracts/KeelSeal.sol`) in front of `@somnia-chain/markets-sdk`:

| | |
|---|---|
| **Seal** | Lock tUSDC/USDso with a hash of (market, side, amount, salt). Chain sees a commitment, not Up or Down. |
| **Unseal** | Reveal, get the money back, place the real DreamDEX order. Miss the deadline and you refund — the side was never shown. |
| **Claim** | Watches settlement and redeems winners. |
| **Parlay / Run** | Still there. Sealed tickets are the default. |

First seal on a network deploys KeelSeal from your wallet, then reuses that address.

Wallet connect only. Browse without connecting.

## Stack

Vite, React, TypeScript, viem, `@somnia-chain/markets-sdk`.

```bash
git clone https://github.com/Godwin-web3/keel.git
cd keel
npm install
npm run compile:seal
npm run dev
```

## Docs

- https://docs.dreamdex.io/developers/event-contracts
- [SDK-FEEDBACK.md](./SDK-FEEDBACK.md)
