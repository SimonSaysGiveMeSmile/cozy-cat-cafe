# 🐾 Cat Run

A **minimal ink-on-paper** endless runner — and you can **swap your runner between cats and memes mid-jump**. Clean line-art, one pop of colour, and a day → night world that inverts as you go. Built for phones and desktop, with the controls living in a thumb-friendly bar **below** the play area.

> _(Formerly "Cozy Cat Café Run". URL & repo slug stay `cozy-cat-cafe`.)_

**Play:** https://cozy-cat-cafe.vercel.app

- Crisp monochrome design language: ink silhouettes on warm paper, a single dashed ground line, monospace score — restrained and readable
- **Day ↔ night inversion**: the whole world flips from ink-on-paper to glowing line-art-on-espresso as distance climbs
- 12-character roster (cats 😻😺😸😼🙀😹🐈 + memes 🗿🐸😎🤓💀), each with a distinct feel — the runner is the one splash of colour
- Instant **poof swap** any time — even mid-jump
- **Make it yours** — set a display name and ride *any* emoji you type/paste as your custom runner (grapheme-safe; persists locally)
- **Online leaderboard + racing ghosts** — finish a run and you're posted to a global top board; the top runs come back as faint "ghosts" you race (and overtake) on your next run
- Jump / duck obstacles, build the **vibe meter** through COZY → TOASTY → GOLDEN → PURR tiers
- Frame-rate-independent loop — smooth on 60Hz and 120Hz/ProMotion displays alike
- Single self-contained `index.html` · vanilla JS + Canvas · vector-drawn obstacles · persistent hi-score
- **Mobile-first controls**: large DUCK / SWAP / JUMP buttons in a bar below the canvas (never overlapping the view); tap anywhere on the play area to jump
- Keyboard + touch · `prefers-reduced-motion` aware

Built by [SimonSaysGiveMeSmile](https://github.com/SimonSaysGiveMeSmile).

**Controls:** `Space/↑/tap` jump · `↓` duck · `C` swap (Shift+C back) · `M` mute · `P` pause

## Online features

The global leaderboard + ghosts are **serverless and Vercel-native** — no always-on game server. On game over the client POSTs `{name, char, score, samples}` (a vertical track sampled every 12 m) to `/api/scores`, a Vercel Function that reads/writes a single `catrun.json` in a separate GitHub repo (optimistic-concurrency with retry). A GET returns the top board + the top runs' ghost tracks.

- **Offline / `file://`** degrade silently — the client only calls the API over `http(s)`, so the game is fully playable with no network.
- **Deployment** needs two env vars on the Vercel project (never commit them):
  - `GH_TOKEN` — a GitHub token with `repo` (contents-write) on the data repo
  - `GH_DATA_REPO` — the datastore repo slug (defaults to `arcade-hub-data`)
- Light hardening: per-IP rate-limit (best-effort), 100 KB body cap, input sanitization, capped run/sample/day storage. It's a hobby board — not an authenticated anti-cheat system.

## Tests

```
npm test      # node tests/run.js && node tests/gameplay.js && node tests/online.js
```

All three suites load the real `index.html` in headless Chrome (DevTools Protocol) and drive `window.__cozy`:
- `run.js` — frame-stepping: no frozen frames at 120Hz, frame-rate independence across 30/60/120Hz, tunnel-safe sub-stepping, refocus-gap clamping, input→motion, no console errors.
- `gameplay.js` — gameplay correctness: hazards, ducking, fish bonus, scoring/best, swap wrap, sub-step collision parity.
- `online.js` — customization + leaderboard client: custom-emoji add/cap/persist, `applyBoard` parsing, ghost replay safety (no crash on tiny/partial tracks), offline no-op. Runs over `file://`, so it never touches the network.

Requires Chrome (`CHROME_BIN` overrides the path).
