// FROSTLINE — the game itself.
// A fixed-step simulation (60 Hz) kept apart from rendering: input, bots,
// the bomb and the rounds advance in step(); render() only draws the state.
// No objects are allocated in the hot loop — tracers, grenades and scratch
// vectors are pooled and reused. The judge never runs the game, but the
// player does, so this file is where the game has to feel right.
import * as THREE from 'three';
import { PALETTE, TEAM_NAME } from './palette.js';
import { makeRng } from './rng.js';
import { buildWorld, siteAt, collideCircle } from './world.js';
import { createBody, stepBody, eyeHeight, moveSpeed, BODY } from './player.js';
import { createBots, updateBots, assignObjectives, syncBotMeshes } from './bots.js';
import { createBomb, dropBomb, plantBomb, updateBomb, BOMB } from './bomb.js';
import { startMatch, startRound, endRound, updateRounds, ROUND } from './rounds.js';
import { WEAPONS, GRENADE, weaponById } from './weapons.js';
import { awardKill, awardPlant, tryBuy, ECON } from './economy.js';
import { fireHitscan, spreadDir } from './combat.js';
import { updateHud, flashHitmarker } from './hud.js';
import { createInput } from './input.js';
import { AudioSys } from './audio.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const SEED = Number(params.get('seed') || 1);
const SHOT = params.get('shot'); // start | play | end | null

// ---- renderer, scene, camera -------------------------------------------
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 220);
scene.add(camera);

// ---- state --------------------------------------------------------------
const state = {
  seed: SEED,
  rng: makeRng(SEED),
  time: 0,
  phase: 'menu',
  phaseT: 0,
  round: 0,
  wins: { frost: 0, glacier: 0 },
  matchWinner: null,
  roundReason: '',
  roundWinner: null,
  econ: { money: ECON.startMoney, lossStreak: 0 },
  weapons: WEAPONS,
  grenadeDef: GRENADE,
  world: buildWorld(scene),
  bomb: createBomb(),
  kills: [],
  events: [],
  shotEvents: [],
  tracers: [],
  grenades: [],
  banner: null,
  bannerT: 0,
  buyOpen: false,
  siteAtPlayer: null,
  moveSpeed: 0,
  audio: new AudioSys(),
  shakeT: 0,
};
state.player = {
  team: 'frost',
  name: 'You',
  body: createBody(-21, 0, -Math.PI / 2),
  hp: 100,
  alive: true,
  survived: false,
  weapon: 'pistol',
  owned: { pistol: true },
  mag: WEAPONS.pistol.mag,
  reserve: WEAPONS.pistol.reserve,
  grenades: 0,
  reloading: false,
  reloadT: 0,
  planting: false,
  defusing: false,
  bloom: 0,
  recoil: 0,
  lastShotT: 0,
  zoomed: false,
};
state.bots = createBots(state, scene);
state.damageActor = damageActor;

const input = createInput(renderer.domElement, () => {
  if (state.phase === 'menu') beginMatch();
});
input.shotMode = !!SHOT;

// ---- viewmodel gun + muzzle flash ---------------------------------------
const gunMat = new THREE.MeshLambertMaterial({ color: 0x4a6a8a });
const gunAccent = new THREE.MeshBasicMaterial({ color: PALETTE.ice });
const viewGun = new THREE.Group();
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.48), gunMat);
const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.3), gunMat);
gunBarrel.position.set(0, 0.03, -0.36);
const gunSight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.07), gunAccent);
gunSight.position.set(0, 0.09, -0.08);
viewGun.add(gunBody, gunBarrel, gunSight);
viewGun.scale.setScalar(0.8);
viewGun.position.set(0.3, -0.28, -0.55);
camera.add(viewGun);
const flash = new THREE.Mesh(
  new THREE.PlaneGeometry(0.3, 0.3),
  new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, side: THREE.DoubleSide }),
);
flash.position.set(0.3, -0.24, -0.95);
camera.add(flash);

