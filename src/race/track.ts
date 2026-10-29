import { TAU, clamp, rnd, wrapAngle } from '../engine/util';

type RGB = [number, number, number];

/** Colours that make a track look like somewhere: ground speckle and tree shading. */
export interface Theme {
  grass: { a: RGB; b: RGB; dark: RGB; light: RGB };
  tree: { shadow: RGB; rim: RGB; light: RGB; dark: RGB; mid: RGB };
}

/** Everything that makes one track different from another. `buildWorld(track)` does the rest. */
export interface Track {
  id: string;
  name: string;
  /** World size in pixels. The camera is 320×200 and scrolls inside it. */
  width: number;
  height: number;
  /** Closed loop of control points (Catmull-Rom). Point 0 is the start line; keep a straight run of ~90px before it for the grid. */
  cp: [number, number][];
  laps: number;
  halfWidth: number; // half road width on the straights
  cornerExtra: number; // how much wider each side gets in the sharpest corners
  trees: number;
  lake?: { x: number; y: number; rx: number; ry: number };
  theme: Theme;
}

export interface Sample {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}
export interface Tree {
  x: number;
  y: number;
  r: number;
}

export const GRASS = 0;
export const ASPHALT = 1;
export const CURB = 2;
export const SOLID = 3;
export const WATER = 4;

export interface World {
  track: Track;
  w: number;
  h: number;
  S: Sample[];
  N: number;
  aiSpd: Float32Array;
  hw: Float32Array; // half road width per sample (wider in corners so there is room to drift)
  base: ImageData;
  surf: Uint8Array; // GRASS, ASPHALT, CURB, SOLID or WATER
  trees: Tree[];
  mini: HTMLCanvasElement;
}

const worlds = new Map<string, World>();

/** Tracks are expensive to paint, so each is built once per page load and shared by every race. */
export function getWorld(track: Track): World {
  let w = worlds.get(track.id);
  if (!w) worlds.set(track.id, (w = buildWorld(track)));
  return w;
}

export function surfAt(world: World, x: number, y: number) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return GRASS;
  return world.surf[y * world.w + x];
}

/** Closest centre-line sample to (x, y) within a window around `from`: cheap per-frame progress tracking. */
export function nearestIdx(world: World, x: number, y: number, from: number, back = 20, fwd = 50) {
  const { S, N } = world;
  let bi = from;
  let bd = 1e18;
  for (let k = -back; k <= fwd; k++) {
    const i = (((from + k) % N) + N) % N;
    const s = S[i];
    const dd = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (dd < bd) {
      bd = dd;
      bi = i;
    }
  }
  return bi;
}

/** Closest centre-line sample anywhere on the track. */
export function globalIdx(world: World, x: number, y: number) {
  const { S, N } = world;
  let bi = 0;
  let bd = 1e18;
  for (let i = 0; i < N; i++) {
    const dd = (S[i].x - x) ** 2 + (S[i].y - y) ** 2;
    if (dd < bd) {
      bd = dd;
      bi = i;
    }
  }
  return bi;
}

/* ------------------------------------------------------------------ */
/* Centre line                                                         */
/* ------------------------------------------------------------------ */

