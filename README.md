# Keel

A cryptographic commit–reveal layer for Somnia Event Contracts.

**Live:** https://keel-black-phi.vercel.app  
**Network:** Shannon testnet (chain 50312) · tUSDC collateral. Mainnet is selectable in the wallet sheet.

## What it does

DreamDEX Event Contracts are public: side, size, wallet. Keel acts as an application-specific protocol layer that adds cryptographic commitment and reveal semantics around them. It provides a commit–reveal escrow (`contracts/KeelSeal.sol`) in front of `@somnia-chain/markets-sdk`:

| | |
|---|---|
| **Commit** | Lock tUSDC/USDso with a hash of (market, side, amount, salt). The chain sees a commitment, not the specific outcome. |
| **Reveal** | Reveal the parameters, verify the hash on-chain, and place the real DreamDEX order. Miss the deadline and you refund — the outcome was never shown. |
| **Claim** | Watches settlement and redeems winners. |
| **Parlay / Run** | Still there. Committed tickets are the default. |

First commit on a network deploys KeelSeal from your wallet, then reuses that address.

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
