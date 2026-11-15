// FROSTLINE — shared mover for the player and the bots.
// One body shape for everyone: a circle on the ground with a velocity, a
// yaw, a jump height and a crouch state. Movement has acceleration and
// friction, so stopping to aim pays and sprinting sideways is sloppy.
import { collideCircle } from './world.js';

export const BODY = {
  radius: 0.42,
  eyeStand: 1.62,
  eyeCrouch: 1.12,
  walkSpeed: 4.3,
  crouchSpeed: 2.1,
  accelGround: 42,
  accelAir: 12,
  jumpSpeed: 5.4,
  gravity: 15,
};

export function createBody(x, z, yaw) {
  return {
    x, z, y: 0, vy: 0,
    vx: 0, vz: 0,
    yaw, pitch: 0,
    crouched: false,
    grounded: true,
  };
}

// input: { f: -1..1 forward, s: -1..1 strafe right, jump, crouch }
// dt in seconds. Mutates body in place, no allocation.
export function stepBody(body, input, dt, obstacles) {
  const speed = input.crouch ? BODY.crouchSpeed : BODY.walkSpeed;
  const sin = Math.sin(body.yaw);
  const cos = Math.cos(body.yaw);
  // Forward is -Z rotated by yaw; strafe is +X rotated by yaw.
  const wishX = (-sin * input.f + cos * input.s) * speed;
  const wishZ = (-cos * input.f - sin * input.s) * speed;
  const accel = body.grounded ? BODY.accelGround : BODY.accelAir;
  const k = Math.min(1, accel * dt);
  body.vx += (wishX - body.vx) * k;
  body.vz += (wishZ - body.vz) * k;

  body.x += body.vx * dt;
  body.z += body.vz * dt;
  collideCircle(body, BODY.radius, obstacles);

  body.crouched = !!input.crouch;
  if (input.jump && body.grounded) {
    body.vy = BODY.jumpSpeed;
    body.grounded = false;
  }
  if (!body.grounded) {
    body.vy -= BODY.gravity * dt;
    body.y += body.vy * dt;
    if (body.y <= 0) {
      body.y = 0;
      body.vy = 0;
      body.grounded = true;
    }
  }
}

export function eyeHeight(body) {
  return (body.crouched ? BODY.eyeCrouch : BODY.eyeStand) + body.y;
}

export function moveSpeed(body) {
  return Math.hypot(body.vx, body.vz);
}
