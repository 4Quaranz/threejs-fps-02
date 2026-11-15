// FROSTLINE — bot AI: seven opponents and teammates that route, hold,
// engage, plant and defuse.
// Each bot is a small state machine. It walks the waypoint graph to its
// objective, holds a sightline, and when it sees an enemy it stops, aims
// through a reaction delay, then fires in bursts with a skill-based spread.
// Gunfire is heard: a shot within earshot tells nearby enemies roughly
// where it came from. Bots never see through walls and never shoot through
// them — the same line-of-sight test the player is bound by.
import * as THREE from 'three';
import { TEAM_COLOR } from './palette.js';
import { createBody, stepBody, moveSpeed } from './player.js';
import { findPath, segmentBlocked, siteAt } from './world.js';
import { fireHitscan, spreadDir } from './combat.js';
import { weaponById } from './weapons.js';
import { plantBomb } from './bomb.js';

const BOT_NAMES = {
  frost: ['Vega', 'Mira', 'Sable'],
  glacier: ['Orin', 'Yuki', 'Bore', 'Kip'],
};
const SIGHT_RANGE = 42;
const HEAR_RANGE = 26;
const ENGAGE_FOV = 1.9; // radians of half-angle the bot notices

export function createBots(state, scene) {
  const bots = [];
  const mkMesh = (team) => {
    const group = new THREE.Group();
    const color = TEAM_COLOR[team];
    const suit = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: 0x22303e });
    const helm = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.95, 8), suit);
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), helm);
    head.position.y = 1.52;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.08, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x9fdcff }),
    );
    visor.position.set(0, 1.54, 0.2);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.7), dark);
    gun.position.set(0.25, 1.15, 0.3);
    group.add(body, head, visor, gun);
    group.userData.head = head;
    group.userData.body = body;
    scene.add(group);
    return group;
  };

  let id = 0;
  for (const team of ['frost', 'glacier']) {
    const count = team === 'frost' ? 3 : 4;
    for (let i = 0; i < count; i += 1) {
      const skill = 0.55 + state.rng.next() * 0.25;
      const bot = {
        id: id++,
        name: BOT_NAMES[team][i],
        team,
        body: createBody(0, 0, 0),
        hp: 100,
        alive: true,
        survived: false,
        weapon: 'pistol',
        mag: 12,
        reserve: Infinity,
        grenades: 0,
        reloading: false,
        reloadT: 0,
        planting: false,
        defusing: false,
        skill,
        state: 'route',
        path: null,
        pathIdx: 0,
        holdPos: null,
        holdT: 0,
        target: null,
        reactT: 0,
        burstLeft: 0,
        burstPauseT: 0,
        lastShotT: 0,
        site: null,
        lastKnown: null,
        mesh: mkMesh(team),
      };
      bots.push(bot);
    }
  }
  return bots;
}

