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

### KeelSeal (Shannon)

Canonical contract (no per-wallet deploy on first commit):

- **Address:** [`0xc77d38feA2d04eF1F1870b5FE1f0Dd5f7B70a1C9`](https://shannon-explorer.somnia.network/address/0xc77d38feA2d04eF1F1870b5FE1f0Dd5f7B70a1C9)
- **Collateral (tUSDC):** `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`
- **Deploy tx:** [`0xb7456324821f7a63761085357d9be7b26b2e15d328704c0f2e273fe2e7f88c12`](https://shannon-explorer.somnia.network/tx/0xb7456324821f7a63761085357d9be7b26b2e15d328704c0f2e273fe2e7f88c12)

Mainnet address is unset until deployed. Wallet connect only. Browse without connecting.

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
- [SDK notes](./docs/sdk-notes.md)