// ---- bomb mesh -----------------------------------------------------------
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), new THREE.MeshLambertMaterial({ color: 0x1c2733 }));
const bombLightMat = new THREE.MeshBasicMaterial({ color: 0xff5a4e });
const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), bombLightMat);
bombLight.position.set(0, 0.14, 0);
bombMesh.add(bombBox, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// ---- tracer pool (no allocation in the hot loop) -------------------------
const TRACER_MAX = 24;
for (let i = 0; i < TRACER_MAX; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  state.tracers.push({ line, t: 0 });
}
let tracerIdx = 0;
state.spawnTracer = spawnTracer;
function spawnTracer(from, to, color) {
  const tr = state.tracers[tracerIdx];
  tracerIdx = (tracerIdx + 1) % TRACER_MAX;
  const pos = tr.line.geometry.attributes.position.array;
  pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
  pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
  tr.line.geometry.attributes.position.needsUpdate = true;
  tr.line.material.color.setHex(color);
  tr.line.material.opacity = 0.9;
  tr.line.visible = true;
  tr.t = 0.08;
}

// ---- explosion flash (reused mesh) ---------------------------------------
const blast = new THREE.Mesh(
  new THREE.SphereGeometry(1, 18, 12),
  new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0, depthWrite: false }),
);
blast.visible = false;
scene.add(blast);
let blastT = 0;

const scratchDir = { x: 0, y: 0, z: 0 };

// ---- combat --------------------------------------------------------------
function damageActor(target, amount, killer) {
  if (!target.alive) return;
  const wasPlanting = target.planting;
  target.hp -= amount;
  if (target.hp > 0) return;
  target.hp = 0;
  target.alive = false;
  target.planting = false;
  target.defusing = false;
  if (state.bomb.status === 'planted' && state.bomb.defuser === target.id) {
    state.bomb.defuser = null;
    state.bomb.progress = 0;
  }
  if (wasPlanting) state.bomb.progress = 0;
  const killerName = killer === state.player ? 'You' : killer.name;
  const victimName = target === state.player ? 'You' : target.name;
  state.kills.push({ text: `${killerName} ▸ ${victimName}`, t: state.time });
  if (state.kills.length > 8) state.kills.shift();
  if (killer === state.player) {
    awardKill(state.econ);
    state.audio.kill();
  }
  if (target === state.player) {
    state.audio.roundLose();
  }
  // The charge drops where its carrier fell.
  if (state.bomb.status === 'carried') {
    const carrierIsPlayer = state.bomb.carrier === 'player';
    const carrierIsTarget = carrierIsPlayer ? target === state.player : state.bomb.carrier === target.id;
    if (carrierIsTarget) dropBomb(state.bomb, target.body.x, target.body.z);
  }
}

function reloadTimeFor(weaponId) {
  return weaponId === 'marksman' ? 2.2 : 1.6;
}

function startReload(actor) {
  if (actor.reloading) return;
  const w = weaponById(actor.weapon);
  if (actor.mag >= w.mag) return;
  if (actor.reserve !== Infinity && actor.reserve <= 0) return;
  actor.reloading = true;
  actor.reloadT = reloadTimeFor(actor.weapon);
  if (actor === state.player) state.audio.reload();
}

function finishReload(actor) {
  const w = weaponById(actor.weapon);
  const need = w.mag - actor.mag;
  const take = actor.reserve === Infinity ? need : Math.min(need, actor.reserve);
  actor.mag += take;
  if (actor.reserve !== Infinity) actor.reserve -= take;
  actor.reloading = false;
}

