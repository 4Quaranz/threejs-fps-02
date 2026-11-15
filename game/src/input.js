// FROSTLINE — keyboard and mouse input.
// Pointer lock on click; WASD to move, mouse to look, click to fire, R to
// reload, 1-5 to pick a weapon or grenade, E to plant/defuse, B for the buy
// menu, C or Ctrl to crouch, Space to jump. The look deltas are consumed
// once per frame by the main loop, so nothing is lost between frames.
export function createInput(canvas, onPlay) {
  const keys = new Set();
  // One-shot actions (buy, reload, throw) go here: keydown records the
  // press and the simulation consumes it, so a quick tap between two slow
  // frames is never lost. Held keys (move, crouch, interact) live in keys.
  const pressed = new Set();
  const input = {
    keys,
    pressed,
    lookDX: 0,
    lookDY: 0,
    firing: false,
    aiming: false,
    locked: false,
    shotMode: false,
    consumeLook() {
      const dx = this.lookDX;
      const dy = this.lookDY;
      this.lookDX = 0;
      this.lookDY = 0;
      return { dx, dy };
    },
  };

  const KEYMAP = {
    KeyW: 'forward',
    ArrowUp: 'forward',
    KeyS: 'back',
    ArrowDown: 'back',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',
    Space: 'jump',
    KeyC: 'crouch',
    ControlLeft: 'crouch',
    KeyE: 'interact',
    KeyR: 'reload',
    KeyG: 'throwGrenade',
    KeyB: 'buy',
    Digit1: 'w1',
    Digit2: 'w2',
    Digit3: 'w3',
    Digit4: 'w4',
    Digit5: 'w5',
  };

  window.addEventListener('keydown', (e) => {
    const action = KEYMAP[e.code];
    if (action) {
      if (action === 'jump' || action === 'reload' || action === 'throwGrenade') e.preventDefault();
      if (!e.repeat) {
        keys.add(action);
        pressed.add(action);
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    const action = KEYMAP[e.code];
    if (action) keys.delete(action);
  });
  window.addEventListener('blur', () => keys.clear());

  document.addEventListener('mousemove', (e) => {
    if (!input.locked && !input.shotMode) return;
    input.lookDX += e.movementX || 0;
    input.lookDY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      input.aiming = true;
      return;
    }
    if (e.button !== 0) return;
    if (input.locked || input.shotMode) input.firing = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  window.addEventListener('contextmenu', (e) => {
    if (input.locked || input.shotMode) e.preventDefault();
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
  });

  canvas.addEventListener('click', () => {
    if (!input.locked && !input.shotMode) {
      canvas.requestPointerLock?.();
      onPlay?.();
    }
  });

  return input;
}
