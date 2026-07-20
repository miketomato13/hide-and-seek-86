// Abilities, powerups, and the per-frame update (player + seeker AI).
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

function applyPowerup(kind, x, y) {
  if (kind.id === 'reset') {
    for (const a of ABILITIES) cds[a.id] = 0;
  } else if (kind.id === 'freeze') {
    for (const s of seekers) { s.frozenT = Math.max(s.frozenT, FREEZE_TIME); s.path = null; }
  } else if (kind.id === 'clock') {
    timeLeft = Math.max(0.05, timeLeft - CLOCK_CUT);
  } else if (kind.id === 'cloak') {
    cloakT = CLOAK_TIME;
  }
  floats.push({x, y, msg: kind.name + '!', t: 1.3, color: kind.color});
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
  runScore += dt; // 1 point per second survived, across the whole run
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

  // Powerup crates
  if (cloakT > 0) cloakT -= dt;
  for (const fl of floats) fl.t -= dt;
  floats = floats.filter(fl => fl.t > 0);
  crateTimer -= dt;
  if (crateTimer <= 0 && crates.length < CRATE_MAX) {
    crateTimer = 8 + Math.random() * 6;
    for (let tries = 0; tries < 40; tries++) {
      const x = 45 + Math.random() * (W - 90), y = 45 + Math.random() * (H - 90);
      if (hitWall(x, y, 18)) continue;
      if (reachMask && !cellReachable(reachMask, x, y)) continue;
      if (Math.hypot(x - player.x, y - player.y) < 120) continue;
      if (crates.some(c => Math.hypot(x - c.x, y - c.y) < 100)) continue;
      const kind = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
      crates.push({x, y, t: CRATE_LIFE, kind});
      break;
    }
  }
  for (const c of crates) c.t -= dt;
  crates = crates.filter(c => c.t > 0);
  for (let i = crates.length - 1; i >= 0; i--) {
    const c = crates[i];
    if (Math.hypot(c.x - player.x, c.y - player.y) < player.r + CRATE_PICKUP_R) {
      applyPowerup(c.kind, c.x, c.y);
      crates.splice(i, 1);
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

    for (let pi = 0; pi < pois.length; pi++) {
      const p = pois[pi];
      if (p.bush ? whichBush(s.x, s.y) === pi : Math.hypot(s.x - p.x, s.y - p.y) < 90) poiChecked[pi] = t;
    }

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
    const seesPlayer = cloakT <= 0 && canSeePoint(s, player.x, player.y);
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
      const c = pois[s.targetPoi];
      const arrived = navigate(s, c.x, c.y, s.speed, dt);
      if (arrived) {
        s.lingerT -= dt; s.dir += dt*2.5;
        poiChecked[s.targetPoi] = t;
        if (s.lingerT <= 0) { s.state = 'patrol'; s.path = null; s.investT = (4 + Math.random()*4) * Math.min(1, seekers.length/4); }
      }
    } else {
      s.investT -= dt;
      if (s.investT <= 0) {
        s.state = 'investigate';
        s.targetPoi = pickStalePoi(s);
        s.lingerT = 1.3; s.path = null;
      } else {
        const tp = s.route[s.wp];
        if (navigate(s, tp.x, tp.y, s.speed, dt)) s.wp = (s.wp + 1) % s.route.length;
      }
    }

    if (Math.hypot(s.x - player.x, s.y - player.y) < s.r + player.r) {
      over = true; win = false;
      $('statusMsg').textContent = 'CAUGHT \u00b7 GAME OVER \u00b7 INSERT COIN';
      showGameOverPanel();
    }
  }
}