function cr(a: number, b: number, c: number, d: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

/** Smooth the control points into samples spaced 4px apart, each with tangent and normal. */
export function sampleCenterline(cp: [number, number][]) {
  const dense: [number, number][] = [];
  for (let i = 0; i < cp.length; i++) {
    const p0 = cp[(i - 1 + cp.length) % cp.length];
    const p1 = cp[i];
    const p2 = cp[(i + 1) % cp.length];
    const p3 = cp[(i + 2) % cp.length];
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      dense.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  const S: Sample[] = [];
  let acc = 0;
  S.push({ x: dense[0][0], y: dense[0][1], tx: 0, ty: 0, nx: 0, ny: 0 });
  for (let i = 1; i <= dense.length; i++) {
    const a: [number, number] = [dense[i - 1][0], dense[i - 1][1]];
    const b = dense[i % dense.length];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc + seg >= 4) {
      const t = (4 - acc) / seg;
      const nx = a[0] + (b[0] - a[0]) * t;
      const ny = a[1] + (b[1] - a[1]) * t;
      S.push({ x: nx, y: ny, tx: 0, ty: 0, nx: 0, ny: 0 });
      a[0] = nx;
      a[1] = ny;
      seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      acc = 0;
    }
    acc += seg;
  }
  const N = S.length;
  for (let i = 0; i < N; i++) {
    const a = S[(i - 1 + N) % N];
    const b = S[(i + 1) % N];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    S[i].tx = (b.x - a.x) / l;
    S[i].ty = (b.y - a.y) / l;
    S[i].nx = -S[i].ty;
    S[i].ny = S[i].tx;
  }
  return { S, N };
}

/** Heading change over the next 18 samples at each point. */
function turnAhead(S: Sample[]) {
  const N = S.length;
  const turn = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.atan2(S[i].ty, S[i].tx);
    const b = Math.atan2(S[(i + 18) % N].ty, S[(i + 18) % N].tx);
    turn[i] = Math.abs(wrapAngle(b - a));
  }
  return turn;
}

/** Target speed for AI cars: slower before sharp corners, looking 26 samples ahead for the tightest one. */
function aiSpeeds(S: Sample[]) {
  const N = S.length;
  const turn = turnAhead(S);
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) raw[i] = 4.0 - clamp(turn[i] / 1.25, 0, 1) * 2.2;
  const aiSpd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = 9;
    for (let k = 0; k < 26; k++) m = Math.min(m, raw[(i + k) % N]);
    aiSpd[i] = m;
  }
  return aiSpd;
}

/** The road widens in corners: how sharply it turns ahead, spread out smoothly. */
function roadWidths(S: Sample[], half: number, extra: number) {
  const N = S.length;
  const turnRaw = turnAhead(S);
  const turn = new Float32Array(N);
  for (let i = 0; i < N; i++) turn[i] = clamp(turnRaw[i] / 1.0, 0, 1);
  const peak = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let k = -14; k <= 22; k++) m = Math.max(m, turn[(i + k + N) % N]);
    peak[i] = m;
  }
  const hw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = -12; k <= 12; k++) sum += peak[(i + k + N) % N];
    hw[i] = half + extra * (sum / 25);
  }
  hw[0] = half;
  return hw;
}

/* ------------------------------------------------------------------ */
/* Painting                                                            */
/* ------------------------------------------------------------------ */

type Put = (x: number, y: number, c: number[], s?: number) => void;

/** Road, curbs and ground texture. Returns the pixels, the surface map and a pixel setter that writes to both. */
function paintTerrain(track: Track, S: Sample[], hw: Float32Array) {
  const { width: WW, height: WH, theme } = track;
  const N = S.length;
  const cv = document.createElement('canvas');
  cv.width = WW;
  cv.height = WH;
  const w = cv.getContext('2d', { willReadFrequently: true })!;
  const surf = new Uint8Array(WW * WH);
  w.fillStyle = 'rgb(60,138,58)';
  w.fillRect(0, 0, WW, WH);
  for (let i = 0; i < N; i++) {
    w.fillStyle = Math.floor(i / 3) % 2 ? 'rgb(236,236,236)' : 'rgb(216,50,42)';
    w.beginPath();
    w.arc(S[i].x, S[i].y, hw[i] + 5, 0, TAU);
    w.fill();
  }
  w.fillStyle = 'rgb(85,87,101)';
  for (let i = 0; i < N; i++) {
    w.beginPath();
    w.arc(S[i].x, S[i].y, hw[i], 0, TAU);
    w.fill();
  }
  const img = w.getImageData(0, 0, WW, WH);
  const d = img.data;
  // the arcs above are anti-aliased: snap every pixel to the nearest of the four flat colours
  const refs = [
    [60, 138, 58, GRASS],
    [216, 50, 42, CURB],
    [236, 236, 236, SOLID],
    [85, 87, 101, ASPHALT],
  ];
  for (let p = 0, i = 0; p < WW * WH; p++, i += 4) {
    let best = 0;
    let bd = 1e9;
    for (let k = 0; k < 4; k++) {
      const r = refs[k];
      const e = (d[i] - r[0]) ** 2 + (d[i + 1] - r[1]) ** 2 + (d[i + 2] - r[2]) ** 2;
      if (e < bd) {
        bd = e;
        best = k;
      }
    }
    const x = p % WW;
    const y = (p / WW) | 0;
    const cls = refs[best][3];
    let c: number[];
    if (cls === GRASS) {
      const band = Math.floor((x + y * 0.4) / 22) % 2;
      c = band ? theme.grass.b : theme.grass.a;
      const r = Math.random();
      if (r < 0.06) c = theme.grass.dark;
      else if (r < 0.09) c = theme.grass.light;
      surf[p] = GRASS;
    } else if (cls === ASPHALT) {
      c = [84, 86, 98];
      const r = Math.random();
      if (r < 0.09) c = [74, 76, 88];
      else if (r < 0.12) c = [98, 100, 112];
      surf[p] = ASPHALT;
    } else if (cls === CURB) {
      c = [216, 50, 42];
      surf[p] = CURB;
    } else {
      c = [236, 236, 236];
      surf[p] = CURB; // the white curb stripe drives like the red one
    }
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  }
  const put: Put = (x, y, c, s) => {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= WW || y >= WH) return;
    const i = (y * WW + x) * 4;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    if (s !== undefined) surf[y * WW + x] = s;
  };
  return { img, surf, put };
}