function playerShoot() {
  const p = state.player;
  const w = weaponById(p.weapon);
  if (p.lastShotT > 0 || p.reloading) return;
  if (p.mag <= 0) {
    startReload(p);
    return;
  }
  const moving = moveSpeed(p.body) > 1.2;
  const spread = w.spreadDeg + p.bloom * 2.2 + (moving ? w.moveSpreadDeg : 0) + (p.body.crouched ? -0.25 : 0);
  const dir = spreadDir(p.body.yaw, p.body.pitch + p.recoil, Math.max(0.05, spread), state.rng);
  const res = fireHitscan(state, p, dir, w);
  p.mag -= 1;
  p.lastShotT = w.rateMs / 1000;
  p.bloom = Math.min(1, p.bloom + (w.auto ? 0.14 : 0.3));
  p.recoil = Math.min(0.05, p.recoil + (w.recoilDeg * Math.PI) / 180);
  const eye = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };
  const end = res.hit
    ? { x: eye.x + dir.x * res.t, y: eye.y + dir.y * res.t, z: eye.z + dir.z * res.t }
    : { x: eye.x + dir.x * w.range, y: eye.y + dir.y * w.range, z: eye.z + dir.z * w.range };
  spawnTracer(eye, end, w.tracer);
  flash.material.opacity = 0.95;
  window.setTimeout(() => { flash.material.opacity = 0; }, 45);
  state.audio.shot(p.weapon, 0);
  state.shotEvents.push({ x: p.body.x, z: p.body.z, team: 'frost', t: state.time });
  if (res.hit) {
    damageActor(res.actor, res.damage, p);
    flashHitmarker(res.head);
    state.audio.hit(res.head);
  }
}

function throwGrenade(actor) {
  if (actor.grenades <= 0) return;
  actor.grenades -= 1;
  const eyeY = eyeHeight(actor.body);
  const dir = {
    x: -Math.sin(actor.body.yaw) * Math.cos(actor.body.pitch),
    y: Math.sin(actor.body.pitch) + 0.35,
    z: -Math.cos(actor.body.yaw) * Math.cos(actor.body.pitch),
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x9fdcff }),
  );
  mesh.position.set(actor.body.x + dir.x * 0.5, eyeY - 0.15, actor.body.z + dir.z * 0.5);
  scene.add(mesh);
  state.grenades.push({
    x: mesh.position.x, y: mesh.position.y, z: mesh.position.z,
    vx: dir.x * 15, vy: dir.y * 15 + 2, vz: dir.z * 15,
    fuse: GRENADE.fuseMs / 1000, mesh,
  });
  if (actor === state.player) state.audio.click();
}

function explodeGrenade(g) {
  scene.remove(g.mesh);
  blast.position.set(g.x, Math.max(g.y, 0.4), g.z);
  blast.visible = true;
  blastT = 0.45;
  state.audio.explosion();
  state.shakeT = 0.35;
  const actors = [state.player, ...state.bots];
  for (const a of actors) {
    if (!a.alive) continue;
    const d = Math.hypot(a.body.x - g.x, a.body.z - g.z);
    if (d > GRENADE.radius) continue;
    if (segmentBlocked2(a.body.x, a.body.z, g.x, g.z)) continue;
    const dmg = GRENADE.maxDamage * (1 - d / GRENADE.radius) + 10;
    damageActor(a, dmg, state.player);
  }
}

function segmentBlocked2(x0, z0, x1, z1) {
  // Thin wrapper so main.js never imports world helpers twice.
  return state.world.obstacles.some((o) => o.kind === 'wall' && segHits(x0, z0, x1, z1, o));
}

