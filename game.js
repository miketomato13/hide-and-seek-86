// Hide + Seek '86 — v3
// New in v3: ability system. Sprint (L2), Blink (L4), Decoy (L6),
// Frost Nova (L8), Stun Bolt (L10). Hotkeys: Space + 1/2/3/4, or tap the
// hotbar. Frozen/stunned bots are harmless statues until they recover.

const cv = document.getElementById('game'), cx = cv.getContext('2d');
const W = 960, H = 600;

// ---------- Abilities ----------
const ABILITIES = [
  {id:'sprint', name:'SPRINT', label:'SPC', unlock:2,  cd:6,  color:'#00e5ff'},
  {id:'blink',  name:'BLINK',  label:'Q',   unlock:4,  cd:10, color:'#8c1eff'},
  {id:'decoy',  name:'DECOY',  label:'E',   unlock:6,  cd:15, color:'#00ffa3'},
  {id:'nova',   name:'NOVA',   label:'R',   unlock:8,  cd:18, color:'#7fd4ff'},
  {id:'bolt',   name:'BOLT',   label:'F',   unlock:10, cd:12, color:'#ffd319'},
];
const NOVA_RADIUS = 170, NOVA_FREEZE = 2.5;
const BLINK_DIST = 160;
const DECOY_LIFE = 4, SPRINT_TIME = 2, SPRINT_MULT = 1.5;
const BOLT_SPEED = 460, BOLT_STUN = 3;
const LEVEL_TIME = 30;

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