/** Chequered start line and the four grid slots behind it. */
function paintStart(put: Put, s0: Sample, half: number) {
  for (let u = -half; u <= half; u += 0.5)
    for (let v = -4; v < 4; v += 0.5) {
      const col = (Math.floor((u + half) / 3) + Math.floor((v + 4) / 3)) % 2 ? [245, 245, 245] : [20, 20, 24];
      put(s0.x + s0.nx * u + s0.tx * v, s0.y + s0.ny * u + s0.ty * v, col, ASPHALT);
    }
  for (let g = 0; g < 4; g++) {
    const back = 22 + g * 18;
    const lat = g % 2 ? 12 : -12;
    const cx = s0.x - s0.tx * back + s0.nx * lat;
    const cy = s0.y - s0.ty * back + s0.ny * lat;
    for (let u = -6; u <= 6; u += 0.5) put(cx + s0.nx * u - s0.tx * 7, cy + s0.ny * u - s0.ty * 7, [230, 230, 230]);
    for (let v = -7; v <= -3; v += 0.5) {
      put(cx + s0.nx * -6 + s0.tx * v, cy + s0.ny * -6 + s0.ty * v, [230, 230, 230]);
      put(cx + s0.nx * 6 + s0.tx * v, cy + s0.ny * 6 + s0.ty * v, [230, 230, 230]);
    }
  }
}

/** Solid stand on the left of the start line (looking along the track), drawn in the track's own orientation. */
function paintGrandstand(put: Put, s0: Sample, half: number) {
  const off = half + 24;
  const crowd = [
    [228, 53, 43],
    [255, 210, 63],
    [60, 110, 220],
    [242, 240, 234],
  ];
  const at = (x: number, y: number, c: number[]) => put(s0.x + s0.nx * (x - off) + s0.tx * y, s0.y + s0.ny * (x - off) + s0.ty * y, c, SOLID);
  for (let y = -56; y < 56; y += 0.5)
    for (let x = -10; x < 10; x += 0.5) {
      let c = x < -6 ? [120, 124, 140] : (Math.floor(y) + 56) % 4 < 2 ? [176, 180, 196] : [150, 154, 170];
      if (x >= -6 && Math.random() < 0.35) c = crowd[Math.floor(Math.random() * 4)];
      at(x, y, c);
    }
  for (let y = -56; y < 56; y += 0.5) {
    at(10, y, [30, 30, 36]);
    at(10.5, y, [30, 30, 36]);
  }
}