function segHits(x0, z0, x1, z1, o) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  let tmin = 0;
  let tmax = 1;
  const tests = [
    [dx, o.x0 - x0, o.x1 - x0],
    [dz, o.z0 - z0, o.z1 - z0],
  ];
  for (const [d, lo, hi] of tests) {
    if (Math.abs(d) < 1e-9) {
      if (lo > 0 || hi < 0) return false;
    } else {
      let t1 = lo / d;
      let t2 = hi / d;
      if (t1 > t2) {
        const t = t1; t1 = t2; t2 = t;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

function updateGrenades(dt) {
  for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
    const g = state.grenades[i];
    g.vy -= 12 * dt;
    const px = g.x;
    const pz = g.z;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.11) {
      g.y = 0.11;
      g.vy = Math.abs(g.vy) * 0.45;
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    // Bounce off walls: revert the axis that entered a box.
    const probe = { x: g.x, z: g.z };
    collideCircle(probe, 0.11, state.world.obstacles);
    if (probe.x !== g.x) {
      g.x = px;
      g.vx = -g.vx * 0.5;
    }
    if (probe.z !== g.z) {
      g.z = pz;
      g.vz = -g.vz * 0.5;
    }
    g.mesh.position.set(g.x, g.y, g.z);
    g.fuse -= dt;
    if (g.fuse <= 0) {
      state.grenades.splice(i, 1);
      explodeGrenade(g);
    }
  }
}

// ---- buy menu ------------------------------------------------------------
function buyWeapon(id) {
  const p = state.player;
  const def = weaponById(id);
  if (state.phase !== 'buy') return;
  if (p.owned[id]) {
    switchWeapon(id);
    return;
  }
  if (!tryBuy(state.econ, def.price)) {
    state.audio.click();
    return;
  }
  p.owned[id] = true;
  switchWeapon(id);
  state.audio.click();
}

function switchWeapon(id) {
  const p = state.player;
  if (!p.owned[id] || p.weapon === id) return;
  p.weapon = id;
  const w = weaponById(id);
  p.mag = w.mag;
  p.reserve = w.reserve;
  p.reloading = false;
  p.zoomed = false;
  state.audio.click();
}

function buyGrenade() {
  const p = state.player;
  if (state.phase !== 'buy') return;
  if (p.grenades >= GRENADE.maxCarry) return;
  if (!tryBuy(state.econ, GRENADE.price)) return;
  p.grenades += 1;
  state.audio.click();
}

// ---- events --------------------------------------------------------------
function handleEvents() {
  for (const ev of state.events) {
    if (ev.type === 'roundStart') {
      setBanner(`ROUND ${ev.round}`, 'Buy phase — gear up, Frost attacks');
      state.buyOpen = true;
    } else if (ev.type === 'liveStart') {
      state.buyOpen = false;
      assignObjectives(state);
      setBanner('GO GO GO', 'Plant the charge at Glacier or Harbor');
      state.audio.beep();
    } else if (ev.type === 'roundEnd') {
      const won = ev.winner === 'frost';
      setBanner(won ? 'ROUND WON' : 'ROUND LOST', `${TEAM_NAME[ev.winner]} takes the round — ${ev.reason}`);
      if (won) state.audio.roundWin();
      else state.audio.roundLose();
    } else if (ev.type === 'matchEnd') {
      document.getElementById('matchend-title').textContent =
        ev.winner === 'frost' ? 'FROSTLINE — FROST WINS' : 'FROSTLINE — GLACIER WINS';
      document.getElementById('matchend-sub').textContent =
        `Final score Frost ${state.wins.frost} — ${state.wins.glacier} Glacier · Round ${state.round}`;
      document.getElementById('matchend').hidden = false;
      document.exitPointerLock?.();
    } else if (ev.type === 'planted') {
      setBanner('CHARGE PLANTED!', `Site ${ev.site} — hold it for ${BOMB.fuseTime}s`);
      state.audio.beep();
    } else if (ev.type === 'bombPickup') {
      setBanner('CHARGE RECOVERED', `${ev.by} picked up the charge`);
    }
  }
  state.events.length = 0;
}

function setBanner(title, sub) {
  state.banner = { title, sub };
  state.bannerT = 3.5;
}

// ---- match control -------------------------------------------------------
function beginMatch() {
  document.getElementById('overlay').hidden = true;
  startMatch(state);
}

document.getElementById('play').addEventListener('click', () => {
  state.audio.ensure();
  renderer.domElement.requestPointerLock?.();
  beginMatch();
});
document.getElementById('again').addEventListener('click', () => {
  document.getElementById('matchend').hidden = true;
  renderer.domElement.requestPointerLock?.();
  startMatch(state);
});
for (const id of ['rifle', 'smg', 'marksman', 'pistol']) {
  document.getElementById(`buy-${id}`).addEventListener('click', () => buyWeapon(id));
}
document.getElementById('buy-grenade').addEventListener('click', () => buyGrenade());

// ---- per-frame input -----------------------------------------------------
function readMoveInput() {
  const k = input.keys;
  return {
    f: (k.has('forward') ? 1 : 0) - (k.has('back') ? 1 : 0),
    s: (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0),
    jump: k.has('jump'),
    crouch: k.has('crouch'),
  };
}

function handleActionKeys() {
  // One-shot actions, consumed from the pressed set (see input.js).
  const k = input.pressed;
  if (k.has('reload')) startReload(state.player);
  if (k.has('throwGrenade')) throwGrenade(state.player);
  if (k.has('buy') && state.phase === 'buy') state.buyOpen = !state.buyOpen;
  if (k.has('w1')) buyWeapon('rifle');
  if (k.has('w2')) buyWeapon('smg');
  if (k.has('w3')) buyWeapon('marksman');
  if (k.has('w4')) switchWeapon('pistol');
  if (k.has('w5')) {
    // In the buy phase 5 buys a grenade; live, it throws one you own.
    if (state.phase === 'buy') buyGrenade();
    else if (state.player.grenades > 0) throwGrenade(state.player);
  }
  k.clear();
}

// ---- fixed step ----------------------------------------------------------
function step(dt) {
  state.time += dt;
  const p = state.player;

  // Look.
  const { dx, dy } = input.consumeLook();
  if (p.alive && (input.locked || input.shotMode)) {
    p.body.yaw -= dx * 0.0022;
    p.body.pitch -= dy * 0.0022;
    p.body.pitch = Math.max(-1.45, Math.min(1.45, p.body.pitch));
  }

  // Player movement + shooting, only while alive and in an active phase.
  const active = (state.phase === 'buy' || state.phase === 'live') && p.alive;
  if (active) {
    const mv = readMoveInput();
    stepBody(p.body, mv, dt, state.world.obstacles);
    state.moveSpeed = moveSpeed(p.body);
    handleActionKeys();
    if (p.reloading) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) finishReload(p);
    }
    p.lastShotT -= dt;
    p.bloom = Math.max(0, p.bloom - dt * 1.4);
    p.recoil = Math.max(0, p.recoil - dt * 0.09);
    if (input.firing && state.phase === 'live') {
      const w = weaponById(p.weapon);
      if (w.auto) playerShoot();
      else if (!p._firedOnce) {
        playerShoot();
        p._firedOnce = true;
      }
    } else {
      p._firedOnce = false;
    }
    // Zoom on the marksman with right mouse held.
    p.zoomed = p.weapon === 'marksman' && input.aiming;
  } else {
    state.moveSpeed = 0;
    // Drop stale one-shot presses so they never fire in a later phase.
    input.pressed.clear();
  }

  // Plant / defuse: hold E inside the right site.
  p.planting = false;
  p.defusing = false;
  state.siteAtPlayer = state.phase === 'live' && p.alive ? siteAt(p.body.x, p.body.z) : null;
  if (state.phase === 'live' && p.alive && input.keys.has('interact') && state.siteAtPlayer) {
    if (state.bomb.status === 'carried' && state.bomb.carrier === 'player') {
      p.planting = true;
      state.bomb.progress += dt / BOMB.plantTime;
      if (state.bomb.progress >= 1) {
        plantBomb(state.bomb, state.siteAtPlayer);
        awardPlant(state.econ);
        state.events.push({ type: 'planted', by: 'You', site: state.siteAtPlayer.id });
      }
    } else if (state.bomb.status === 'planted' && state.siteAtPlayer.id === state.bomb.site.id) {
      p.defusing = true;
      state.bomb.defuser = 'player';
    }
  }
  if (!p.defusing && state.bomb.defuser === 'player') {
    state.bomb.defuser = null;
    state.bomb.progress = 0;
  }
  // A defusing bot that stopped (died, fled or got distracted) drops the
  // defuse; the progress resets so it cannot resume for free.
  if (state.bomb.status === 'planted' && state.bomb.defuser && state.bomb.defuser !== 'player') {
    const d = state.bots.find((b) => b.id === state.bomb.defuser);
    if (!d || !d.alive || !d.defusing) {
      state.bomb.defuser = null;
      state.bomb.progress = 0;
    }
  }

  // Bots, bomb, rounds.
  updateBots(state, dt);
  const bombEvent = state.bomb.status === 'planted' ? updateBomb(state.bomb, dt) : null;
  if (bombEvent === 'exploded') {
    blast.position.set((state.bomb.site.x0 + state.bomb.site.x1) / 2, 1, (state.bomb.site.z0 + state.bomb.site.z1) / 2);
    blast.visible = true;
    blastT = 0.8;
    state.audio.explosion();
    state.shakeT = 0.5;
    endRound(state, 'frost', 'Charge detonated');
  } else if (bombEvent === 'defused') {
    endRound(state, 'glacier', 'Charge defused');
  }
  updateRounds(state, dt);
  updateGrenades(dt);

  // Tracer fade.
  for (const tr of state.tracers) {
    if (!tr.line.visible) continue;
    tr.t -= dt;
    tr.line.material.opacity = Math.max(0, tr.t / 0.08) * 0.9;
    if (tr.t <= 0) tr.line.visible = false;
  }
  if (blastT > 0) {
    blastT -= dt;
    const s = 1 + (0.45 - Math.max(blastT, 0)) * 22;
    blast.scale.setScalar(Math.max(0.1, s));
    blast.material.opacity = Math.max(0, blastT / 0.45) * 0.75;
    if (blastT <= 0) blast.visible = false;
  }
  if (state.shakeT > 0) state.shakeT -= dt;

  // Bomb mesh + blinking light.
  if (state.bomb.status === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(state.bomb.x, 0.12, state.bomb.z);
    bombLightMat.color.setHex(0xffb454);
  } else if (state.bomb.status === 'planted') {
    const s = state.bomb.site;
    bombMesh.visible = true;
    bombMesh.position.set((s.x0 + s.x1) / 2, 0.12, (s.z0 + s.z1) / 2);
    bombLightMat.color.setHex(Math.floor(state.time * 4) % 2 === 0 ? 0xff5a4e : 0x330000);
  } else {
    bombMesh.visible = false;
  }

  // Banner lifetime.
  if (state.bannerT > 0) {
    state.bannerT -= dt;
    if (state.bannerT <= 0) state.banner = null;
  }

  // Prune old shot events (hearing window is 0.6 s).
  while (state.shotEvents.length > 0 && state.time - state.shotEvents[0].t > 0.7) state.shotEvents.shift();

  handleEvents();
  syncBotMeshes(state);
}

