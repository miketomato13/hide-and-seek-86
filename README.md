# Hide + Seek '86

A 1980s arcade hide-and-seek game with AI seeker agents. Survive 30 seconds per level. Every level cleared, another seeker-bot joins the hunt.

## Files

- `index.html` — page shell, styling, HUD, touch controls
- `game.js` — all game logic (AI state machines, collision, levels, rendering)
- `faces.js` — the hider and seeker face sprites as base64 constants

## Deploy to Vercel

**Option A — drag and drop (fastest):**
1. Go to https://vercel.com/new
2. Drag this whole folder onto the page
3. Deploy. Done — it's a static site, no build step needed.

**Option B — CLI:**
```bash
npm i -g vercel
cd hide-and-seek
vercel --prod
```

**Option C — GitHub:**
Push this folder to a repo, then import it at vercel.com/new. Framework preset: "Other". No build command, output directory: `./`.



## Procedural arenas (v4)

Every 3 levels (`epoch = floor((level-1)/3)`) the map regenerates: 5-7 bushes, 4-6 walls, 8 seeker spawns with random patrol routes. Generation is validated — minimum spacing, a clear zone around the player spawn, and a flood-fill connectivity check guaranteeing every bush and spawn is reachable. Invalid rolls are re-salted and retried (60 attempts, then a handcrafted fallback).

Maps are **seeded and deterministic**: `MAP_SEED_BASE` (default 1986) + epoch produces the same arena for every player, so level 7 is the same level 7 worldwide — a requirement for fair leaderboards later. Change `MAP_SEED_BASE` to rotate in a whole new set of arenas.

Levels are 30 seconds each (`LEVEL_TIME`).

## Abilities (v3)

Hotkeys: Space / Q / E / R / F, or tap the hotbar. Locked slots show the level they unlock at (LVL 4 = unlocks at level 4). One new move unlocks every 2 levels:

| Ability | Key | Unlocks | CD | Effect |
|---|---|---|---|---|
| Sprint | Space | L2 | 6s | 1.5x speed for 2s |
| Blink | Q | L4 | 10s | Teleport 160px in facing direction, through walls |
| Decoy | E | L6 | 15s | Hologram bots chase for 4s; pops when they reach it |
| Frost Nova | R | L8 | 18s | Freeze all bots within 170px for 2.5s |
| Stun Bolt | F | L10 | 12s | Skillshot projectile; first bot hit stunned 3s |

Frozen/stunned bots are harmless statues — you can walk right past (or through) them. Aim for blink/bolt is your facing direction, shown by the small dot orbiting your character. Tuning constants are at the top of `game.js` (NOVA_RADIUS, BLINK_DIST, SPRINT_MULT, etc.).

## Modding guide (the fun part)

All the knobs live at the top of `game.js`:

- `bushes` / `walls` — level layout (960x600 map). Add rectangles to redesign it. `buildGrid()` rebuilds the pathfinding grid automatically from `walls`.
- `spawns` — seeker start points and patrol routes (8 = seeker cap).
- In `startLevel()`: `125 + level*4` and `195 + level*4` control bot patrol/chase speed scaling.
- In `canSee()`: `90` is the in-bush detection bubble, `220` is open-field vision range, `1.1` is the vision cone half-angle in radians.
- In `bushSlow()`: `0.65` is how much hedges slow everyone down.
- Investigation cadence: `investT = 3 + rnd*4` (first sweep) and `5 + rnd*5` (between sweeps). Lower = bushes get checked more aggressively.

The AI is a four-state machine per bot: `patrol` → `chase` (on sight) → `search` (lost sight, checks your last known hedge) → `investigate` (periodic sweep of the stalest unchecked bush) → back to `patrol`. Bots share a `bushChecked` timestamp board and always sweep the least-recently-checked bush, skipping ones a teammate is already heading to — so no bush is safe forever. Bots navigate with A* on a 20px grid (`astar()`), with a stuck detector as a backstop.

## Swapping the face sprites

Replace the base64 strings in `faces.js` with your own. Any square image works — encode it:
```bash
base64 -i yourface.jpg
```
Keep images small (~96x96px, JPEG) so the page stays fast.