// ---------- Level geometry (procedurally generated every 3 levels) ----------
const PLAYER_SPAWN = {x:50, y:300};
const MAP_SEED_BASE = 1986; // change this and everyone gets a fresh map rotation
let bushes = [], walls = [], spawns = [], bushChecked = [];
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

    // Walls: 4-6 bars, vertical or horizontal
    const nW = 4 + Math.floor(rnd() * 3);
    for (let tries = 0; newWalls.length < nW && tries < 200; tries++) {
      const vert = rnd() < 0.5;
      const w = vert ? {w: 22 + Math.floor(rnd()*5), h: 100 + Math.floor(rnd()*55)}
                     : {w: 100 + Math.floor(rnd()*65), h: 18 + Math.floor(rnd()*5)};
      w.x = 45 + Math.floor(rnd() * (W - 90 - w.w));
      w.y = 45 + Math.floor(rnd() * (H - 90 - w.h));
      const nearSpawn = rectsOverlap(w, {x:PLAYER_SPAWN.x-90, y:PLAYER_SPAWN.y-90, w:180, h:180}, 0);
      if (nearSpawn) continue;
      if (newWalls.some(o => rectsOverlap(w, o, 34))) continue;
      newWalls.push(w);
    }
    if (newWalls.length < 4) continue;

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
      if (newWalls.some(o => rectsOverlap(b, o, 26))) continue;
      if (newBushes.some(o => rectsOverlap(b, o, 36))) continue;
      newBushes.push(b);
    }
    if (newBushes.length < 5) continue;

    // Commit tentatively and validate connectivity
    walls = newWalls; bushes = newBushes;
    buildGrid();
    const seen = reachableFrom(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
    if (!bushes.every(b => cellReachable(seen, b.x + b.w/2, b.y + b.h/2))) continue;

    // Seeker spawns: 8 open, reachable points far from the player
    const newSpawns = [];
    for (let tries = 0; newSpawns.length < 8 && tries < 500; tries++) {
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
    if (newSpawns.length < 8) continue;

    spawns = newSpawns;
    bushChecked = bushes.map(() => -999);
    return true;
  }
  // All attempts failed (shouldn't happen): fall back to the handcrafted map
  walls = FALLBACK_MAP.walls.map(w => ({...w}));
  bushes = FALLBACK_MAP.bushes.map(b => ({...b}));
  buildGrid();
  const seen = reachableFrom(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
  spawns = [];
  const rnd = mulberry32(1);
  while (spawns.length < 8) {
    const p = {x: 40 + rnd() * (W - 80), y: 40 + rnd() * (H - 80)};
    if (hitWall(p.x, p.y, 20) || !cellReachable(seen, p.x, p.y)) continue;
    if (Math.hypot(p.x - PLAYER_SPAWN.x, p.y - PLAYER_SPAWN.y) < 280) continue;
    spawns.push({x:p.x, y:p.y, route:[{x:p.x,y:p.y},{x:W/2,y:60},{x:W/2,y:H-60}]});
  }
  bushChecked = bushes.map(() => -999);
  return false;
}

// ---------- Face sprites ----------
const hiderImg = new Image(), seekerImg = new Image();
hiderImg.src = 'data:image/jpeg;base64,' + HIDER_B64;
seekerImg.src = 'data:image/jpeg;base64,' + SEEKER_B64;

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

// ---------- State ----------
let player, seekers, keys = {}, timeLeft, over, win, last, t = 0;
let level = 1, clearT = 0, started = false;
let cds = {}, sprintT = 0, decoy = {x:0, y:0, t:0}, bolt = null;
let novaFx = null, blinkFx = null, toastMsg = '', toastT = 0;
const $ = id => document.getElementById(id);

function unlocked(a) { return level >= a.unlock; }

function startLevel() {
  const epoch = Math.floor((level - 1) / 3);
  const newArena = epoch !== currentEpoch;
  if (newArena) { currentEpoch = epoch; generateMap(epoch); }
  player = {x:PLAYER_SPAWN.x, y:PLAYER_SPAWN.y, r:15, speed:180, fx:1, fy:0};
  seekers = [];
  const n = Math.min(1 + level, spawns.length);
  for (let i = 0; i < n; i++) {
    const sp = spawns[i];
    seekers.push({
      x:sp.x, y:sp.y, r:16,
      speed: 125 + level*4, chaseSpeed: 195 + level*4,
      route: sp.route, wp: 0, state: 'patrol',
      lastSeen: null, searchT: 0, dir: 0,
      path: null, pathGoal: null, repathT: 0,
      investT: 3 + Math.random()*4, targetBush: -1, lingerT: 0,
      frozenT: 0, stunT: 0, quarry: 'player',
      px: sp.x, py: sp.y, stuck: 0
    });
  }
  bushChecked = bushes.map(() => -999);
  sprintT = 0; decoy.t = 0; bolt = null; novaFx = null; blinkFx = null;
  timeLeft = LEVEL_TIME; over = false; win = false; clearT = 0;
  last = performance.now();
  $('level').textContent = 'LEVEL ' + level;
  $('statusMsg').textContent = n + ' SEEKER-BOTS \u00b7 SURVIVE 30 SEC';
  const newAb = ABILITIES.find(a => a.unlock === level);
  const parts = [];
  if (newArena && level > 1) parts.push('NEW ARENA');
  if (newAb) parts.push('NEW ABILITY: ' + newAb.name + ' [' + newAb.label + ']');
  if (parts.length) { toastMsg = parts.join(' \u00b7 '); toastT = 3.5; }
  renderHotbar();
}
function fullReset() {
  level = 1; started = true; currentEpoch = -1;
  for (const a of ABILITIES) cds[a.id] = 0;
  startLevel();
}

// ---------- Helpers ----------
function whichBush(px, py) {
  for (let i = 0; i < bushes.length; i++) if (inRect(px, py, bushes[i])) return i;
  return -1;
}
function sightBlocked(x1, y1, x2, y2) {
  const steps = 24;
  for (let i = 1; i < steps; i++) {
    const s = i/steps, x = x1+(x2-x1)*s, y = y1+(y2-y1)*s;
    for (const w of walls) if (inRect(x, y, w)) return true;
    for (const b of bushes) if (inRect(x, y, b)) return true;
  }
  return false;
}

// Generic perception check against any point (player or decoy)
function canSeePoint(s, px, py) {
  const pB = whichBush(px, py), sB = whichBush(s.x, s.y);
  const dx = px - s.x, dy = py - s.y, d = Math.hypot(dx, dy);
  if (pB >= 0) return sB === pB && d < 90;
  if (d > 220) return false;
  const ang = Math.atan2(dy, dx);
  let diff = Math.abs(ang - s.dir);
  if (diff > Math.PI) diff = 2*Math.PI - diff;
  if (diff > 1.1) return false;
  return !sightBlocked(s.x, s.y, px, py);
}
function bushSlow(o) { return whichBush(o.x, o.y) >= 0 ? 0.65 : 1; }

function stepToward(o, tx, ty, sp, dt) {
  const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy);
  if (d < 6) return true;
  o.dir = Math.atan2(dy, dx);
  sp *= bushSlow(o);
  const step = sp*dt, mx = dx/d*step, my = dy/d*step;
  let nx = o.x + mx, ny = o.y + my;
  const hX = hitWall(nx, o.y, o.r), hY = hitWall(o.x, ny, o.r);
  if (hX && hY) {
    nx = o.x - my*1.2; ny = o.y + mx*1.2;
    if (hitWall(nx, ny, o.r)) { nx = o.x + my*1.2; ny = o.y - mx*1.2; }
    if (hitWall(nx, ny, o.r)) { nx = o.x; ny = o.y; }
  } else {
    if (hX) nx = o.x;
    if (hY) ny = o.y;
  }
  o.x = Math.max(o.r, Math.min(W - o.r, nx));
  o.y = Math.max(o.r, Math.min(H - o.r, ny));
  return false;
}
function navigate(s, tx, ty, sp, dt) {
  const goalMoved = !s.pathGoal || Math.hypot(s.pathGoal.x - tx, s.pathGoal.y - ty) > 30;
  s.repathT -= dt;
  if (!s.path || goalMoved || s.repathT <= 0) {
    s.path = astar(s.x, s.y, tx, ty);
    s.pathGoal = {x:tx, y:ty};
    s.repathT = 0.6;
  }
  if (!s.path || !s.path.length) return stepToward(s, tx, ty, sp, dt);
  const node = s.path[0];
  if (stepToward(s, node.x, node.y, sp, dt)) {
    s.path.shift();
    if (!s.path.length) return Math.hypot(s.x - tx, s.y - ty) < 12;
  }
  return Math.hypot(s.x - tx, s.y - ty) < 12;
}
function pickStaleBush(self) {
  const claimed = new Set();
  for (const o of seekers) if (o !== self && o.state === 'investigate') claimed.add(o.targetBush);
  let best = -1, bestAge = -1;
  for (let i = 0; i < bushes.length; i++) {
    if (claimed.has(i)) continue;
    const age = (t - bushChecked[i]) + Math.random() * 0.5;
    if (age > bestAge) { bestAge = age; best = i; }
  }
  return best >= 0 ? best : Math.floor(Math.random() * bushes.length);
}
const bushCenter = i => ({x: bushes[i].x + bushes[i].w/2, y: bushes[i].y + bushes[i].h/2});
function sp0(s) { return s.state === 'chase' ? s.chaseSpeed : s.speed; }

