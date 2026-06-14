# 🐾 Cozy Cat Café Run

A **minimal ink-on-paper** endless runner through the quietest café in town — and you can **swap your runner between cats and memes mid-jump**. Clean line-art, one pop of colour, and a day → night world that inverts as you go.

**Play:** https://cozy-cat-cafe.vercel.app

- Crisp monochrome design language: ink silhouettes on warm paper, a single dashed ground line, monospace score — restrained and readable
- **Day ↔ night inversion**: the whole world flips from ink-on-paper to glowing line-art-on-espresso as distance climbs
- 12-character roster (cats 😻😺😸😼🙀😹🐈 + memes 🗿🐸😎🤓💀), each with a distinct feel — the runner is the one splash of colour
- Instant **poof swap** any time — even mid-jump
- Jump / duck obstacles, build the **vibe meter** through COZY → TOASTY → GOLDEN → PURR tiers
- Frame-rate-independent loop — smooth on 60Hz and 120Hz/ProMotion displays alike
- Single self-contained `index.html` · vanilla JS + Canvas · vector-drawn obstacles · persistent hi-score
- Keyboard + touch · `prefers-reduced-motion` aware

Built by [SimonSaysGiveMeSmile](https://github.com/SimonSaysGiveMeSmile).

**Controls:** `Space/↑/tap` jump · `↓` duck · `C` swap (Shift+C back) · `M` mute · `P` pause

## Tests

```
npm test      # node tests/run.js
```

Loads the real `index.html` in headless Chrome (via the DevTools Protocol) and drives the exposed `window.__cozy.advance()` to verify the frame-stepping: no frozen frames at 120Hz, frame-rate independence across 30/60/120Hz, tunnel-safe sub-stepping, refocus-gap clamping, input→motion, and no console errors. Requires Chrome (`CHROME_BIN` overrides the path).
