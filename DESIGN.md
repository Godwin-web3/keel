# Keel visual system

Not a token sheet. Pattern language from live products:

- **[Polymarket](https://polymarket.com)** — dark feed, thumbnail + question + circular chance + Yes/No on the card
- **[Kalshi](https://kalshi.com)** — mint brand, Connect as a filled CTA
- **[Limitless](https://limitless.exchange)** — leaderboard with avatars, medals, columns

## Brand

Mint `#00d4a4` on ink `#0e1116`. Logo is a filled keel cutting a waterline (`src/Logo.tsx`, `public/favicon.svg`). Wordmark: Bricolage Grotesque. UI: DM Sans. Numbers: IBM Plex Mono.

BTC is orange. ETH is violet. Up is `#3ddc8a` on `#123528`. Down is `#ff6b6b` on `#3a1518`. Those are the only chromatic fills besides the mint CTA.

## Product surfaces

- Markets are a **card grid**, not a round carousel
- Each card: asset mark, live pip, question, chance ring, Up/Down cents
- Leaderboard: identicon, gold/silver/bronze, PnL — not a dump of addresses
- Connect is mint, not a ghost outline