// ---------- Ability activation ----------
function useAbility(id) {
  if (!started || over) return;
  const a = ABILITIES.find(x => x.id === id);
  if (!a || !unlocked(a) || cds[id] > 0) return;

  if (id === 'sprint') {
    sprintT = SPRINT_TIME;
  } else if (id === 'blink') {
    // Teleport in facing direction; passes through walls; shrink until landing
    // spot is clear. If we can't move at least 50px, don't fire (no cd burn).
    let placed = false;
    for (let d = BLINK_DIST; d >= 40 && !placed; d -= 10) {
      const nx = Math.max(player.r, Math.min(W - player.r, player.x + player.fx * d));
      const ny = Math.max(player.r, Math.min(H - player.r, player.y + player.fy * d));
      if (!hitWall(nx, ny, player.r) && Math.hypot(nx - player.x, ny - player.y) >= 50) {
        blinkFx = {x1:player.x, y1:player.y, x2:nx, y2:ny, t:0.3};
        player.x = nx; player.y = ny; placed = true;
      }
    }
    if (!placed) return;
  } else if (id === 'decoy') {
    decoy.x = player.x; decoy.y = player.y; decoy.t = DECOY_LIFE;
  } else if (id === 'nova') {
    novaFx = {x:player.x, y:player.y, t:0.5};
    for (const s of seekers) {
      if (Math.hypot(s.x - player.x, s.y - player.y) < NOVA_RADIUS) {
        s.frozenT = NOVA_FREEZE; s.path = null;
      }
    }
  } else if (id === 'bolt') {
    bolt = {x:player.x, y:player.y, vx:player.fx * BOLT_SPEED, vy:player.fy * BOLT_SPEED, trail:[]};
  }
  cds[id] = a.cd;
}

