// FROSTLINE — the map "Frost Yard".
// A 46 x 36 m arctic yard: attackers spawn west, defenders hold the east.
// Three lanes (north / mid / south) lead to two plant sites, Glacier (A,
// north-east) and Harbor (B, south-east). Walls and crates are axis-aligned
// boxes; the same list drives rendering, movement collision, line of sight
// and bullet blocking, so what you see is what the simulation uses.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = {
  minX: -23,
  maxX: 23,
  minZ: -18,
  maxZ: 18,
  wallHeight: 4.5,
};

// Every obstacle: { x0, z0, x1, z1, h, kind } — kind 'wall' blocks sight,
// kind 'crate' is low cover (blocks movement, not sight over the top).
function obstacleList() {
  const walls = [
    // Outer shell.
    { x0: -24, z0: -19, x1: 24, z1: -18, h: 4.5, kind: 'wall' },
    { x0: -24, z0: 18, x1: 24, z1: 19, h: 4.5, kind: 'wall' },
    { x0: -24, z0: -19, x1: -23, z1: 19, h: 4.5, kind: 'wall' },
    { x0: 23, z0: -19, x1: 24, z1: 19, h: 4.5, kind: 'wall' },
    // West half: two vertical fins split the lanes apart.
    { x0: -12.5, z0: -18, x1: -11.5, z1: -9, h: 3.0, kind: 'wall' },
    { x0: -12.5, z0: 3, x1: -11.5, z1: 18, h: 3.0, kind: 'wall' },
    // Mid field: staggered fins force crossfire angles.
    { x0: -0.5, z0: -14, x1: 0.5, z1: -6, h: 3.0, kind: 'wall' },
    { x0: -0.5, z0: 6, x1: 0.5, z1: 14, h: 3.0, kind: 'wall' },
    { x0: 7.5, z0: -18, x1: 8.5, z1: -12, h: 3.0, kind: 'wall' },
    { x0: 7.5, z0: 12, x1: 8.5, z1: 18, h: 3.0, kind: 'wall' },
    // Site mouths: one gap each, so a plant is a fight over a doorway.
    { x0: 13.5, z0: -17, x1: 14.5, z1: -11, h: 3.0, kind: 'wall' },
    { x0: 13.5, z0: 11, x1: 14.5, z1: 17, h: 3.0, kind: 'wall' },
    // Site back cover.
    { x0: 18, z0: -16.5, x1: 22, z1: -15.5, h: 2.2, kind: 'wall' },
    { x0: 18, z0: 15.5, x1: 22, z1: 16.5, h: 2.2, kind: 'wall' },
  ];
  const crates = [
    { x0: -17, z0: -13, x1: -15, z1: -11, h: 1.2, kind: 'crate' },
    { x0: -17, z0: 11, x1: -15, z1: 13, h: 1.2, kind: 'crate' },
    { x0: -5, z0: -15, x1: -3, z1: -13, h: 1.2, kind: 'crate' },
    { x0: -5, z0: 13, x1: -3, z1: 15, h: 1.2, kind: 'crate' },
    { x0: 3.5, z0: -5, x1: 5.5, z1: -3, h: 1.2, kind: 'crate' },
    { x0: 3.5, z0: 3, x1: 5.5, z1: 5, h: 1.2, kind: 'crate' },
    { x0: 9.5, z0: -5, x1: 11.5, z1: -3, h: 1.2, kind: 'crate' },
    { x0: 9.5, z0: 3, x1: 11.5, z1: 5, h: 1.2, kind: 'crate' },
    { x0: 17, z0: -13.5, x1: 19, z1: -11.5, h: 1.2, kind: 'crate' },
    { x0: 17, z0: 11.5, x1: 19, z1: 13.5, h: 1.2, kind: 'crate' },
    { x0: -1.5, z0: -1.5, x1: 1.5, z1: 1.5, h: 1.4, kind: 'crate' },
    { x0: -22, z0: 6, x1: -20, z1: 8, h: 1.2, kind: 'crate' },
  ];
  return walls.concat(crates);
}

export const SITES = {
  A: { id: 'A', name: 'Glacier', x0: 14.5, z0: -17, x1: 22.5, z1: -8, color: PALETTE.siteA },
  B: { id: 'B', name: 'Harbor', x0: 14.5, z0: 8, x1: 22.5, z1: 17, color: PALETTE.siteB },
};

export const SPAWNS = {
  frost: [
    { x: -21, z: -4 },
    { x: -21, z: 0 },
    { x: -21, z: 4 },
    { x: -19, z: -2 },
  ],
  glacier: [
    { x: 16, z: -13 },
    { x: 11, z: -9 },
    { x: 16, z: 13 },
    { x: 11, z: 9 },
  ],
};

