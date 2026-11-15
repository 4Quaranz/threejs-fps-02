// FROSTLINE — palette and look constants.
// One cold arctic palette for the whole game: snow, ice, steel and a single
// warm amber accent. Every module imports colours from here so the scene,
// the HUD and the tracers all agree.
export const PALETTE = {
  sky: 0x9fc4dd,
  fog: 0xa9c6de,
  fogNear: 28,
  fogFar: 95,
  ground: 0xdfe9f2,
  groundLine: 0xb9cddd,
  wall: 0x8fa9c4,
  wallTop: 0xc7d9ea,
  crate: 0x6f87a3,
  crateEdge: 0x2e4258,
  ice: 0x7fc4e8,
  siteA: 0x4fc3f7,
  siteB: 0xffb454,
  frost: 0x59c2ff, // attackers (player team)
  glacier: 0xff9f43, // defenders
  accent: 0xffb454,
  ink: 0xeaf3fa,
  muted: 0x9db4c6,
  danger: 0xff5a4e,
  ok: 0x7ee2a8,
  hemiSky: 0xcfe4f5,
  hemiGround: 0x5d7488,
  sun: 0xfff2d8,
};

export const TEAM = {
  FROST: 'frost',
  GLACIER: 'glacier',
};

export const TEAM_NAME = {
  frost: 'Frost',
  glacier: 'Glacier',
};

export const TEAM_COLOR = {
  frost: PALETTE.frost,
  glacier: PALETTE.glacier,
};
