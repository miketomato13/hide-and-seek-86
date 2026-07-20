# Hide + Seek '86

A 1980s arcade hide-and-seek game with AI seeker agents. Survive 30 seconds per level. Every level cleared, another seeker-bot joins the hunt.

## Files

- `index.html` — page shell, styling, HUD, touch controls, leaderboard panel
- `js/config.js` — every tuning constant (abilities, powerups, timers)
- `js/map.js` — collision, pathfinding grid, A*, procedural maze generation
- `js/abilities.js` — abilities, powerups, and the per-frame update (player + seeker AI)
- `js/render.js` — all canvas drawing + the DOM hotbar
- `js/main.js` — entry point: state, game loop, input, leaderboard client
- `faces.js` — the hider and seeker face sprites as base64 constants
- `api/scores.js` — serverless leaderboard endpoint (Vercel KV)
- `package.json` — declares the `@vercel/kv` dependency

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

Every 3 levels (`epoch = floor((level-1)/3)`) the map regenerates as a Pac-Man-style maze: walls snap to a 40px lattice, generate on the left half and mirror to the right, plus 1-2 unmirrored center pieces (10-16 walls total). 5-7 bushes stay asymmetric, and 12 seeker spawns (the seeker cap) get random patrol routes. Generation is validated — 56px corridor minimums, a clear zone around the player spawn, a flood-fill connectivity check guaranteeing every bush/spawn/corner is reachable, and an openness floor (>=55% of cells reachable) so mazes never seal themselves off. Invalid rolls are re-salted and retried (60 attempts, then a handcrafted fallback).

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



## Anti-camping sweep (v6)

Bots sweep **points of interest**, not just bushes: every bush center plus the 4 corners and 4 edge midpoints join a shared staleness board. Bots always investigate the least-recently-checked POI (skipping ones a teammate claimed), corners start extra-stale so they're swept first each level, and sweep cadence scales inversely with squad size — 2 bots sweep twice as often per-bot as 8. Verified: 95-100% catch rate against camping in corners, edges, bushes, and random open ground within a single 30s level.

## Powerups (v5)

Mario Kart-style item crates spawn from level 1 — glowing "?" boxes, at most 2 on the field, each lasting 10 seconds (blinking before despawn). Walk over one to grab it. Four effects, equal odds:

| Powerup | Effect |
|---|---|
| CD RESET | All ability cooldowns wiped to zero |
| TIME FREEZE | Every bot frozen for 2s |
| -8 SEC | Cuts 8 seconds off the survival clock |
| CLOAK | Invisible for 3s, even in the open, even mid-chase |

Crate placement is validated against walls and reachability, and never spawns within 120px of you. Tuning constants: CRATE_LIFE, CRATE_MAX, FREEZE_TIME, CLOAK_TIME, CLOCK_CUT.


## Leaderboard (v7)

Arcade-style: get caught, enter 3 initials, score posts to a shared top-100 board (top 10 shown under the game). Score = total seconds survived across the run. No login, no personal data.

**Setup (one time):**
1. Vercel dashboard -> your project -> Storage -> Create Database -> **Upstash Redis (KV)**
2. Connect it to this project (this injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`)
3. Redeploy

Until KV is connected, the API answers `{offline: true}` and the game simply hides the leaderboard panel — everything else works. Note the honest caveat: like any client-side game, score submissions are technically spoofable; this board is for family and friends, not anti-cheat.

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
