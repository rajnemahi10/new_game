# TrapGrid

A 2-player simultaneous strategy game on a customizable grid.

## How to play locally (same computer)
Just open `index.html` in a browser. Both players use the same window.

## How to play online with a friend

The game uses Firebase Realtime Database for live sync — the config is already
baked into `index.html`, so no setup needed. Just host the file anywhere:

### Option A — GitHub Pages (recommended)
1. Push `index.html` to a GitHub repo
2. Go to **Settings → Pages → set source to main branch**
3. Share `https://YOUR-USERNAME.github.io/REPO-NAME` with your friend
4. One player creates a room, shares the 6-letter code, friend joins

### Option B — Netlify Drop (easiest, no account needed)
1. Go to https://app.netlify.com/drop
2. Drag `index.html` onto the page
3. Share the generated URL with your friend

### Option C — Any static host
Upload `index.html` to Vercel, Surge, Cloudflare Pages, etc.

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
