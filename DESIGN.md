# Keel visual system

Source: [Fey on Refero Styles](https://styles.refero.design/style/a0630421-7b66-48b4-aa14-6194a3b2c2b9) — “nocturnal Bloomberg terminal, matte-black with luminous type.” Product density follows [Mercury](https://styles.refero.design/style/3172cd4d-118a-4a16-a259-6b634d32322e): surfaces lift by value, not shadow.

Keel is a testnet trading desk. Chromatic color is signal (Up / Down / live). Everything else is ink, charcoal, white.

## Canvas

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0b0b0b` | Page |
| `--bg-1` / `--bg-3` | `#131313` | Inputs, nested |
| `--bg-2` | `#191919` | Cards |
| `--text` | `#ffffff` | Primary type |
| `--text-dim` | `#cccccc` | Secondary |
| `--muted` | `#868f97` | Labels |
| `--accent` | `#ffffff` | Primary action fill |
| `--accent-ink` | `#0b0b0b` | Text on primary |
| `--signal` | `#479ffa` | Active tab underline |
| `--up` | `#4ebe96` | Up / win |
| `--down` | `#d46a6a` | Down / loss |

No second brand color. No gradient on chrome. No card drop-shadow on product screens.

## Type

Calibre is licensed. Substitute: **Outfit** (geometric, slightly compressed) + **IBM Plex Mono** for addresses, IDs, and tabular figures.

- Body 14 / 400 / 1.5
- Section title 18 / 500
- Numbers: `font-variant-numeric: tabular-nums`
- Headings never 700+ on product chrome
- Display tracking `-0.04em` to `-0.08em` only if a large title appears

## Shape

- Buttons, wallet trigger, tabs, chips: pill (`999px`)
- Cards: `16px`
- Inputs: `10px`
- Concentric: card 16, control inside it is pill or 10

## Controls

- **Primary:** white fill, black label, pill, no shadow
- **Ghost:** transparent, 1px `#e6e6e6` at 25% on dark, white label
- **Up / Down:** solid `--up` / `--down`, white label, pill
- **Tabs:** muted until active; active gets 1px bottom `--signal`
- One primary action per sheet

## Density

Max width 1200px. Card padding 18–24px. Element gap 10–16px. Nav is a quiet bar, not a marketing hero.

## Don’t

- Don’t use Fey’s ember orange or frost gradients on the desk
- Don’t use 275px “featured” radii on trading cards
- Don’t use 44px black halo shadows on every panel
- Don’t introduce cobalt/violet (Mercury marketing, Origin iris)
- Don’t put Inter on the page
