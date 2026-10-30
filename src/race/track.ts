import type { RGB } from '../engine/pal';
import { clamp, wrapAngle } from '../engine/util';
import { paintWorld } from './paint';
import type { BoostPad, Tree } from './paint';
import { ASPHALT, GRASS, HAZ_NONE, PARAPET, SOLID } from './surfaces';

export * from './surfaces';
export type { BoostPad, Tree } from './paint';

/** Off-road surface. Each one is a different mix of top speed, drag and grip (see `GROUNDS` in car.ts). */
export type Ground = 'grass' | 'sand' | 'snow' | 'mud';

/** Kinds of scenery that can be scattered beside the road. */
export type PropStyle = 'tree' | 'pine' | 'bush' | 'cactus' | 'rock' | 'building';

/** Four-tone shading ramp (dark to light) and an outline colour for a kind of prop. */
export interface PropPalette {
  ramp: [RGB, RGB, RGB, RGB];
  rim: RGB;
}

/** The look of the ground texture. */
export type Detail = 'meadow' | 'sand' | 'forest' | 'snow' | 'city';

/** Colours that make a track look like somewhere. Everything is snapped to the Amiga's 12-bit palette when painted. */
export interface Theme {
  /** Ground tones dark to light; large-scale noise picks between them with dithering. */
  ground: [RGB, RGB, RGB, RGB];
  detail: Detail;
  /** The strip of bare ground beside the curb: shadow-side tone and the lighter tone. */
  verge: [RGB, RGB];
  road: { base: RGB; dark: RGB; light: RGB; line: RGB; center: RGB; marks: boolean };
  curb: [RGB, RGB];
  props: Partial<Record<PropStyle, PropPalette>>;
  water: { deep: RGB; mid: RGB; glint: RGB; shore: RGB };
  /** Roof colours for buildings. */
  roofs: RGB[];
}

export interface Props {
  count: number;
  /** What to scatter and how often (relative weights). */
  mix: [PropStyle, number][];
}

/** Everything that makes one track different from another. `buildWorld(track)` does the rest. */
export interface Track {
  id: string;
  name: string;
  /** Environment label shown in menus ("MEADOW", "SNOW", ...). */
  env: string;
  /** World size in pixels. The camera is 320×200 and scrolls inside it. */
  width: number;
  height: number;
  /** Closed loop of control points (Catmull-Rom). Point 0 is the start line; keep a straight run of ~90px before it for the grid. */
  cp: [number, number][];
  laps: number;
  halfWidth: number; // half road width on the straights
  cornerExtra: number; // how much wider each side gets in the sharpest corners
  /** Extra half road width in px at each control point (custom tracks); the road eases between them. */
  pointExtra?: number[];
  /** The road may cross itself: the later stretch of each crossing becomes a bridge (see `findCrossings`). */
  bridges?: boolean;
  props: Props;
  /** Off-road surface. */
  ground: Ground;
  /** Road grip, 1 = asphalt. Lower is slippery (dirt, snow). */
  roadGrip: number;
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
  boosts: BoostPad[];
  /** Bounding box of the lake, so the renderer only animates water where there is some. */
  water: { x0: number; y0: number; x1: number; y1: number } | null;
  hazard: Uint8Array; // HAZ_* per pixel: puddles and oil on the road
  /** 1 for centre-line samples where a car can be on the bridge level (the deck plus a few samples of run-on). */
  lvl: Uint8Array;
  /** Bridge decks: per pixel 1 = deck, 2 = parapet; null without bridges. */
  deck: Uint8Array | null;
  /** The deck, parapets and their shadow as a transparent bitmap, drawn over ground-level cars. */
  deckImg: HTMLCanvasElement | null;
  mini: HTMLCanvasElement;
}

const worlds = new Map<string, World>();

/** Tracks are expensive to paint, so each is built once per page load and shared by every race. */
export function getWorld(track: Track): World {
  let w = worlds.get(track.id);
  if (!w) worlds.set(track.id, (w = buildWorld(track)));
  return w;
}

/** Drops a cached world, e.g. after a custom track was edited under the same id. */
export function forgetWorld(id: string) {
  worlds.delete(id);
}

