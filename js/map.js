// Map: collision, pathfinding grid, A*, procedural maze generation.
function inRect(px, py, r, pad) {
  pad = pad || 0;
  return px > r.x - pad && px < r.x + r.w + pad && py > r.y - pad && py < r.y + r.h + pad;
}
function hitWall(x, y, r) { return walls.some(w => inRect(x, y, w, r)); }

// ---------- Pathfinding grid ----------
const CELL = 20, COLS = W / CELL, ROWS = H / CELL;
const grid = new Uint8Array(COLS * ROWS);
function buildGrid() {
  grid.fill(0);
  const pad = 12;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c*CELL + CELL/2, y = r*CELL + CELL/2;
      for (const w of walls) {
        if (x > w.x-pad && x < w.x+w.w+pad && y > w.y-pad && y < w.y+w.h+pad) {
          grid[r*COLS + c] = 1; break;
        }
      }
    }
  }
}

const cellOf = (x, y) => ({
  c: Math.max(0, Math.min(COLS-1, Math.floor(x / CELL))),
  r: Math.max(0, Math.min(ROWS-1, Math.floor(y / CELL)))
});
const centerOf = (c, r) => ({x: c*CELL + CELL/2, y: r*CELL + CELL/2});

function astar(sx, sy, tx, ty) {
  const s = cellOf(sx, sy), t = cellOf(tx, ty);
  let ti = t.r*COLS + t.c;
  if (grid[ti]) {
    let found = false;
    for (let rad = 1; rad < 5 && !found; rad++) {
      for (let dr = -rad; dr <= rad && !found; dr++) {
        for (let dc = -rad; dc <= rad && !found; dc++) {
          const rr = t.r+dr, cc = t.c+dc;
          if (rr>=0 && rr<ROWS && cc>=0 && cc<COLS && !grid[rr*COLS+cc]) {
            t.r = rr; t.c = cc; ti = rr*COLS+cc; found = true;
          }
        }
      }
    }
    if (!found) return null;
  }
  const si = s.r*COLS + s.c;
  if (si === ti) return [{x:tx, y:ty}];

  const open = [si];
  const came = new Map(), g = new Map([[si, 0]]);
  const f = new Map([[si, 0]]);
  const inOpen = new Set([si]);
  const h = (i) => {
    const c = i % COLS, r = (i - c) / COLS;
    return (Math.abs(c - t.c) + Math.abs(r - t.r)) * 10;
  };
  let iter = 0;
  while (open.length && iter++ < 3000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if ((f.get(open[i])||0) < (f.get(open[bi])||0)) bi = i;
    const cur = open.splice(bi, 1)[0];
    inOpen.delete(cur);
    if (cur === ti) {
      const cells = [cur];
      let k = cur;
      while (came.has(k)) { k = came.get(k); cells.push(k); }
      cells.reverse();
      const pts = cells.map(i => centerOf(i % COLS, Math.floor(i / COLS)));
      pts[0] = {x: sx, y: sy};
      pts.push({x:tx, y:ty});
      const sm = smooth(pts);
      sm.shift();
      return sm.length ? sm : [{x:tx, y:ty}];
    }
    const cc = cur % COLS, cr = (cur - cc) / COLS;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = cr+dr, nc = cc+dc;
      if (nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
      const ni = nr*COLS + nc;
      if (grid[ni]) continue;
      if (dr && dc && (grid[cr*COLS + nc] || grid[nr*COLS + cc])) continue;
      const cost = (dr && dc) ? 14 : 10;
      const ng = (g.get(cur)||0) + cost;
      if (ng < (g.get(ni) ?? Infinity)) {
        came.set(ni, cur); g.set(ni, ng); f.set(ni, ng + h(ni));
        if (!inOpen.has(ni)) { open.push(ni); inOpen.add(ni); }
      }
    }
  }
  return null;
}
function smooth(pts) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && wallBlocked(pts[i].x, pts[i].y, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]); i = j;
  }
  return out;
}
function wallBlocked(x1, y1, x2, y2) {
  const steps = Math.max(8, Math.floor(Math.hypot(x2-x1, y2-y1) / 12));
  for (let i = 1; i < steps; i++) {
    const s = i/steps, x = x1+(x2-x1)*s, y = y1+(y2-y1)*s;
    for (const w of walls) if (inRect(x, y, w, 10)) return true;
  }
  return false;
}

// ---------- Level geometry (procedurally generated every 3 levels) ----------
const PLAYER_SPAWN = {x:50, y:300};
const MAP_SEED_BASE = 1986; // change this and everyone gets a fresh map rotation
let bushes = [], walls = [], spawns = [], pois = [], poiChecked = [];
let currentEpoch = -1;

