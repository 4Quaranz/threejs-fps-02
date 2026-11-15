// FROSTLINE — round and match state machine.
// One match is first to 5 rounds. Each round: a 12 s buy phase, up to 100 s
// live, then a short end banner. A round ends by elimination, by the charge
// exploding or being defused, or by the clock (defenders win on timeout
// unless the charge is planted). Events are pushed to state.events for the
// main loop to turn into banners and sounds.
import { awardRoundEnd } from './economy.js';
import { createBomb } from './bomb.js';

export const ROUND = {
  buyTime: 12,
  liveTime: 100,
  endTime: 4.5,
  winRounds: 5,
};

export function startMatch(state) {
  state.wins = { frost: 0, glacier: 0 };
  state.round = 0;
  state.matchWinner = null;
  state.econ.money = 800;
  state.econ.lossStreak = 0;
  startRound(state);
}

export function startRound(state) {
  state.round += 1;
  state.phase = 'buy';
  state.phaseT = 0;
  state.bomb = createBomb();
  state.kills.length = 0;
  state.banner = null;
  // Respawn everyone at their spawn, alive, and hand out fresh ammo.
  // Survivors keep their bought weapons; the fallen fall back to a pistol.
  const respawn = (actor, spawn, keptWeapon) => {
    actor.body.x = spawn.x;
    actor.body.z = spawn.z;
    actor.body.y = 0;
    actor.body.vy = 0;
    actor.body.vx = 0;
    actor.body.vz = 0;
    actor.body.yaw = actor.team === 'frost' ? -Math.PI / 2 : Math.PI / 2;
    actor.hp = 100;
    actor.alive = true;
    actor.weapon = keptWeapon;
    actor.mag = state.weapons[keptWeapon].mag;
    actor.reserve = state.weapons[keptWeapon].reserve;
    actor.reloading = false;
    actor.planting = false;
    actor.defusing = false;
  };
  const frostSpawns = state.world.spawns.frost;
  const glacierSpawns = state.world.spawns.glacier;
  respawn(state.player, frostSpawns[0], state.player.survived ? state.player.weapon : 'pistol');
  state.player.grenades = state.player.survived ? state.player.grenades : 0;
  state.player.survived = false;
  state.bots.forEach((bot, i) => {
    const spawn = bot.team === 'frost' ? frostSpawns[(i % 3) + 1] : glacierSpawns[i % 4];
    const kept = bot.survived ? bot.weapon : 'pistol';
    respawn(bot, spawn, kept);
    bot.survived = false;
    bot.state = 'route';
    bot.path = null;
    bot.pathIdx = 0;
    bot.holdT = 0;
    bot.target = null;
    bot.burstLeft = 0;
    bot.reactT = 0;
    bot.site = null;
    bot.lastKnown = null;
  });
  // The player carries the charge every round: the objective is theirs to play.
  state.bomb.carrier = 'player';
  state.events.push({ type: 'roundStart', round: state.round });
}

export function endRound(state, winner, reason) {
  if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
  state.wins[winner] += 1;
  const award = awardRoundEnd(state.econ, winner, 'frost');
  state.phase = 'roundEnd';
  state.phaseT = 0;
  state.roundReason = reason;
  state.roundWinner = winner;
  // Survivors are remembered so they keep their weapons next round.
  if (state.player.alive) state.player.survived = true;
  for (const bot of state.bots) if (bot.alive) bot.survived = true;
  state.events.push({ type: 'roundEnd', winner, reason, award });
  if (state.wins[winner] >= ROUND.winRounds) {
    state.phase = 'matchEnd';
    state.matchWinner = winner;
    state.events.push({ type: 'matchEnd', winner });
  }
}

function aliveCount(state, team) {
  let n = 0;
  if (team === 'frost' && state.player.alive) n += 1;
  for (const bot of state.bots) if (bot.team === team && bot.alive) n += 1;
  return n;
}

// Advance the phase clock and check the round-end conditions. Called once
// per fixed step from the main loop.
export function updateRounds(state, dt) {
  if (state.phase === 'menu' || state.phase === 'matchEnd') return;
  state.phaseT += dt;
  if (state.phase === 'buy' && state.phaseT >= ROUND.buyTime) {
    state.phase = 'live';
    state.phaseT = 0;
    state.events.push({ type: 'liveStart' });
    return;
  }
  if (state.phase === 'roundEnd' && state.phaseT >= ROUND.endTime) {
    startRound(state);
    return;
  }
  if (state.phase !== 'live') return;
  const frostAlive = aliveCount(state, 'frost');
  const glacierAlive = aliveCount(state, 'glacier');
  if (frostAlive === 0) {
    endRound(state, 'glacier', 'Frost team eliminated');
    return;
  }
  if (glacierAlive === 0) {
    endRound(state, 'frost', 'Glacier team eliminated');
    return;
  }
  if (state.phaseT >= ROUND.liveTime && state.bomb.status !== 'planted') {
    endRound(state, 'glacier', 'Time expired — charge never planted');
  }
}
