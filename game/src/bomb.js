// FROSTLINE — the objective: a frost charge to plant and defuse.
// The charge starts with the player (Frost attacks). Planting takes 3.5 s
// standing in a site; the fuse then runs 40 s. Defenders defuse in 5 s.
// If the carrier dies the charge drops where they fell and a teammate bot
// goes to pick it up. All timings are constants, all state lives in one
// plain object the round code reads.
export const BOMB = {
  plantTime: 3.5,
  fuseTime: 40,
  defuseTime: 5,
  pickupRadius: 1.6,
};

export function createBomb() {
  return {
    status: 'carried', // carried | dropped | planted | gone
    carrier: 'player', // 'player' or a bot id, null when dropped/planted
    x: 0,
    z: 0,
    site: null,
    progress: 0, // plant or defuse progress, 0..1
    fuse: 0,
    defuser: null,
    exploded: false,
    defused: false,
  };
}

export function dropBomb(bomb, x, z) {
  bomb.status = 'dropped';
  bomb.carrier = null;
  bomb.x = x;
  bomb.z = z;
  bomb.progress = 0;
  bomb.defuser = null;
}

export function plantBomb(bomb, site) {
  bomb.status = 'planted';
  bomb.carrier = null;
  bomb.site = site;
  bomb.progress = 0;
  bomb.fuse = BOMB.fuseTime;
  bomb.defuser = null;
}

// Called every fixed step while the round is live. Returns an event string
// ('exploded' | 'defused' | null) when the objective resolves.
export function updateBomb(bomb, dt) {
  if (bomb.status !== 'planted') return null;
  bomb.fuse -= dt;
  if (bomb.defuser) {
    bomb.progress += dt / BOMB.defuseTime;
    if (bomb.progress >= 1) {
      bomb.status = 'gone';
      bomb.defused = true;
      bomb.progress = 0;
      bomb.defuser = null;
      return 'defused';
    }
  }
  if (bomb.fuse <= 0) {
    bomb.status = 'gone';
    bomb.exploded = true;
    return 'exploded';
  }
  return null;
}