// ---------- Update ----------
function update(dt) {
  if (!started) return;
  for (const a of ABILITIES) if (cds[a.id] > 0) cds[a.id] = Math.max(0, cds[a.id] - dt);
  if (toastT > 0) toastT -= dt;
  if (over) {
    if (win) { clearT += dt; if (clearT > 2.2) { level++; startLevel(); } }
    return;
  }
  timeLeft -= dt;
  if (timeLeft <= 0) {
    over = true; win = true;
    $('statusMsg').textContent = 'LEVEL CLEAR \u00b7 NEW BOT INCOMING';
    return;
  }

  // Timers
  if (sprintT > 0) sprintT -= dt;
  if (decoy.t > 0) decoy.t -= dt;
  if (novaFx && (novaFx.t -= dt) <= 0) novaFx = null;
  if (blinkFx && (blinkFx.t -= dt) <= 0) blinkFx = null;

  // Bolt physics
  if (bolt) {
    bolt.trail.push({x:bolt.x, y:bolt.y});
    if (bolt.trail.length > 8) bolt.trail.shift();
    bolt.x += bolt.vx * dt; bolt.y += bolt.vy * dt;
    if (bolt.x < 0 || bolt.x > W || bolt.y < 0 || bolt.y > H || hitWall(bolt.x, bolt.y, 4)) {
      bolt = null;
    } else {
      for (const s of seekers) {
        if (Math.hypot(s.x - bolt.x, s.y - bolt.y) < s.r + 7) {
          s.stunT = BOLT_STUN; s.path = null; bolt = null; break;
        }
      }
    }
  }

  // Player input
  let vx = 0, vy = 0;
  if (keys.ArrowLeft || keys.a || keys.left) vx -= 1;
  if (keys.ArrowRight || keys.d || keys.right) vx += 1;
  if (keys.ArrowUp || keys.w || keys.up) vy -= 1;
  if (keys.ArrowDown || keys.s || keys.down) vy += 1;
  if (vx || vy) {
    const m = Math.hypot(vx, vy);
    player.fx = vx / m; player.fy = vy / m; // facing for blink/bolt aim
    const sp = player.speed * bushSlow(player) * (sprintT > 0 ? SPRINT_MULT : 1);
    let nx = player.x + vx/m*sp*dt, ny = player.y + vy/m*sp*dt;
    if (hitWall(nx, player.y, player.r)) nx = player.x;
    if (hitWall(player.x, ny, player.r)) ny = player.y;
    player.x = Math.max(player.r, Math.min(W - player.r, nx));
    player.y = Math.max(player.r, Math.min(H - player.r, ny));
  }

  // Seeker agents
  for (const s of seekers) {
    // Frozen/stunned bots are harmless statues: no perception, no movement, no catching
    if (s.frozenT > 0) { s.frozenT -= dt; continue; }
    if (s.stunT > 0) { s.stunT -= dt; continue; }

    const sB = whichBush(s.x, s.y);
    if (sB >= 0) bushChecked[sB] = t;

    const moved = Math.hypot(s.x - s.px, s.y - s.py);
    s.stuck = moved < sp0(s)*dt*0.15 ? s.stuck + dt : 0;
    s.px = s.x; s.py = s.y;
    if (s.stuck > 0.8) {
      s.stuck = 0; s.path = null; s.pathGoal = null;
      if (s.state === 'patrol') s.wp = (s.wp + 1) % s.route.length;
      else { s.state = 'patrol'; s.investT = Math.max(s.investT, 1.5); }
      const ux = W/2 - s.x, uy = H/2 - s.y, ud = Math.hypot(ux, uy) || 1;
      const nx = s.x + ux/ud*24, ny = s.y + uy/ud*24;
      if (!hitWall(nx, ny, s.r)) { s.x = nx; s.y = ny; }
    }

    // Perception: decoy takes priority — that's the whole point of a decoy
    const seesDecoy = decoy.t > 0 && canSeePoint(s, decoy.x, decoy.y);
    const seesPlayer = canSeePoint(s, player.x, player.y);
    if (seesDecoy) { s.state = 'chase'; s.quarry = 'decoy'; s.lastSeen = {x:decoy.x, y:decoy.y}; }
    else if (seesPlayer) { s.state = 'chase'; s.quarry = 'player'; s.lastSeen = {x:player.x, y:player.y}; }

    if (s.state === 'chase') {
      let tx, ty, visible;
      if (s.quarry === 'decoy' && decoy.t > 0) {
        tx = decoy.x; ty = decoy.y; visible = seesDecoy;
        // Bot reaches the decoy: it pops, bot is confused, searches the area
        if (Math.hypot(s.x - tx, s.y - ty) < s.r + 14) {
          decoy.t = 0;
          s.state = 'search'; s.searchT = 3; s.path = null;
          s.target = {x:tx, y:ty}; s.quarry = 'player';
          continue;
        }
      } else {
        s.quarry = 'player';
        tx = player.x; ty = player.y; visible = seesPlayer;
      }
      if (visible) {
        if (!wallBlocked(s.x, s.y, tx, ty)) stepToward(s, tx, ty, s.chaseSpeed, dt);
        else navigate(s, tx, ty, s.chaseSpeed, dt);
      } else {
        s.state = 'search'; s.searchT = 4; s.path = null; s.quarry = 'player';
        const bi = whichBush(s.lastSeen.x, s.lastSeen.y);
        s.target = bi >= 0 ? bushCenter(bi) : {x:s.lastSeen.x, y:s.lastSeen.y};
      }
    } else if (s.state === 'search') {
      const arrived = navigate(s, s.target.x, s.target.y, s.speed, dt);
      if (arrived) { s.searchT -= dt; s.dir += dt*2.5; if (s.searchT <= 0) { s.state = 'patrol'; s.path = null; } }
    } else if (s.state === 'investigate') {
      const c = bushCenter(s.targetBush);
      const arrived = navigate(s, c.x, c.y, s.speed, dt);
      if (arrived) {
        s.lingerT -= dt; s.dir += dt*2.5;
        bushChecked[s.targetBush] = t;
        if (s.lingerT <= 0) { s.state = 'patrol'; s.path = null; s.investT = 5 + Math.random()*5; }
      }
    } else {
      s.investT -= dt;
      if (s.investT <= 0) {
        s.state = 'investigate';
        s.targetBush = pickStaleBush(s);
        s.lingerT = 1.3; s.path = null;
      } else {
        const tp = s.route[s.wp];
        if (navigate(s, tp.x, tp.y, s.speed, dt)) s.wp = (s.wp + 1) % s.route.length;
      }
    }

    if (Math.hypot(s.x - player.x, s.y - player.y) < s.r + player.r) {
      over = true; win = false;
      $('statusMsg').textContent = 'CAUGHT \u00b7 GAME OVER \u00b7 INSERT COIN';
    }
  }
}

