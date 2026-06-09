# TrapGrid

A 2-player simultaneous strategy game on a customizable grid.

## How to play locally (same computer)
Just open `index.html` in a browser. Both players use the same window.

## How to play online with a friend

### Option A — Netlify Drop (easiest, free)
1. Go to https://app.netlify.com/drop
2. Drag the entire `trapgrid` folder onto the page
3. You'll get a public URL — share it with your friend
4. Both open the URL, one creates a room, shares the 6-letter code, friend joins

### Option B — GitHub Pages
1. Push this folder to a GitHub repo
2. Go to Settings → Pages → set source to main branch
3. Share the generated URL

### Option C — Any static host
Upload `index.html` to any static host (Vercel, Surge, Cloudflare Pages, etc.)

## Game rules summary

- Each turn: both players secretly pick a piece + a square, then reveal simultaneously
- Pieces: Warrior ⚔️, Wizard 🧙, Dragon 🐉, Goblin 👺
- Trapping order: Warrior traps Wizard · Wizard traps Dragon · Dragon traps Warrior
- A sequence scores when your piece flanks an opponent's piece in a row/column (e.g. Warrior–Wizard–Warrior)
- Goblin is a wildcard — can be trapped by any main piece
- Bonus squares (×2, ×3) multiply sequence score
- Win by claiming the most squares when the board fills up

## Board customization (host only, before game starts)
- **Grid size**: 6×6, 7×7, or 8×8
- **Shape**: exclude individual cells to create irregular boards
- **Bonus squares**: paint ×2 and ×3 multiplier squares anywhere
