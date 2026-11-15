// FROSTLINE — the HUD.
// One update function, called once per rendered frame, that mirrors the
// simulation state into the DOM. Values are cached so the DOM is only
// touched when something actually changed.
const cache = new Map();

function setText(id, value) {
  if (cache.get(id) === value) return;
  cache.set(id, value);
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setStyle(id, prop, value) {
  const key = `${id}.${prop}`;
  if (cache.get(key) === value) return;
  cache.set(key, value);
  const el = document.getElementById(id);
  if (el) el.style[prop] = value;
}

function setVisible(id, visible) {
  const key = `${id}.visible`;
  if (cache.get(key) === visible) return;
  cache.set(key, visible);
  const el = document.getElementById(id);
  if (el) el.hidden = !visible;
}

function pips(id, alive, total, color) {
  const key = `${id}.pips`;
  const value = `${alive}/${total}`;
  if (cache.get(key) === value) return;
  cache.set(key, value);
  const el = document.getElementById(id);
  if (!el) return;
  let html = '';
  for (let i = 0; i < total; i += 1) {
    html += `<span class="pip${i < alive ? ' on' : ''}" style="--pip:${color}"></span>`;
  }
  el.innerHTML = html;
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function updateHud(state) {
  const p = state.player;
  const aliveFrost = (p.alive ? 1 : 0) + state.bots.filter((b) => b.team === 'frost' && b.alive).length;
  const aliveGlacier = state.bots.filter((b) => b.team === 'glacier' && b.alive).length;

  setText('health-num', String(Math.max(0, Math.ceil(p.hp))));
  setStyle('health-fill', 'width', `${Math.max(0, p.hp)}%`);
  setStyle('health-fill', 'background', p.hp > 50 ? 'var(--ok)' : p.hp > 25 ? 'var(--accent)' : 'var(--danger)');

  const w = state.weapons[p.weapon];
  setText('weapon-name', w.name);
  setText('ammo-mag', p.reloading ? '--' : String(p.mag));
  setText('ammo-reserve', p.reserve === Infinity ? '∞' : `/ ${p.reserve}`);
  setText('grenades', `◉ ${p.grenades}`);
  setVisible('ammo', p.alive);

  setText('money', `$${state.econ.money}`);
  setText('score-frost', String(state.wins.frost));
  setText('score-glacier', String(state.wins.glacier));
  setText('round-label', state.phase === 'matchEnd' ? 'MATCH OVER' : `ROUND ${state.round}`);
  pips('alive-frost', aliveFrost, 4, 'var(--frost)');
  pips('alive-glacier', aliveGlacier, 4, 'var(--glacier)');

  let timer = 0;
  if (state.phase === 'buy') timer = 12 - state.phaseT;
  else if (state.phase === 'live') timer = state.bomb.status === 'planted' ? state.bomb.fuse : 100 - state.phaseT;
  else if (state.phase === 'roundEnd') timer = 0;
  setText('timer', fmtTime(timer));
  setStyle('timer', 'color', state.bomb.status === 'planted' ? 'var(--danger)' : 'var(--ink)');

  const obj = state.bomb.status === 'planted'
    ? `CHARGE PLANTED @ SITE ${state.bomb.site.id} — ${Math.ceil(state.bomb.fuse)}s`
    : state.bomb.status === 'carried'
      ? (state.bomb.carrier === 'player' ? 'YOU CARRY THE CHARGE — PLANT AT A OR B' : 'TEAMMATE CARRIES THE CHARGE')
      : state.bomb.status === 'dropped'
        ? 'CHARGE DROPPED — PICK IT UP'
        : 'PLANT THE CHARGE AT SITE A OR B';
  setText('objective', obj);

  // Context hint: plant / defuse progress.
  const site = state.siteAtPlayer;
  let hint = '';
  if (state.phase === 'live' && p.alive && state.bomb.status === 'carried' && state.bomb.carrier === 'player' && site) {
    hint = p.planting ? `PLANTING… ${Math.round(state.bomb.progress * 100)}%` : 'HOLD E TO PLANT THE CHARGE';
  } else if (state.phase === 'live' && p.alive && state.bomb.status === 'planted' && site && site.id === state.bomb.site.id) {
    hint = p.defusing ? `DEFUSING… ${Math.round(state.bomb.progress * 100)}%` : 'HOLD E TO DEFUSE';
  } else if (state.phase === 'buy') {
    hint = 'BUY PHASE — keys 1-4 weapons, 5 grenade, B menu';
  } else if (!p.alive && state.phase === 'live') {
    hint = 'YOU ARE DOWN — SPECTATING YOUR TEAM';
  }
  setText('hint', hint);
  setVisible('plant-bar', p.planting || p.defusing);
  if (p.planting || p.defusing) setStyle('plant-fill', 'width', `${Math.round(state.bomb.progress * 100)}%`);

  // Crosshair spread grows with bloom + movement.
  const spreadPx = 3 + p.bloom * 26 + (state.moveSpeed > 3 ? 5 : 0);
  setStyle('crosshair', '--gap', `${spreadPx}px`);

  // Banner.
  if (state.banner) {
    setText('banner-title', state.banner.title);
    setText('banner-sub', state.banner.sub || '');
    setVisible('banner', true);
  } else {
    setVisible('banner', false);
  }

  setVisible('buymenu', state.buyOpen && state.phase === 'buy');
  if (state.buyOpen && state.phase === 'buy') {
    for (const id of ['rifle', 'smg', 'marksman', 'pistol']) {
      const def = state.weapons[id];
      setText(`buy-${id}-price`, def.price === 0 ? 'OWNED' : `$${def.price}`);
      const owned = p.weapon === id;
      setStyle(`buy-${id}`, 'borderColor', owned ? 'var(--accent)' : '');
    }
    setText('buy-grenade-price', `$${state.grenadeDef.price}`);
  }

  // Kill feed: newest first, fade old entries by age.
  const feed = document.getElementById('killfeed');
  if (feed) {
    const key = state.kills.map((k) => k.text).join('|');
    if (cache.get('killfeed') !== key) {
      cache.set('killfeed', key);
      feed.innerHTML = state.kills.slice(-4).reverse()
        .map((k) => `<div class="kill">${k.text}</div>`).join('');
    }
  }
}

export function flashHitmarker(headshot) {
  const el = document.getElementById('hitmarker');
  if (!el) return;
  el.classList.add('on');
  el.classList.toggle('head', !!headshot);
  window.setTimeout(() => el.classList.remove('on', 'head'), 110);
}