// Waypoint graph: bots walk node to node. Edges link nodes whose straight
// segment clears every wall (computed once at build time).
const WAYPOINTS = [
  [-21, -4], [-21, 0], [-21, 4], [-16, -12], [-16, 0], [-16, 12],
  [-8, -13], [-8, -4], [-8, 4], [-8, 13], [-3, -9], [-3, 0], [-3, 9],
  [4, -9], [4, 0], [4, 9], [10, -13], [10, -4], [10, 4], [10, 13],
  [13, -9], [13, 0], [13, 9], [18, -13], [18, 0], [18, 13],
  [20, -5], [20, 5],
];

function pointInObstacle(x, z, o, pad) {
  return x > o.x0 - pad && x < o.x1 + pad && z > o.z0 - pad && z < o.z1 + pad;
}

// True when the segment (x0,z0)-(x1,z1) crosses a sight-blocking wall.
export function segmentBlocked(x0, z0, x1, z1, obstacles) {
  for (const o of obstacles) {
    if (o.kind !== 'wall') continue;
    if (segmentHitsBox(x0, z0, x1, z1, o)) return true;
  }
  return false;
}

function segmentHitsBox(x0, z0, x1, z1, o) {
  // Slab test in 2D, with a small margin so bots keep off the walls.
  const dx = x1 - x0;
  const dz = z1 - z0;
  let tmin = 0;
  let tmax = 1;
  const axes = [
    [dx, o.x0 - 0.05 - x0, o.x1 + 0.05 - x0],
    [dz, o.z0 - 0.05 - z0, o.z1 + 0.05 - z0],
  ];
  for (const [d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (lo > 0 || hi < 0) return false;
    } else {
      let t1 = lo / d;
      let t2 = hi / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

// Ray (origin + t*dir) against a 3D box; returns the smallest t in
// [0, maxDist] or Infinity. Used to stop bullets at walls.
export function rayHitBox(ox, oy, oz, dx, dy, dz, maxDist, o) {
  let tmin = 0;
  let tmax = maxDist;
  const tests = [
    [dx, o.x0 - ox, o.x1 - ox],
    [dy, 0 - oy, o.h - oy],
    [dz, o.z0 - oz, o.z1 - oz],
  ];
  for (const [d, lo, hi] of tests) {
    if (Math.abs(d) < 1e-9) {
      if (lo > 0 || hi < 0) return Infinity;
    } else {
      let t1 = lo / d;
      let t2 = hi / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function rayHitWall(ox, oy, oz, dx, dy, dz, maxDist, obstacles) {
  let best = Infinity;
  for (const o of obstacles) {
    const t = rayHitBox(ox, oy, oz, dx, dy, dz, maxDist, o);
    if (t < best) best = t;
  }
  return best;
}

// Push a circle (x, z, radius) out of every obstacle it overlaps.
export function collideCircle(p, radius, obstacles) {
  for (const o of obstacles) {
    const cx = Math.max(o.x0, Math.min(p.x, o.x1));
    const cz = Math.max(o.z0, Math.min(p.z, o.z1));
    const ddx = p.x - cx;
    const ddz = p.z - cz;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      p.x = cx + (ddx / d) * radius;
      p.z = cz + (ddz / d) * radius;
    } else {
      // Centre inside the box: push out along the smallest penetration.
      const pl = p.x - o.x0 + radius;
      const pr = o.x1 - p.x + radius;
      const pt = p.z - o.z0 + radius;
      const pb = o.z1 - p.z + radius;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) p.x = o.x0 - radius;
      else if (m === pr) p.x = o.x1 + radius;
      else if (m === pt) p.z = o.z0 - radius;
      else p.z = o.z1 + radius;
    }
  }
  p.x = Math.max(MAP.minX + 0.5, Math.min(MAP.maxX - 0.5, p.x));
  p.z = Math.max(MAP.minZ + 0.5, Math.min(MAP.maxZ - 0.5, p.z));
}

export function siteAt(x, z) {
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s;
  }
  return null;
}

function buildWaypoints(obstacles) {
  const nodes = WAYPOINTS.map(([x, z]) => ({ x, z, links: [] }));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > 10.5) continue;
      if (segmentBlocked(a.x, a.z, b.x, b.z, obstacles)) continue;
      a.links.push(j);
      b.links.push(i);
    }
  }
  return nodes;
}

function nearestNode(nodes, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Breadth-first path from (x,z) to (tx,tz); returns waypoints to follow.
export function findPath(nodes, x, z, tx, tz) {
  const start = nearestNode(nodes, x, z);
  const goal = nearestNode(nodes, tx, tz);
  if (start === goal) return [{ x: tx, z: tz }];
  const prev = new Array(nodes.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === goal) break;
    for (const n of nodes[cur].links) {
      if (prev[n] === -1) {
        prev[n] = cur;
        queue.push(n);
      }
    }
  }
  if (prev[goal] === -1) return [{ x: tx, z: tz }];
  const path = [];
  let cur = goal;
  while (cur !== start) {
    path.push({ x: nodes[cur].x, z: nodes[cur].z });
    cur = prev[cur];
  }
  path.reverse();
  path.push({ x: tx, z: tz });
  return path;
}

function snowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#dfe9f2';
  ctx.fillRect(0, 0, 512, 512);
  // Speckled drifts.
  for (let i = 0; i < 2600; i += 1) {
    const v = 200 + Math.floor(Math.random() * 55);
    ctx.fillStyle = `rgba(${v}, ${v + 4}, ${v + 10}, 0.5)`;
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, s, s);
  }
  // Faint blue ice patches.
  for (let i = 0; i < 26; i += 1) {
    ctx.fillStyle = 'rgba(127, 196, 232, 0.10)';
    ctx.beginPath();
    ctx.ellipse(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 60, 12 + Math.random() * 40, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Yard grid lines, subtle.
  ctx.strokeStyle = 'rgba(120, 150, 180, 0.18)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo((i * 512) / 4, 0);
    ctx.lineTo((i * 512) / 4, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, (i * 512) / 4);
    ctx.lineTo(512, (i * 512) / 4);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildWorld(scene) {
  const obstacles = obstacleList();
  const nodes = buildWaypoints(obstacles);

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, PALETTE.fogNear, PALETTE.fogFar);

  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 1.6);
  sun.position.set(18, 30, 12);
  scene.add(sun);

  // Floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 38),
    new THREE.MeshLambertMaterial({ map: snowTexture() }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const wallMat = new THREE.MeshLambertMaterial({ color: PALETTE.wall });
  const wallTopMat = new THREE.MeshLambertMaterial({ color: PALETTE.wallTop });
  const crateMat = new THREE.MeshLambertMaterial({ color: PALETTE.crate });
  const crateEdgeMat = new THREE.MeshLambertMaterial({ color: PALETTE.crateEdge });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  for (const o of obstacles) {
    const w = o.x1 - o.x0;
    const d = o.z1 - o.z0;
    const mesh = new THREE.Mesh(boxGeo, o.kind === 'crate' ? crateMat : wallMat);
    mesh.scale.set(w, o.h, d);
    mesh.position.set((o.x0 + o.x1) / 2, o.h / 2, (o.z0 + o.z1) / 2);
    scene.add(mesh);
    if (o.kind === 'wall') {
      const cap = new THREE.Mesh(boxGeo, wallTopMat);
      cap.scale.set(w + 0.08, 0.18, d + 0.08);
      cap.position.set((o.x0 + o.x1) / 2, o.h + 0.09, (o.z0 + o.z1) / 2);
      scene.add(cap);
    } else {
      const rim = new THREE.Mesh(boxGeo, crateEdgeMat);
      rim.scale.set(w + 0.06, 0.1, d + 0.06);
      rim.position.set((o.x0 + o.x1) / 2, o.h + 0.05, (o.z0 + o.z1) / 2);
      scene.add(rim);
    }
  }

  // Site floor markings: a translucent tinted pad plus a corner frame.
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(s.x1 - s.x0, s.z1 - s.z0),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.16 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set((s.x0 + s.x1) / 2, 0.02, (s.z0 + s.z1) / 2);
    scene.add(pad);
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(s.x1 - s.x0, s.z1 - s.z0),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    frame.rotation.x = -Math.PI / 2;
    frame.position.set((s.x0 + s.x1) / 2, 0.03, (s.z0 + s.z1) / 2);
    // Frame only: draw as a wireframe box outline instead.
    frame.visible = false;
    scene.add(frame);
  }

  // Icicles under the tall fins: small cones, cheap and very arctic.
  const iceMat = new THREE.MeshLambertMaterial({ color: PALETTE.ice, transparent: true, opacity: 0.85 });
  const coneGeo = new THREE.ConeGeometry(0.16, 0.9, 6);
  for (const [x, z] of [[-12, -13], [-12, 8], [0, -10], [0, 10], [8, -15], [8, 15], [14, -14], [14, 14]]) {
    const cone = new THREE.Mesh(coneGeo, iceMat);
    cone.rotation.x = Math.PI;
    cone.position.set(x, 2.55, z);
    scene.add(cone);
  }

  // Aurora ribbons high above the yard: two long translucent planes.
  const auroraMat = new THREE.MeshBasicMaterial({
    color: 0x86efc8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
  });
  for (const [x, y, z, ry] of [[-6, 26, -14, 0.5], [10, 30, 10, -0.4]]) {
    const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(46, 7), auroraMat);
    ribbon.position.set(x, y, z);
    ribbon.rotation.y = ry;
    scene.add(ribbon);
  }

  // Floodlight poles at the four corners of the mid yard.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2e4258 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 6);
  const lampGeo = new THREE.BoxGeometry(0.9, 0.25, 0.25);
  for (const [x, z] of [[-20, -15], [-20, 15], [20, -15], [20, 15]]) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 3, z);
    scene.add(pole);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(x, 6.05, z);
    scene.add(lamp);
  }

  return { obstacles, nodes, sites: SITES, spawns: SPAWNS };
}
