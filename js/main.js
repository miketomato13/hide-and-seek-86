// Entry point: canvas, sprites, run state, perception helpers, loop, input.
const cv = document.getElementById('game'), cx = cv.getContext('2d');
// ---------- Face sprites ----------
const hiderImg = new Image(), seekerImg = new Image();
hiderImg.src = 'data:image/jpeg;base64,' + HIDER_B64;
seekerImg.src = 'data:image/jpeg;base64,' + SEEKER_B64;

// ---------- State ----------
let player, seekers, keys = {}, timeLeft, over, win, last, t = 0;
let level = 1, clearT = 0, started = false;
let cds = {}, sprintT = 0, decoy = {x:0, y:0, t:0}, bolt = null;
let runScore = 0, scoreSubmitted = false;
let crates = [], crateTimer = 5, cloakT = 0, floats = [], reachMask = null;
let novaFx = null, blinkFx = null, toastMsg = '', toastT = 0;
const $ = id => document.getElementById(id);

function unlocked(a) { return level >= a.unlock; }

function startLevel() {
  const epoch = Math.floor((level - 1) / 3);
  const newArena = epoch !== currentEpoch;
  if (newArena) { currentEpoch = epoch; generateMap(epoch); }
  player = {x:PLAYER_SPAWN.x, y:PLAYER_SPAWN.y, r:15, speed:180, fx:1, fy:0};
  seekers = [];
  const n = Math.max(1, Math.min(Math.floor((1 + level) * DIFF().botMul), spawns.length));
  for (let i = 0; i < n; i++) {
    const sp = spawns[i];
    seekers.push({
      x:sp.x, y:sp.y, r:16,
      speed: (125 + level*4) * DIFF().speedMul, chaseSpeed: (195 + level*4) * DIFF().speedMul,
      route: sp.route, wp: 0, state: 'patrol',
      lastSeen: null, searchT: 0, dir: 0,
      path: null, pathGoal: null, repathT: 0,
      investT: (2 + Math.random()*3) * Math.min(1, (1+level)/4) * DIFF().sweepMul, targetPoi: -1, lingerT: 0,
      frozenT: 0, stunT: 0, quarry: 'player',
      px: sp.x, py: sp.y, stuck: 0
    });
  }
  poiChecked = pois.map(p => p.bush ? -999 : -1400);
  sprintT = 0; decoy.t = 0; bolt = null; novaFx = null; blinkFx = null;
  crates = []; crateTimer = 4 + Math.random() * 4; cloakT = 0; floats = [];
  reachMask = reachableFrom(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
  timeLeft = LEVEL_TIME; over = false; win = false; clearT = 0;
  last = performance.now();
  $('level').textContent = 'LEVEL ' + level;
  $('statusMsg').textContent = DIFF().label + ' \u00b7 ' + n + ' SEEKER-BOTS \u00b7 SURVIVE 30 SEC';
  const newAb = ABILITIES.find(a => a.unlock === level);
  const parts = [];
  if (newArena && level > 1) parts.push('NEW ARENA');
  if (newAb) parts.push('NEW ABILITY: ' + newAb.name + ' [' + newAb.label + ']');
  if (parts.length) { toastMsg = parts.join(' \u00b7 '); toastT = 3.5; }
  renderHotbar();
}
function fullReset() {
  level = 1; started = true; currentEpoch = -1;
  runScore = 0; scoreSubmitted = false; hideGameOverPanel();
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
  if (pB >= 0) return sB === pB && d < 90 * DIFF().bushBubbleMul;
  if (d > 220 * DIFF().visionMul) return false;
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
// Stalest point-of-interest: bushes AND map corners join the sweep rotation,
// so open-ground corner camping gets checked as systematically as hedges.
function pickStalePoi(self) {
  const claimed = new Set();
  for (const o of seekers) if (o !== self && o.state === 'investigate') claimed.add(o.targetPoi);
  let best = -1, bestAge = -1;
  for (let i = 0; i < pois.length; i++) {
    if (claimed.has(i)) continue;
    const age = (t - poiChecked[i]) + Math.random() * 0.5;
    if (age > bestAge) { bestAge = age; best = i; }
  }
  return best >= 0 ? best : Math.floor(Math.random() * pois.length);
}
const bushCenter = i => ({x: bushes[i].x + bushes[i].w/2, y: bushes[i].y + bushes[i].h/2});
function sp0(s) { return s.state === 'chase' ? s.chaseSpeed : s.speed; }


// ---------- Leaderboard (arcade initials, no login) ----------
function hideGameOverPanel() {
  const p = $('goPanel'); if (p) p.style.display = 'none';
}
function showGameOverPanel() {
  const p = $('goPanel'); if (!p || scoreSubmitted) return;
  $('goScore').textContent = 'SCORE ' + Math.floor(runScore) + ' \u00b7 LVL ' + level;
  const inp = $('goInitials'); inp.value = '';
  p.style.display = 'flex';
  inp.focus();
}
async function loadScores() {
  const panel = $('lbPanel'), list = $('lbList'), status = $('lbStatus');
  if (!panel) return;
  try {
    const r = await fetch('/api/scores');
    const data = await r.json();
    if (data.offline) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    list.innerHTML = '';
    (data.scores || []).forEach((s, i) => {
      const li = document.createElement('li');
      li.textContent = String(i + 1).padStart(2, ' ') + '. ' + (s.initials || '???').padEnd(3, ' ') +
        '  ' + String(s.score).padStart(5, ' ') + '  LVL ' + s.level + (s.difficulty === 'easy' ? '  EZ' : '');
      list.appendChild(li);
    });
    status.textContent = (data.scores || []).length ? '' : 'NO SCORES YET \u00b7 BE FIRST';
  } catch (e) {
    panel.style.display = 'none';
  }
}
async function submitScore() {
  const inp = $('goInitials');
  const initials = (inp.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (!initials) { inp.focus(); return; }
  scoreSubmitted = true;
  hideGameOverPanel();
  try {
    await fetch('/api/scores', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({initials, score: Math.floor(runScore), level, difficulty})
    });
  } catch (e) {}
  loadScores();
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
const goSubmit = document.getElementById('goSubmit'), goSkip = document.getElementById('goSkip');
if (goSubmit) goSubmit.addEventListener('click', submitScore);
if (goSkip) goSkip.addEventListener('click', () => { scoreSubmitted = true; hideGameOverPanel(); });
const goInp = document.getElementById('goInitials');
if (goInp) goInp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') submitScore(); });
if (goInp) goInp.addEventListener('keyup', e => e.stopPropagation());
// ---------- Difficulty buttons ----------
function styleDiffButtons() {
  for (const [key, el] of [['easy', $('diffEasy')], ['hard', $('diffHard')]]) {
    if (!el) continue;
    const on = difficulty === key;
    el.style.color = on ? 'var(--gold)' : '#5d4a8a';
    el.style.borderColor = on ? 'var(--gold)' : '#5d4a8a';
    el.style.boxShadow = on ? '0 0 10px rgba(255,211,25,.4)' : 'none';
    el.style.textShadow = on ? '0 0 8px var(--gold)' : 'none';
  }
}
function setDifficulty(d) {
  if (difficulty === d) return;
  difficulty = d;
  styleDiffButtons();
  if (started) fullReset();
}
const deB = $('diffEasy'), dhB = $('diffHard');
if (deB) deB.addEventListener('click', () => setDifficulty('easy'));
if (dhB) dhB.addEventListener('click', () => setDifficulty('hard'));
styleDiffButtons();
loadScores();
renderHotbar();
requestAnimationFrame(loop);


// ---------- Presence counter ----------
const SESS_ID = crypto.randomUUID();
const BEAT_MS = 20000; // heartbeat every 20s (TTL is 45s)

async function presencePing(action) {
  try {
    const r = await fetch(`/api/scores?action=${action}&id=${SESS_ID}`, { method: 'POST' });
    const d = await r.json();
    if (typeof d.count === 'number') updatePresenceUI(d.count);
  } catch (_) {}
}

async function presenceCount() {
  try {
    const r = await fetch('/api/scores?action=count');
    const d = await r.json();
    if (typeof d.count === 'number') updatePresenceUI(d.count);
  } catch (_) {}
}

function updatePresenceUI(n) {
  const el = document.getElementById('onlineCount');
  if (!el) return;
  el.textContent = n === 1 ? '1 PLAYER ONLINE' : `${n} PLAYERS ONLINE`;
}

// Join on load, heartbeat every 20s, leave on unload
presencePing('join');
presenceCount();
setInterval(() => presencePing('beat'), BEAT_MS);
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') presencePing('leave');
  else presencePing('join');
});
addEventListener('pagehide', () => {
  navigator.sendBeacon(`/api/scores?action=leave&id=${SESS_ID}`, '');
});
