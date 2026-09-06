# Keel · Pitch Deck

Somnia × DreamDEX Event Contracts — judges deck (markdown mirror of `docs/pitch-deck.html`).

Paste into Google Slides / Keynote as needed. Brand: mint `#00d4a4` on ink `#0e1116`.

---

## 1 · Title

**Keel · Somnia × DreamDEX Event Contracts**

Event Contracts, side hidden until reveal.

Commit–reveal escrow in front of DreamDEX Event Contracts.

- Live: https://keel-black-phi.vercel.app
- Shannon testnet · tUSDC

---

## 2 · Problem

**Event Contracts are public.**

- Side, size, and wallet are visible on-chain as soon as an order hits the book.
- Short windows (minutes) make that signal valuable — others can **copy or front-run** before expiry.
- Confident flow into DreamDEX volume suffers when every intent is a free look.

| Public by default | Short windows |
|---|---|
| Intent = edge leakage on a short clock. | Copy/front-run matters most when seconds count. |

---

## 3 · Solution

**Commit–reveal escrow · KeelSeal**

- Lock collateral with a hash of `(market, side, amount, salt)`.
- The chain sees a **commitment**, not Up/Down — side stays hidden until reveal.
- On reveal, Keel verifies the hash and places the real DreamDEX order.
- Miss the deadline → **refund**. Outcome was never shown.

Flow: **Commit → Hold → Reveal → DreamDEX place**

---

## 4 · How it works

**Seal → Hold → Reveal → Place**

1. **Seal** — Commit hash + escrow tUSDC into KeelSeal. Side not on the book yet.
2. **Hold** — Contract enforces deadline and replay checks — not trust.
3. **Auto-reveal** — Last ~45s (or manual unseal). Trade still places on DreamDEX.
4. **Refund** — Cancel before reveal → full refund. Claim winners after settlement.

Default path: committed tickets. Parlay / Run still available on top.

---

## 5 · Product surfaces

| Surface | What judges see |
|---|---|
| **Markets** | Card grid · live pip · chance · Up/Down cents |
| **Seal both** | Commit from either side without leaking intent early |
| **Positions** | Detail view for sealed + open tickets |
| **Claim** | Watch settlement · redeem winners via SDK |
| **Run** | Parlay / restake path with committed defaults |

Brand: mint `#00d4a4` on ink `#0e1116` (see `DESIGN.md`).

---

## 6 · Technical

**App:** Vite · React · TypeScript · viem · `@somnia-chain/markets-sdk`  
Lean indexer fallback when the SDK’s heavy `MarketFields` fragment times out.

**KeelSeal.sol · Shannon (canonical):**  
`0xc77d38feA2d04eF1F1870b5FE1f0Dd5f7B70a1C9`

- No per-wallet deploy on first commit
- Chain 50312 · tUSDC collateral
- Wallet connect only · browse without connecting

---

## 7 · Live demo links

- **App:** https://keel-black-phi.vercel.app
- **Source:** https://github.com/Godwin-web3/keel

No demo mode — live SDK + on-chain escrow.  
See also `contracts/KeelSeal.sol` and `docs/sdk-notes.md`.

---

## 8 · Why it matters / ecosystem

- More **confident flow** into Event Contracts — traders can size without broadcasting side early.
- Application-specific protocol layer on Somnia / DreamDEX, not a fork of the CLOB.
- Constructive SDK feedback path: lean GraphQL, symbol join, HTTP RPC reads — see `docs/sdk-notes.md`.
- Volume stays on DreamDEX at reveal; Keel is the privacy front door.

---

## 9 · Ask / thanks

Thanks — happy to demo.

Feedback welcome on the seal UX, auto-reveal window, and SDK consumer path.

Optional DoraHacks attachments: this deck (`docs/pitch-deck.html` / `docs/PITCH.md`) + expanded SDK notes (`docs/sdk-notes.md`).

- https://keel-black-phi.vercel.app
- https://github.com/Godwin-web3/keel