/** What is under (x, y) for a car on level `z` (0 = ground, 1 = bridge deck: asphalt between solid parapets). */
export function surfAt(world: World, x: number, y: number, z = 0) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return GRASS;
  if (z && world.deck) {
    const d = world.deck[y * world.w + x];
    if (d) return d === 1 ? ASPHALT : SOLID;
  }
  return world.surf[y * world.w + x];
}

export function hazardAt(world: World, x: number, y: number) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return HAZ_NONE;
  return world.hazard[y * world.w + x];
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

/** Closest centre-line sample anywhere on the track; with `z`, only samples on that level (bridge or ground). */
export function globalIdx(world: World, x: number, y: number, z?: number) {
  const { S, N, lvl } = world;
  let bi = 0;
  let bd = 1e18;
  for (let i = 0; i < N; i++) {
    if (z !== undefined && lvl[i] !== z) continue;
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
export function turnAhead(S: Sample[]) {
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
export function aiSpeeds(S: Sample[]) {
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

/** Length of one lap in pixels. */
export function trackLength(track: Track) {
  return sampleCenterline(track.cp).N * 4;
}

/** Seconds a clean lap-after-lap run at AI target pace takes. Medal targets are multiples of this. */
export function parTime(track: Track) {
  const { S } = sampleCenterline(track.cp);
  const aiSpd = aiSpeeds(S);
  let frames = 0;
  for (let i = 0; i < S.length; i++) frames += 4 / (aiSpd[i] * Math.sqrt(track.roadGrip));
  return (frames / 60) * track.laps;
}

/** The road widens in corners: how sharply it turns ahead, spread out smoothly. */
export function roadWidths(S: Sample[], half: number, extra: number) {
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

/** Adds per-control-point extra half width on top of `roadWidths`, easing from one point to the next. */
export function addPointExtra(hw: Float32Array, S: Sample[], cp: [number, number][], extra: number[]) {
  const N = S.length;
  const at = cp.map((p) => {
    let bi = 0;
    let bd = 1e18;
    for (let i = 0; i < N; i++) {
      const d = (S[i].x - p[0]) ** 2 + (S[i].y - p[1]) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  });
  for (let k = 0; k < cp.length; k++) {
    const a = at[k];
    const b = at[(k + 1) % cp.length];
    const e0 = extra[k] ?? 0;
    const e1 = extra[(k + 1) % cp.length] ?? 0;
    if (e0 === 0 && e1 === 0) continue;
    const len = (b - a + N) % N || N;
    for (let j = 0; j < len; j++) {
      const t = j / len;
      hw[(a + j) % N] += e0 + (e1 - e0) * t * t * (3 - 2 * t);
    }
  }
  return hw;
}

/** The half road width at every sample of a track: straights, wider corners, and any hand-set wider spots. */
export function trackWidths(track: { halfWidth: number; cornerExtra: number; pointExtra?: number[] }, S: Sample[], cp: [number, number][]) {
  const hw = roadWidths(S, track.halfWidth, track.cornerExtra);
  return track.pointExtra?.some((e) => e > 0) ? addPointExtra(hw, S, cp, track.pointExtra) : hw;
}

/** Samples either side of a crossing that belong to the bridge (and to the road below), so the deck has run-up. */
const BRIDGE_RUN = 12;

/**
 * Where the road crosses itself. At every crossing the stretch that is driven later in the lap goes over the other
 * one: `lvl` is 1 on its samples (the crossing itself plus `BRIDGE_RUN` each way), `near` marks every sample that
 * takes part (over or under) so the "road touches itself" test can leave them alone. Returns an error text when the
 * crossings are not usable: too shallow, too long, too near the start line or too near each other.
 */
export function findCrossings(S: Sample[], hw: ArrayLike<number>): { lvl: Uint8Array; zlvl: Uint8Array; near: Uint8Array } | string {
  const N = S.length;
  const over = new Uint8Array(N);
  const under = new Uint8Array(N);
  for (let i = 0; i < N; i++)
    for (let j = i + 2; j < N; j++) {
      if (Math.min(j - i, N - (j - i)) < 70) continue; // the same corner
      const dx = S[j].x - S[i].x;
      const dy = S[j].y - S[i].y;
      const d2 = dx * dx + dy * dy;
      const a = hw[i] + 13; // j's centre is on i's road
      const b = hw[j] + 13; // i's centre is on j's road
      if (d2 > Math.max(a, b) ** 2) continue;
      if (Math.abs(S[i].tx * S[j].ty - S[i].ty * S[j].tx) < 0.5) return 'ROAD CROSSES AT TOO SHALLOW AN ANGLE';
      if (d2 < a * a) over[j] = 1;
      if (d2 < b * b) under[i] = 1;
    }
  const spread = (src: Uint8Array) => {
    const out = new Uint8Array(N);
    for (let i = 0; i < N; i++)
      if (src[i]) for (let k = -BRIDGE_RUN; k <= BRIDGE_RUN; k++) out[(i + k + N) % N] = 1;
    return out;
  };
  const lvl = spread(over);
  const below = spread(under);
  const touch = new Uint8Array(N);
  let run = 0;
  for (let i = 0; i < N; i++) {
    touch[i] = lvl[i] | below[i];
    if (!touch[i]) {
      run = 0;
      continue;
    }
    if (i < 60 || i >= N - 60) return 'CROSSING TOO CLOSE TO THE START';
    if (lvl[i] && below[i]) return 'CROSSINGS TOO CLOSE TOGETHER';
    run = lvl[i] ? run + 1 : 0;
    if (run > 90) return 'BRIDGE TOO LONG';
  }
  // the roads stay close for a while either side of a crossing; that is not "touching"
  const near = new Uint8Array(N);
  for (let i = 0; i < N; i++)
    if (touch[i]) for (let k = -70; k <= 70; k++) near[(i + k + N) % N] = 1;
  // cars change level a little before the deck starts, so no car ever has its nose under a deck it is about to drive on
  const zlvl = new Uint8Array(N);
  for (let i = 0; i < N; i++)
    if (lvl[i]) for (let k = -RUN_ON; k <= RUN_ON; k++) zlvl[(i + k + N) % N] = 1;
  return { lvl, zlvl, near };
}

/** Samples before and after a deck where a car already counts as being on the bridge level. */
const RUN_ON = 4;

/** Level of a car that is not tracked over time (replays, the other player's car): on the bridge road within the bridge samples. */
export function levelOf(world: World, c: { x: number; y: number; idx: number }) {
  if (!world.lvl[c.idx]) return 0;
  const s = world.S[c.idx];
  return Math.abs((c.x - s.x) * s.nx + (c.y - s.y) * s.ny) <= world.hw[c.idx] + PARAPET + 2 ? 1 : 0;
}

/**
 * Updates `c.z` after `c.idx` moved on from `prev`. A car gets on a bridge only by driving onto it from the ground at
 * either end, and drops to the ground when it leaves the road beside it. A car beside or under the deck stays down,
 * even when it passes the bridge's samples, so it can drive under it and is not held by the parapets.
 */
export function updateLevel(world: World, c: { x: number; y: number; idx: number; z: number }, prev: number) {
  if (!world.lvl[c.idx]) {
    c.z = 0;
    return;
  }
  const s = world.S[c.idx];
  const lat = Math.abs((c.x - s.x) * s.nx + (c.y - s.y) * s.ny);
  if (lat > world.hw[c.idx] + PARAPET + 2) c.z = 0;
  else if (!world.lvl[prev]) c.z = lat <= world.hw[c.idx] + 2 ? 1 : 0;
}

export function buildWorld(track: Track): World {
  const { S, N } = sampleCenterline(track.cp);
  const aiSpd = aiSpeeds(S);
  const hw = trackWidths(track, S, track.cp);
  const found = track.bridges ? findCrossings(S, hw) : null;
  const deckLvl = found && typeof found !== 'string' ? found.lvl : new Uint8Array(N);
  const lvl = found && typeof found !== 'string' ? found.zlvl : deckLvl;
  const p = paintWorld(track, S, hw, turnAhead(S), deckLvl);
  return { track, w: track.width, h: track.height, S, N, aiSpd, hw, base: p.img, surf: p.surf, trees: p.trees, boosts: p.boosts, water: p.water, hazard: p.hazard, lvl, deck: p.deck, deckImg: p.deckImg, mini: p.mini };
}