function visibleEnemy(state, bot) {
  // Enemies only: frost bots hunt glacier bots; glacier bots hunt the
  // player and the frost bots. Teammates are never targets.
  const actors = bot.team === 'frost'
    ? state.bots.filter((b) => b.team === 'glacier')
    : [state.player, ...state.bots.filter((b) => b.team === 'frost')];
  let best = null;
  let bestD = Infinity;
  for (const a of actors) {
    if (!a.alive || a === bot) continue;
    const dx = a.body.x - bot.body.x;
    const dz = a.body.z - bot.body.z;
    const d = Math.hypot(dx, dz);
    if (d > SIGHT_RANGE) continue;
    // In front, unless very close (then heard/felt).
    const ang = Math.atan2(-dx, -dz);
    let diff = ang - bot.body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (d > 7 && Math.abs(diff) > ENGAGE_FOV) continue;
    if (segmentBlocked(bot.body.x, bot.body.z, a.body.x, a.body.z, state.world.obstacles)) continue;
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best ? { actor: best, dist: bestD } : null;
}

function aimAt(bot, tx, tz, ty) {
  const dx = tx - bot.body.x;
  const dz = tz - bot.body.z;
  bot.body.yaw = Math.atan2(-dx, -dz);
  const dist = Math.hypot(dx, dz);
  bot.body.pitch = Math.atan2(ty - 1.5, Math.max(dist, 0.01));
}

function botFire(state, bot, dt) {
  const w = weaponById(bot.weapon);
  bot.lastShotT -= dt;
  if (bot.lastShotT > 0) return;
  if (bot.mag <= 0) {
    bot.reloading = true;
    bot.reloadT = 1.6;
    return;
  }
  const target = bot.target;
  if (!target || !target.alive) return;
  const dist = Math.hypot(target.body.x - bot.body.x, target.body.z - bot.body.z);
  const moving = moveSpeed(target.body) > 1.5;
  const spread = w.spreadDeg + (1 - bot.skill) * 3.2 + dist * 0.04 + (moving ? 1.2 : 0);
  const dir = spreadDir(bot.body.yaw, bot.body.pitch, spread, state.rng);
  const res = fireHitscan(state, bot, dir, w);
  bot.mag -= 1;
  bot.lastShotT = w.rateMs / 1000;
  bot.burstLeft -= 1;
  state.shotEvents.push({ x: bot.body.x, z: bot.body.z, team: bot.team, t: state.time });
  const eyeY = 1.45;
  const end = res.hit
    ? { x: bot.body.x + dir.x * res.t, y: eyeY + dir.y * res.t, z: bot.body.z + dir.z * res.t }
    : { x: bot.body.x + dir.x * w.range, y: eyeY + dir.y * w.range, z: bot.body.z + dir.z * w.range };
  state.spawnTracer({ x: bot.body.x, y: eyeY, z: bot.body.z }, end, w.tracer);
  const hearDist = Math.hypot(state.player.body.x - bot.body.x, state.player.body.z - bot.body.z);
  state.audio.shot(bot.weapon, hearDist);
  if (res.hit) {
    state.damageActor(res.actor, res.damage, bot);
  }
}

function followPath(bot, dt, state) {
  if (!bot.path || bot.pathIdx >= bot.path.length) return true;
  const wp = bot.path[bot.pathIdx];
  const dx = wp.x - bot.body.x;
  const dz = wp.z - bot.body.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.7) {
    bot.pathIdx += 1;
    return bot.pathIdx >= bot.path.length;
  }
  bot.body.yaw = Math.atan2(-dx, -dz);
  stepBody(bot.body, { f: 1, s: 0, jump: false, crouch: false }, dt, state.world.obstacles);
  return false;
}

function routeTo(bot, state, tx, tz) {
  bot.path = findPath(state.world.nodes, bot.body.x, bot.body.z, tx, tz);
  bot.pathIdx = 0;
  bot.state = 'route';
}

function assignObjective(state, bot) {
  // Called at round start (live phase): pick a site and a job.
  if (bot.team === 'frost') {
    bot.site = state.rng.next() < 0.6 ? 'A' : 'B';
    const site = state.world.sites[bot.site];
    const gx = state.rng.range(site.x0 + 1, site.x1 - 1);
    const gz = state.rng.range(site.z0 + 1, site.z1 - 1);
    routeTo(bot, state, gx, gz);
  } else {
    bot.site = bot.id % 2 === 0 ? 'A' : 'B';
    const site = state.world.sites[bot.site];
    bot.holdPos = {
      x: state.rng.range(site.x0, site.x1 - 2),
      z: state.rng.range(site.z0 + 1, site.z1 - 1),
    };
    routeTo(bot, state, bot.holdPos.x, bot.holdPos.z);
  }
}