function plantTrees(put: Put, surf: Uint8Array, track: Track) {
  const { width: WW, height: WH, theme } = track;
  const trees: Tree[] = [];
  const isClear = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy += 3)
      for (let dx = -r; dx <= r; dx += 3) {
        const X = (x + dx) | 0;
        const Y = (y + dy) | 0;
        if (X < 4 || Y < 4 || X >= WW - 4 || Y >= WH - 4) return false;
        if (surf[Y * WW + X] !== GRASS) return false;
      }
    return true;
  };
  let tries = 0;
  while (trees.length < track.trees && tries++ < 4000) {
    const x = rnd(10, WW - 10);
    const y = rnd(10, WH - 10);
    const r = rnd(5, 8) | 0;
    if (!isClear(x, y, r + 16)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r + 6)) continue;
    trees.push({ x, y, r });
  }
  const tc = theme.tree;
  for (const t of trees) {
    for (let dy = -t.r; dy <= t.r; dy++) for (let dx = -t.r; dx <= t.r; dx++) if (Math.hypot(dx, dy) <= t.r) put(t.x + dx + 3, t.y + dy + 3, tc.shadow);
    for (let dy = -t.r; dy <= t.r; dy++)
      for (let dx = -t.r; dx <= t.r; dx++) {
        const dd = Math.hypot(dx, dy) + Math.random() * 0.8;
        if (dd > t.r) continue;
        const c = dd > t.r - 1.2 ? tc.rim : dx + dy < -t.r * 0.5 ? tc.light : dx + dy > t.r * 0.4 ? tc.dark : tc.mid;
        put(t.x + dx, t.y + dy, c, SOLID);
      }
  }
  return trees;
}

/** Water with a sandy shore; stays clear of the road so cars can't reach it by accident. */
function paintLake(put: Put, surf: Uint8Array, track: Track) {
  const { width: WW, height: WH } = track;
  const { x: lx, y: ly, rx, ry } = track.lake!;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= WW || y >= WH ? GRASS : surf[y * WW + x]);
  for (let dy = -(ry + 8); dy <= ry + 8; dy++)
    for (let dx = -(rx + 5); dx <= rx + 5; dx++) {
      const e = (dx / rx) ** 2 + (dy / ry) ** 2 + Math.sin(dx * 0.07) * 0.05;
      const X = (lx + dx) | 0;
      const Y = (ly + dy) | 0;
      if (e > 1 || at(X, Y) !== GRASS) continue;
      let near = false;
      for (const o of [
        [8, 0],
        [-8, 0],
        [0, 8],
        [0, -8],
      ]) {
        const v = at(X + o[0], Y + o[1]);
        if (v === ASPHALT || v === CURB) near = true;
      }
      if (near) continue;
      const c = e > 0.88 ? [214, 196, 140] : (dx + dy * 3 + ((dy * 7) % 5)) % 17 === 0 ? [140, 200, 240] : [48, 110, 190];
      put(X, Y, c, e > 0.88 ? GRASS : WATER);
    }
}

function makeMinimap(S: Sample[], WW: number, WH: number) {
  const mini = document.createElement('canvas');
  mini.width = 70;
  mini.height = 50;
  const m = mini.getContext('2d')!;
  m.fillStyle = 'rgba(0,0,0,.55)';
  m.fillRect(0, 0, 70, 50);
  m.fillStyle = '#d8d8e0';
  for (const s of S) m.fillRect(((s.x / WW) * 66 + 2) | 0, ((s.y / WH) * 46 + 2) | 0, 1, 1);
  return mini;
}

export function buildWorld(track: Track): World {
  const { S, N } = sampleCenterline(track.cp);
  const aiSpd = aiSpeeds(S);
  const hw = roadWidths(S, track.halfWidth, track.cornerExtra);
  const { img, surf, put } = paintTerrain(track, S, hw);
  paintStart(put, S[0], track.halfWidth);
  paintGrandstand(put, S[0], track.halfWidth);
  const trees = plantTrees(put, surf, track);
  if (track.lake) paintLake(put, surf, track);
  const mini = makeMinimap(S, track.width, track.height);
  return { track, w: track.width, h: track.height, S, N, aiSpd, hw, base: img, surf, trees, mini };
}
