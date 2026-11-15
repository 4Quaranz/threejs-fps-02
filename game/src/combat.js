// FROSTLINE — hitscan combat shared by the player and the bots.
// A shot is a ray from the shooter's eye. It stops at the first wall or at
// the first enemy body it crosses: a head sphere (small, high damage) or a
// body sphere (big). Walls are tested with the same boxes the world renders,
// so a bullet never passes through cover you can see.
import { rayHitWall } from './world.js';
import { eyeHeight } from './player.js';

const HEAD_Y = 1.52;
const HEAD_R = 0.24;
const BODY_Y = 0.95;
const BODY_R = 0.5;

// Ray vs sphere; returns the distance along the ray or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Test one actor (player or bot) against a ray. Returns { t, part } or null.
// The spheres sit above the actor's feet (body.y), lower when crouched.
export function actorHit(origin, dir, maxDist, target) {
  if (!target.alive) return null;
  const b = target.body;
  const headY = b.y + (b.crouched ? 1.02 : HEAD_Y);
  const bodyY = b.y + (b.crouched ? 0.6 : BODY_Y);
  const th = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
    b.x, headY, b.z, HEAD_R);
  const tb = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
    b.x, bodyY, b.z, BODY_R);
  let t = Infinity;
  let part = null;
  if (th < t) {
    t = th;
    part = 'head';
  }
  if (tb < t) {
    t = tb;
    part = 'body';
  }
  if (t === Infinity || t > maxDist) return null;
  return { t, part };
}

// Fire one hitscan shot. shooter and the actors list share the shape
// { team, body, alive }. Returns { hit, head, actor, damage, wallT }.
// The caller applies damage and effects; this function only resolves.
export function fireHitscan(state, shooter, dir, weapon) {
  const eye = {
    x: shooter.body.x,
    y: eyeHeight(shooter.body),
    z: shooter.body.z,
  };
  const maxDist = weapon.range;
  const wallT = rayHitWall(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxDist, state.world.obstacles);
  let best = null;
  let bestActor = null;
  const actors = [state.player, ...state.bots];
  for (const actor of actors) {
    if (actor === shooter || actor.team === shooter.team || !actor.alive) continue;
    const hit = actorHit(eye, dir, maxDist, actor);
    if (hit && hit.t < wallT && (!best || hit.t < best.t)) {
      best = hit;
      bestActor = actor;
    }
  }
  if (!best) return { hit: false, wallT };
  const damage = best.part === 'head' ? weapon.damage * weapon.headMult : weapon.damage;
  return { hit: true, head: best.part === 'head', actor: bestActor, damage, t: best.t };
}

// Direction from yaw/pitch with a random cone spread (degrees), using the
// state's seeded RNG. Returns a fresh {x,y,z} unit vector.
export function spreadDir(yaw, pitch, spreadDeg, rng) {
  const spread = (spreadDeg * Math.PI) / 180;
  const a = rng.next() * Math.PI * 2;
  const r = Math.sqrt(rng.next()) * spread;
  const dy = Math.sin(pitch) + Math.sin(a) * r;
  const dx = -Math.sin(yaw) * Math.cos(pitch) + Math.cos(a) * r * Math.cos(yaw);
  const dz = -Math.cos(yaw) * Math.cos(pitch) - Math.cos(a) * r * Math.sin(yaw);
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}