// ---------- Hotbar (DOM) ----------
function renderHotbar() {
  const bar = $('abilityBar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const a of ABILITIES) {
    const slot = document.createElement('button');
    slot.className = 'slot';
    slot.dataset.ab = a.id;
    slot.innerHTML = '<span class="k">' + a.label + '</span><span class="n">' + a.name + '</span>' +
      '<span class="cdov"></span><span class="lock"></span>';
    slot.addEventListener('pointerdown', e => { e.preventDefault(); useAbility(a.id); });
    bar.appendChild(slot);
  }
}
function updateHotbar() {
  const bar = $('abilityBar');
  if (!bar) return;
  let i = 0;
  for (const slot of bar.children) {
    const a = ABILITIES[i++];
    const cdov = slot.querySelector('.cdov'), lock = slot.querySelector('.lock');
    if (!unlocked(a)) {
      slot.classList.add('locked');
      lock.textContent = 'LVL ' + a.unlock;
      cdov.style.height = '0%';
    } else {
      slot.classList.remove('locked');
      lock.textContent = '';
      const frac = cds[a.id] / a.cd;
      cdov.style.height = (frac * 100).toFixed(0) + '%';
      slot.style.borderColor = frac > 0 ? '#3a2a5c' : a.color;
      slot.style.color = frac > 0 ? '#5d4a8a' : a.color;
    }
  }
}