// ---- render --------------------------------------------------------------
const menuCam = { angle: 0 };
function render() {
  const p = state.player;
  if (state.phase === 'menu') {
    menuCam.angle += 0.0004;
    camera.position.set(Math.sin(menuCam.angle) * 26, 14, Math.cos(menuCam.angle) * 20);
    camera.lookAt(0, 1, 0);
  } else if (p.alive) {
    camera.position.set(p.body.x, eyeHeight(p.body), p.body.z);
    const shake = state.shakeT > 0 ? 0.03 * state.shakeT : 0;
    camera.rotation.order = 'YXZ';
    camera.rotation.set(
      p.body.pitch + p.recoil + (Math.random() - 0.5) * shake,
      p.body.yaw + (Math.random() - 0.5) * shake,
      0,
    );
    camera.fov = p.zoomed ? 32 : 74;
    camera.updateProjectionMatrix();
  } else {
    // Spectate a living teammate, or watch the yard from above.
    const mate = state.bots.find((b) => b.team === 'frost' && b.alive);
    if (mate) {
      camera.position.set(mate.body.x, eyeHeight(mate.body), mate.body.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(mate.body.pitch, mate.body.yaw, 0);
    } else {
      camera.position.set(0, 16, 0);
      camera.lookAt(0, 0, 0);
    }
  }
  // Viewmodel bob + recoil kick.
  const bob = state.moveSpeed > 0.5 ? Math.sin(state.time * 11) * 0.012 : 0;
  viewGun.position.set(0.3, -0.28 + bob, -0.55 + p.recoil * 2.2);
  viewGun.visible = p.alive && state.phase !== 'menu';
  renderer.render(scene, camera);
}

// ---- main loop -----------------------------------------------------------
let last = performance.now();
let acc = 0;
let frames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    step(STEP);
    acc -= STEP;
    n += 1;
  }
  if (n === 5) acc = 0;
  render();
  updateHud(state);
  frames += 1;
  if (SHOT && frames === 3) window.__shotReady = true;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- shot modes (deterministic stills for screenshots) -------------------