// Deterministic PRNG: same seed -> same map for every player (leaderboard-fair)
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let x = Math.imul(a ^ a >>> 15, 1 | a);
    x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}
function rectsOverlap(a, b, pad) {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x &&
         a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}
const FALLBACK_MAP = {
  bushes: [
    {x:100,y:80,w:110,h:70},{x:620,y:70,w:120,h:80},{x:380,y:220,w:100,h:70},
    {x:150,y:380,w:110,h:80},{x:700,y:420,w:120,h:80},{x:420,y:470,w:100,h:70},
    {x:820,y:220,w:100,h:70}
  ],
  walls: [
    {x:300,y:60,w:24,h:130},{x:560,y:380,w:24,h:140},{x:80,y:250,w:120,h:20},
    {x:680,y:180,w:120,h:20},{x:460,y:90,w:24,h:110},{x:250,y:480,w:140,h:20}
  ]
};

// Flood fill over the wall grid from the player spawn; returns reachability set
function reachableFrom(x, y) {
  const seen = new Uint8Array(COLS * ROWS);
  const start = cellOf(x, y);
  const q = [start.r * COLS + start.c];
  if (grid[q[0]]) return seen;
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), c = i % COLS, r = (i - c) / COLS;
    const nbrs = [i-1, i+1, i-COLS, i+COLS];
    if (c === 0) nbrs[0] = -1;
    if (c === COLS-1) nbrs[1] = -1;
    for (const n of nbrs) {
      if (n >= 0 && n < seen.length && !seen[n] && !grid[n]) { seen[n] = 1; q.push(n); }
    }
  }
  return seen;
}
const cellReachable = (seen, x, y) => { const c = cellOf(x, y); return !!seen[c.r*COLS + c.c]; };