// ---------- Draw ----------
function drawGrid() {
  cx.strokeStyle = 'rgba(140,30,255,0.35)'; cx.lineWidth = 1;
  for (let i = 0; i <= 18; i++) {
    const y = Math.pow(i/18, 1.6) * H;
    cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke();
  }
  for (let x = -W; x <= 2*W; x += 100) {
    cx.beginPath(); cx.moveTo(x, H); cx.lineTo(W/2 + (x - W/2)*0.25, 0); cx.stroke();
  }
}
function neonRect(b, color, fill) {
  cx.save(); cx.shadowColor = color; cx.shadowBlur = 12;
  cx.strokeStyle = color; cx.lineWidth = 2; cx.fillStyle = fill;
  cx.beginPath(); cx.roundRect(b.x, b.y, b.w, b.h, 10); cx.fill(); cx.stroke();
  cx.restore();
}
function drawFace(img, x, y, r, ring, alpha) {
  cx.save(); cx.globalAlpha = alpha;
  cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.clip();
  if (img.complete && img.naturalWidth) cx.drawImage(img, x - r, y - r, r*2, r*2);
  else { cx.fillStyle = ring; cx.fillRect(x - r, y - r, r*2, r*2); }
  cx.restore();
  cx.save(); cx.globalAlpha = alpha; cx.shadowColor = ring; cx.shadowBlur = 12;
  cx.strokeStyle = ring; cx.lineWidth = 3;
  cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.stroke(); cx.restore();
}
function draw() {
  cx.fillStyle = '#12081f'; cx.fillRect(0, 0, W, H);
  drawGrid();
  for (const w of walls) {
    cx.save(); cx.shadowColor = '#00ffa3'; cx.shadowBlur = 10;
    cx.strokeStyle = '#00ffa3'; cx.lineWidth = 2; cx.fillStyle = 'rgba(0,255,163,0.12)';
    cx.fillRect(w.x, w.y, w.w, w.h); cx.strokeRect(w.x, w.y, w.w, w.h); cx.restore();
  }
  for (const b of bushes) neonRect(b, '#8c1eff', 'rgba(140,30,255,0.15)');

  if (!started) {
    cx.save(); cx.textAlign = 'center';
    cx.font = 'bold 40px monospace';
    cx.shadowBlur = 16; cx.shadowColor = '#ff2975'; cx.fillStyle = '#ff2975';
    cx.fillText("HIDE + SEEK '86", W/2, H/2 - 24);
    cx.font = '18px monospace';
    if (Math.floor(t*2) % 2 === 0) {
      cx.shadowColor = '#00e5ff'; cx.fillStyle = '#00e5ff';
      cx.fillText('PRESS INSERT COIN TO START', W/2, H/2 + 28);
    }
    cx.restore();
    return;
  }

  // Vision cones / bush bubbles
  for (const s of seekers) {
    if (s.frozenT > 0 || s.stunT > 0) continue; // disabled bots see nothing
    const sB = whichBush(s.x, s.y);
    if (sB >= 0) {
      cx.fillStyle = 'rgba(255,211,25,0.15)';
      cx.beginPath(); cx.arc(s.x, s.y, 90, 0, 7); cx.fill();
    } else {
      cx.fillStyle = s.state === 'chase' ? 'rgba(255,41,117,0.22)'
        : (s.state === 'search' || s.state === 'investigate') ? 'rgba(255,211,25,0.16)'
        : 'rgba(255,41,117,0.10)';
      cx.beginPath(); cx.moveTo(s.x, s.y);
      cx.arc(s.x, s.y, 220, s.dir - 1.1, s.dir + 1.1);
      cx.closePath(); cx.fill();
    }
  }

  // Blink streak
  if (blinkFx) {
    cx.save(); cx.globalAlpha = blinkFx.t / 0.3;
    cx.strokeStyle = '#8c1eff'; cx.lineWidth = 4; cx.shadowColor = '#8c1eff'; cx.shadowBlur = 16;
    cx.setLineDash([6, 8]);
    cx.beginPath(); cx.moveTo(blinkFx.x1, blinkFx.y1); cx.lineTo(blinkFx.x2, blinkFx.y2); cx.stroke();
    cx.restore();
  }
  // Nova ring
  if (novaFx) {
    const p = 1 - novaFx.t / 0.5;
    cx.save(); cx.globalAlpha = 1 - p;
    cx.strokeStyle = '#7fd4ff'; cx.lineWidth = 5; cx.shadowColor = '#7fd4ff'; cx.shadowBlur = 20;
    cx.beginPath(); cx.arc(novaFx.x, novaFx.y, NOVA_RADIUS * p, 0, 7); cx.stroke();
    cx.restore();
  }
  // Decoy: flickering hologram of the hider
  if (decoy.t > 0) {
    const flicker = 0.55 + Math.sin(t * 20) * 0.15;
    drawFace(hiderImg, decoy.x, decoy.y, player.r, '#00ffa3', flicker);
    cx.save(); cx.strokeStyle = '#00ffa3'; cx.setLineDash([4, 4]); cx.lineWidth = 2;
    cx.globalAlpha = 0.7;
    cx.beginPath(); cx.arc(decoy.x, decoy.y, player.r + 6, 0, 7); cx.stroke();
    cx.restore();
  }
  // Bolt projectile + trail
  if (bolt) {
    cx.save();
    for (let i = 0; i < bolt.trail.length; i++) {
      cx.globalAlpha = (i / bolt.trail.length) * 0.6;
      cx.fillStyle = '#ffd319';
      cx.beginPath(); cx.arc(bolt.trail[i].x, bolt.trail[i].y, 4, 0, 7); cx.fill();
    }
    cx.globalAlpha = 1; cx.shadowColor = '#ffd319'; cx.shadowBlur = 16;
    cx.fillStyle = '#ffd319';
    cx.beginPath(); cx.arc(bolt.x, bolt.y, 7, 0, 7); cx.fill();
    cx.restore();
  }

  // Player (with sprint trail + facing tick)
  const hidden = whichBush(player.x, player.y) >= 0;
  if (sprintT > 0) {
    cx.save(); cx.globalAlpha = 0.35; cx.shadowColor = '#00e5ff'; cx.shadowBlur = 20;
    cx.strokeStyle = '#00e5ff'; cx.lineWidth = 2;
    cx.beginPath(); cx.arc(player.x, player.y, player.r + 7, 0, 7); cx.stroke();
    cx.restore();
  }
  drawFace(hiderImg, player.x, player.y, player.r, '#00e5ff', hidden ? 0.5 : 1);
  // Facing indicator (aim for blink/bolt)
  cx.save(); cx.fillStyle = '#00e5ff'; cx.globalAlpha = hidden ? 0.5 : 0.9;
  cx.beginPath();
  cx.arc(player.x + player.fx * (player.r + 8), player.y + player.fy * (player.r + 8), 3.5, 0, 7);
  cx.fill(); cx.restore();

  // Seekers
  for (const s of seekers) {
    const inB = whichBush(s.x, s.y) >= 0;
    const disabled = s.frozenT > 0 || s.stunT > 0;
    const ring = disabled ? '#7fd4ff'
      : (s.state === 'search' || s.state === 'investigate') ? '#ffd319' : '#ff2975';
    drawFace(seekerImg, s.x, s.y, s.r, ring, disabled ? 0.75 : (inB ? 0.6 : 1));
    if (s.frozenT > 0) {
      cx.save(); cx.strokeStyle = '#7fd4ff'; cx.lineWidth = 3; cx.shadowColor = '#7fd4ff'; cx.shadowBlur = 12;
      cx.beginPath(); cx.arc(s.x, s.y, s.r + 6, 0, 7); cx.stroke();
      cx.font = '12px monospace'; cx.fillStyle = '#7fd4ff'; cx.textAlign = 'center';
      cx.fillText('❄ ' + s.frozenT.toFixed(1), s.x, s.y - s.r - 12);
      cx.restore();
    } else if (s.stunT > 0) {
      cx.save(); cx.font = '13px monospace'; cx.fillStyle = '#ffd319'; cx.textAlign = 'center';
      cx.shadowColor = '#ffd319'; cx.shadowBlur = 10;
      const spin = t * 6;
      for (let k = 0; k < 3; k++) {
        const a = spin + k * 2.1;
        cx.fillText('✦', s.x + Math.cos(a) * (s.r + 8), s.y - s.r - 6 + Math.sin(a) * 4);
      }
      cx.restore();
    }
  }

  // Scanlines
  cx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < H; y += 4) cx.fillRect(0, y, W, 1);

  // Unlock toast
  if (toastT > 0 && !over) {
    cx.save(); cx.textAlign = 'center';
    cx.globalAlpha = Math.min(1, toastT);
    cx.font = 'bold 22px monospace';
    cx.shadowColor = '#00ffa3'; cx.shadowBlur = 14; cx.fillStyle = '#00ffa3';
    cx.fillText(toastMsg, W/2, 46);
    cx.restore();
  }

  if (over) {
    cx.save(); cx.textAlign = 'center'; cx.font = 'bold 40px monospace';
    cx.shadowBlur = 16; cx.shadowColor = win ? '#00e5ff' : '#ff2975';
    cx.fillStyle = win ? '#00e5ff' : '#ff2975';
    cx.fillText(win ? 'LEVEL ' + level + ' CLEAR' : 'GAME OVER', W/2, H/2);
    cx.font = '18px monospace';
    cx.fillText(win ? 'ANOTHER SEEKER JOINS...' : 'INSERT COIN TO CONTINUE', W/2, H/2 + 34);
    cx.restore();
  }
  $('timer').textContent = Math.max(0, Math.ceil(timeLeft));
}

// ---------- Loop + input ----------
function loop(now) {
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now; t += dt;
  update(dt); draw(); updateHotbar();
  requestAnimationFrame(loop);
}
const ABILITY_KEYS = {' ':'sprint', 'q':'blink', 'e':'decoy', 'r':'nova', 'f':'bolt'};
addEventListener('keydown', e => {
  keys[e.key] = true;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (ABILITY_KEYS[k] !== undefined) { e.preventDefault(); useAbility(ABILITY_KEYS[k]); }
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.key] = false; });
document.querySelectorAll('.dpad button').forEach(b => {
  const d = b.dataset.d;
  const on = e => { e.preventDefault(); keys[d] = true; };
  const off = e => { e.preventDefault(); keys[d] = false; };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
});
document.getElementById('restart').addEventListener('click', fullReset);
renderHotbar();
requestAnimationFrame(loop);
