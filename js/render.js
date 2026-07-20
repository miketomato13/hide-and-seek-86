// All drawing: canvas scene + DOM hotbar.
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
  // Powerup crates: rotating '?' item boxes
  for (const c of crates) {
    const wob = Math.sin(t * 3 + c.x) * 3;
    const blinkOut = c.t < 2.5 && Math.floor(t * 6) % 2 === 0;
    if (blinkOut) continue;
    cx.save();
    cx.translate(c.x, c.y + wob);
    cx.rotate(Math.sin(t * 2 + c.y) * 0.25);
    cx.shadowColor = c.kind.color; cx.shadowBlur = 16;
    cx.strokeStyle = c.kind.color; cx.lineWidth = 3;
    cx.fillStyle = 'rgba(18,8,31,0.85)';
    cx.beginPath(); cx.roundRect(-14, -14, 28, 28, 6); cx.fill(); cx.stroke();
    cx.rotate(-Math.sin(t * 2 + c.y) * 0.25);
    cx.font = 'bold 18px monospace'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillStyle = c.kind.color;
    cx.fillText('?', 0, 1);
    cx.restore();
  }

  const hidden = whichBush(player.x, player.y) >= 0;
  if (cloakT > 0) {
    cx.save(); cx.globalAlpha = 0.6; cx.strokeStyle = '#00ffa3'; cx.setLineDash([3, 5]);
    cx.lineWidth = 2; cx.shadowColor = '#00ffa3'; cx.shadowBlur = 12;
    cx.beginPath(); cx.arc(player.x, player.y, player.r + 8, 0, 7); cx.stroke();
    cx.restore();
  }
  if (sprintT > 0) {
    cx.save(); cx.globalAlpha = 0.35; cx.shadowColor = '#00e5ff'; cx.shadowBlur = 20;
    cx.strokeStyle = '#00e5ff'; cx.lineWidth = 2;
    cx.beginPath(); cx.arc(player.x, player.y, player.r + 7, 0, 7); cx.stroke();
    cx.restore();
  }
  drawFace(hiderImg, player.x, player.y, player.r, '#00e5ff', cloakT > 0 ? 0.28 : (hidden ? 0.5 : 1));
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

  // Floating pickup texts
  for (const fl of floats) {
    cx.save(); cx.globalAlpha = Math.min(1, fl.t);
    cx.font = 'bold 16px monospace'; cx.textAlign = 'center';
    cx.shadowColor = fl.color; cx.shadowBlur = 12; cx.fillStyle = fl.color;
    cx.fillText(fl.msg, fl.x, fl.y - (1.3 - fl.t) * 40 - 24);
    cx.restore();
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