function updateOneBot(state, bot, dt) {
  if (!bot.alive) return;
  if (bot.reloading) {
    bot.reloadT -= dt;
    if (bot.reloadT <= 0) {
      const w = weaponById(bot.weapon);
      const need = w.mag - bot.mag;
      const take = Math.min(need, bot.reserve === Infinity ? need : bot.reserve);
      bot.mag += take;
      if (bot.reserve !== Infinity) bot.reserve -= take;
      bot.reloading = false;
    }
    return;
  }

  // Hearing: recent enemy gunfire gives a rough position to investigate.
  for (const s of state.shotEvents) {
    if (s.team === bot.team || state.time - s.t > 0.6) continue;
    const d = Math.hypot(s.x - bot.body.x, s.z - bot.body.z);
    if (d < HEAR_RANGE) bot.lastKnown = { x: s.x, z: s.z, t: state.time };
  }

  const seen = state.phase === 'live' ? visibleEnemy(state, bot) : null;
  if (seen) {
    if (bot.target !== seen.actor) {
      bot.target = seen.actor;
      bot.reactT = 0.5 + (1 - bot.skill) * 0.5 + state.rng.next() * 0.3;
      bot.burstLeft = 0;
    }
    aimAt(bot, seen.actor.body.x, seen.actor.body.z, 1.3);
    if (bot.reactT > 0) {
      bot.reactT -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstPauseT -= dt;
      if (bot.burstPauseT > 0) return;
      bot.burstLeft = 3 + Math.floor(state.rng.next() * 3);
      bot.burstPauseT = 0.6 + state.rng.next() * 0.6;
    }
    botFire(state, bot, dt);
    return;
  }
  bot.target = null;

  // Objective behaviour when nothing is in sight.
  if (state.phase !== 'live') return;
  const bomb = state.bomb;

  // Pick up a dropped charge.
  if (bot.team === 'frost' && bomb.status === 'dropped') {
    const d = Math.hypot(bomb.x - bot.body.x, bomb.z - bot.body.z);
    if (d < 1.6) {
      bomb.status = 'carried';
      bomb.carrier = bot.id;
      state.events.push({ type: 'bombPickup', by: bot.name });
    } else if (bot.state !== 'pickup') {
      bot.state = 'pickup';
      routeTo(bot, state, bomb.x, bomb.z);
    }
    if (bot.state === 'pickup') {
      if (followPath(bot, dt, state)) bot.state = 'route';
      return;
    }
  }

  // Carrier plants when the site is clear.
  if (bot.team === 'frost' && bomb.status === 'carried' && bomb.carrier === bot.id) {
    const site = siteAt(bot.body.x, bot.body.z);
    if (site) {
      bot.planting = true;
      bomb.progress += dt / 3.5;
      if (bomb.progress >= 1) {
        plantBomb(bomb, site);
        bot.planting = false;
        state.events.push({ type: 'planted', by: bot.name, site: site.id });
      }
      return;
    }
    bot.planting = false;
  } else {
    bot.planting = false;
  }

  // Defenders rotate to a planted charge and defuse when it is safe.
  if (bot.team === 'glacier' && bomb.status === 'planted') {
    // bomb.site is the site object itself (stored by plantBomb).
    const site = bomb.site;
    const d = Math.hypot((site.x0 + site.x1) / 2 - bot.body.x, (site.z0 + site.z1) / 2 - bot.body.z);
    if (d < 2.5) {
      bot.defusing = true;
      bomb.defuser = bot.id;
      return;
    }
    bot.defusing = false;
    if (bot.state !== 'rotate') {
      bot.state = 'rotate';
      routeTo(bot, state, (site.x0 + site.x1) / 2, (site.z0 + site.z1) / 2);
    }
    followPath(bot, dt, state);
    return;
  }
  bot.defusing = false;

  if (bot.state === 'route') {
    if (followPath(bot, dt, state)) {
      bot.state = 'hold';
      bot.holdT = 2 + state.rng.next() * 4;
    }
    return;
  }
  if (bot.state === 'hold') {
    bot.holdT -= dt;
    // Slowly scan the room while holding.
    bot.body.yaw += Math.sin(state.time * 0.7 + bot.id) * 0.25 * dt;
    if (bot.holdT <= 0) {
      if (bot.team === 'frost') {
        // Drift to a new spot inside the site or mid.
        const s = state.world.sites[bot.site];
        routeTo(bot, state, state.rng.range(s.x0, s.x1), state.rng.range(s.z0, s.z1));
      } else if (bot.lastKnown && state.time - bot.lastKnown.t < 6) {
        routeTo(bot, state, bot.lastKnown.x, bot.lastKnown.z);
      } else {
        bot.holdT = 3 + state.rng.next() * 4;
      }
    }
    return;
  }
  // pickup / rotate states walk their path.
  followPath(bot, dt, state);
}

export function updateBots(state, dt) {
  for (const bot of state.bots) updateOneBot(state, bot, dt);
}

export function assignObjectives(state) {
  for (const bot of state.bots) assignObjective(state, bot);
}

export function syncBotMeshes(state) {
  for (const bot of state.bots) {
    const m = bot.mesh;
    m.position.set(bot.body.x, bot.body.y, bot.body.z);
    if (bot.alive) {
      m.rotation.set(0, bot.body.yaw, 0);
      m.visible = true;
    } else {
      m.rotation.set(0, bot.body.yaw, Math.PI / 2);
      m.position.y = 0.25;
    }
  }
}
