// FROSTLINE — weapon and grenade definitions.
// Four guns plus one grenade. Every number the combat code needs lives here:
// damage, headshot multiplier, magazine, fire rate, spread, recoil, price.
// Spread is in degrees and grows while the shooter moves or fires in a row.
export const WEAPONS = {
  pistol: {
    id: 'pistol',
    name: 'Icicle P9',
    kind: 'pistol',
    damage: 30,
    headMult: 3,
    mag: 12,
    reserve: Infinity,
    auto: false,
    rateMs: 300,
    spreadDeg: 0.6,
    moveSpreadDeg: 1.4,
    recoilDeg: 0.35,
    price: 0,
    range: 70,
    tracer: 0xffe9a8,
  },
  rifle: {
    id: 'rifle',
    name: 'Frostbite VK-7',
    kind: 'rifle',
    damage: 34,
    headMult: 3,
    mag: 30,
    reserve: 90,
    auto: true,
    rateMs: 100,
    spreadDeg: 0.55,
    moveSpreadDeg: 1.9,
    recoilDeg: 0.5,
    price: 2700,
    range: 90,
    tracer: 0x9fdcff,
  },
  smg: {
    id: 'smg',
    name: 'Snowcat K9',
    kind: 'smg',
    damage: 26,
    headMult: 3,
    mag: 32,
    reserve: 96,
    auto: true,
    rateMs: 66,
    spreadDeg: 1.1,
    moveSpreadDeg: 2.3,
    recoilDeg: 0.35,
    price: 1500,
    range: 55,
    tracer: 0xbff3ff,
  },
  marksman: {
    id: 'marksman',
    name: 'Glacier LW-88',
    kind: 'marksman',
    damage: 88,
    headMult: 2,
    mag: 5,
    reserve: 15,
    auto: false,
    rateMs: 950,
    spreadDeg: 0.12,
    moveSpreadDeg: 2.6,
    recoilDeg: 1.7,
    price: 4750,
    range: 140,
    tracer: 0xffffff,
    zoomFov: 32,
  },
};

export const WEAPON_ORDER = ['rifle', 'smg', 'marksman', 'pistol'];

export const GRENADE = {
  id: 'grenade',
  name: 'Shard Grenade',
  price: 300,
  maxCarry: 2,
  radius: 5.5,
  maxDamage: 85,
  fuseMs: 2400,
};

export function weaponById(id) {
  return WEAPONS[id] ?? WEAPONS.pistol;
}
