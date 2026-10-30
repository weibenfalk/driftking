import type { RGB } from '../engine/pal';
import { clamp, wrapAngle } from '../engine/util';
import { paintWorld } from './paint';
import type { BoostPad, Tree } from './paint';
import { GRASS, HAZ_NONE } from './surfaces';

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

export function surfAt(world: World, x: number, y: number) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return GRASS;
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

export function buildWorld(track: Track): World {
  const { S, N } = sampleCenterline(track.cp);
  const aiSpd = aiSpeeds(S);
  const hw = trackWidths(track, S, track.cp);
  const p = paintWorld(track, S, hw, turnAhead(S));
  return { track, w: track.width, h: track.height, S, N, aiSpd, hw, base: p.img, surf: p.surf, trees: p.trees, boosts: p.boosts, water: p.water, hazard: p.hazard, mini: p.mini };
}