function generateMap(epoch) {
  for (let salt = 0; salt < 60; salt++) {
    const rnd = mulberry32(MAP_SEED_BASE + epoch * 1009 + salt * 7919);
    const newWalls = [], newBushes = [];

    // Maze walls: lattice-snapped bars generated on the LEFT half and mirrored
    // to the right (Pac-Man symmetry), plus 1-2 unmirrored center pieces.
    const snap = v => Math.round(v / 40) * 40;
    const spawnZone = {x:PLAYER_SPAWN.x-90, y:PLAYER_SPAWN.y-90, w:180, h:180};
    const mirrorZone = {x:W-PLAYER_SPAWN.x-90, y:PLAYER_SPAWN.y-90, w:180, h:180};
    const nSide = 5 + Math.floor(rnd() * 3); // 5-7 per side -> 10-14 mirrored
    for (let tries = 0; newWalls.length < nSide * 2 && tries < 400; tries++) {
      const vert = rnd() < 0.5;
      const len = [120, 160, 200][Math.floor(rnd() * 3)];
      const wall = vert ? {w: 22, h: len} : {w: len, h: 22};
      wall.x = snap(50 + rnd() * (W/2 - 110 - wall.w));
      wall.y = snap(50 + rnd() * (H - 100 - wall.h));
      const mir = {x: W - wall.x - wall.w, y: wall.y, w: wall.w, h: wall.h};
      if (rectsOverlap(wall, spawnZone, 0) || rectsOverlap(mir, mirrorZone, 0)) continue;
      // Corridor guarantee: min 56px between wall pairs (grid pad 12 + bot fits)
      if (newWalls.some(o => rectsOverlap(wall, o, 56) || rectsOverlap(mir, o, 56))) continue;
      if (rectsOverlap(wall, mir, 56)) continue; // near-center walls colliding with own mirror
      newWalls.push(wall, mir);
    }
    // Center pieces: 1-2 unmirrored, straddling the middle (freestyle touch)
    const nCenter = 1 + Math.floor(rnd() * 2);
    for (let tries = 0, placed = 0; placed < nCenter && tries < 100; tries++) {
      const vert = rnd() < 0.6;
      const len = [120, 160][Math.floor(rnd() * 2)];
      const wall = vert ? {w: 22, h: len} : {w: len, h: 22};
      wall.x = snap(W/2 - wall.w/2 + (rnd() - 0.5) * 120);
      wall.y = snap(60 + rnd() * (H - 120 - wall.h));
      if (rectsOverlap(wall, spawnZone, 0)) continue;
      if (newWalls.some(o => rectsOverlap(wall, o, 56))) continue;
      newWalls.push(wall); placed++;
    }
    if (newWalls.length < 10) continue;

    // Bushes: 5-7 hedges
    const nB = 5 + Math.floor(rnd() * 3);
    for (let tries = 0; newBushes.length < nB && tries < 300; tries++) {
      const b = {
        w: 90 + Math.floor(rnd()*45), h: 60 + Math.floor(rnd()*30)
      };
      b.x = 45 + Math.floor(rnd() * (W - 90 - b.w));
      b.y = 45 + Math.floor(rnd() * (H - 90 - b.h));
      const nearSpawn = rectsOverlap(b, {x:PLAYER_SPAWN.x-100, y:PLAYER_SPAWN.y-100, w:200, h:200}, 0);
      if (nearSpawn) continue;
      if (newWalls.some(o => rectsOverlap(b, o, 24))) continue;
      if (newBushes.some(o => rectsOverlap(b, o, 36))) continue;
      newBushes.push(b);
    }
    if (newBushes.length < 5) continue;

    // Commit tentatively and validate connectivity + openness
    walls = newWalls; bushes = newBushes;
    buildGrid();
    const seen = reachableFrom(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
    if (!bushes.every(b => cellReachable(seen, b.x + b.w/2, b.y + b.h/2))) continue;
    // Maze must stay navigable: >=55% of all cells reachable from spawn
    let reach = 0;
    for (let i = 0; i < seen.length; i++) reach += seen[i];
    if (reach / seen.length < 0.55) continue;
    // Corners must be reachable (they join the sweep rotation)
    const corners = [
      {x:55,y:55},{x:W-55,y:55},{x:55,y:H-55},{x:W-55,y:H-55},
      {x:W/2,y:55},{x:W/2,y:H-55},{x:55,y:H/2},{x:W-55,y:H/2}
    ];
    if (!corners.every(c => cellReachable(seen, c.x, c.y))) continue;

    // Seeker spawns: 12 open, reachable points far from the player
    const newSpawns = [];
    for (let tries = 0; newSpawns.length < 12 && tries < 700; tries++) {
      const p = {x: 40 + rnd() * (W - 80), y: 40 + rnd() * (H - 80)};
      if (hitWall(p.x, p.y, 20)) continue;
      if (!cellReachable(seen, p.x, p.y)) continue;
      if (Math.hypot(p.x - PLAYER_SPAWN.x, p.y - PLAYER_SPAWN.y) < 280) continue;
      if (newSpawns.some(o => Math.hypot(p.x - o.x, p.y - o.y) < 110)) continue;
      // Patrol route: 3 reachable open waypoints spread around
      const route = [{x:p.x, y:p.y}];
      for (let wpt = 0; wpt < 2 && route.length < 3; ) {
        const q = {x: 40 + rnd() * (W - 80), y: 40 + rnd() * (H - 80)};
        wpt++;
        if (hitWall(q.x, q.y, 20) || !cellReachable(seen, q.x, q.y)) continue;
        if (Math.hypot(q.x - route[route.length-1].x, q.y - route[route.length-1].y) < 160) continue;
        route.push(q);
      }
      while (route.length < 3) route.push({x: W/2 + (rnd()-0.5)*200, y: H/2 + (rnd()-0.5)*160});
      newSpawns.push({x:p.x, y:p.y, route});
    }
    if (newSpawns.length < 12) continue;

    spawns = newSpawns;
    pois = bushes.map(b => ({x: b.x + b.w/2, y: b.y + b.h/2, bush: true}))
                 .concat(corners.map(c => ({x: c.x, y: c.y, bush: false})));
    poiChecked = pois.map(p => p.bush ? -999 : -1400);
    return true;
  }
  // All attempts failed (shouldn't happen): fall back to the handcrafted map
  walls = FALLBACK_MAP.walls.map(w => ({...w}));
  bushes = FALLBACK_MAP.bushes.map(b => ({...b}));
  buildGrid();
  const seen = reachableFrom(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
  spawns = [];
  const rnd = mulberry32(1);
  while (spawns.length < 12) {
    const p = {x: 40 + rnd() * (W - 80), y: 40 + rnd() * (H - 80)};
    if (hitWall(p.x, p.y, 20) || !cellReachable(seen, p.x, p.y)) continue;
    if (Math.hypot(p.x - PLAYER_SPAWN.x, p.y - PLAYER_SPAWN.y) < 280) continue;
    spawns.push({x:p.x, y:p.y, route:[{x:p.x,y:p.y},{x:W/2,y:60},{x:W/2,y:H-60}]});
  }
  pois = bushes.map(b => ({x: b.x + b.w/2, y: b.y + b.h/2, bush: true}))
               .concat([
                 {x:55,y:55},{x:W-55,y:55},{x:55,y:H-55},{x:W-55,y:H-55},
                 {x:W/2,y:55},{x:W/2,y:H-55},{x:55,y:H/2},{x:W-55,y:H/2}
               ].map(c => ({x:c.x, y:c.y, bush:false})));
  poiChecked = pois.map(p => p.bush ? -999 : -1400);
  return false;
}