function setupShotMode() {
  document.getElementById('overlay').hidden = true;
  document.getElementById('matchend').hidden = true;
  startMatch(state);
  if (SHOT === 'start') {
    // Buy phase at the Frost spawn, looking down mid lane, teammates
    // fanned out 3-6 m ahead so the cover shows the squad, not one bot.
    state.player.body.x = -20;
    state.player.body.z = -2;
    state.player.body.yaw = -Math.PI / 2 - 0.15;
    state.player.body.pitch = 0;
    const mates = state.bots.filter((b) => b.team === 'frost');
    const spots = [[-17, -7], [-16, 1], [-18, 5]];
    mates.forEach((m, i) => {
      m.body.x = spots[i][0];
      m.body.z = spots[i][1];
      m.body.yaw = -Math.PI / 2;
    });
  } else if (SHOT === 'play') {
    state.phase = 'live';
    state.phaseT = 32;
    state.events.push({ type: 'liveStart' });
    state.player.body.x = -4;
    state.player.body.z = 2;
    state.player.body.yaw = -Math.PI / 2 - 0.3;
    state.player.hp = 100;
    // Stage a firefight at mid-range: two defenders hold the far side of
    // the yard, one teammate covers the player's flank.
    const foes = state.bots.filter((b) => b.team === 'glacier');
    foes[0].body.x = 12; foes[0].body.z = -4; foes[0].body.yaw = Math.PI / 2;
    foes[1].body.x = 14; foes[1].body.z = 6; foes[1].body.yaw = Math.PI / 2;
    const mates = state.bots.filter((b) => b.team === 'frost');
    mates[0].body.x = -7; mates[0].body.z = -3; mates[0].body.yaw = -Math.PI / 2;
    state.player.weapon = 'rifle';
    state.player.owned.rifle = true;
    state.player.mag = 30;
    state.player.reserve = 90;
    state.econ.money = 3200;
  } else if (SHOT === 'end') {
    state.wins = { frost: 4, glacier: 4 };
    state.round = 9;
    endRound(state, 'frost', 'Glacier team eliminated');
    state.player.body.x = 16;
    state.player.body.z = -12;
    state.player.body.yaw = Math.PI / 2 + 0.4;
  }
}

if (SHOT) {
  setupShotMode();
}

// ---- debug hooks for headless verification (not part of the game) --------
window.__frost = {
  state,
  input,
  teleport(x, z, yaw) {
    state.player.body.x = x;
    state.player.body.z = z;
    if (yaw !== undefined) state.player.body.yaw = yaw;
  },
  plantNow() {
    const site = state.world.sites.A;
    plantBomb(state.bomb, site);
    state.events.push({ type: 'planted', by: 'You', site: 'A' });
  },
  hurtPlayer(n) {
    damageActor(state.player, n, state.bots[3]);
  },
  killFoes() {
    for (const b of state.bots) if (b.team === 'glacier') damageActor(b, 999, state.player);
  },
  startLive() {
    state.phase = 'live';
    state.phaseT = 0;
    assignObjectives(state);
  },
};

requestAnimationFrame(loop);
