import { TAU, clamp, rnd, wrapAngle } from '../engine/util';
import { GRASS, SOLID, WATER, globalIdx, surfAt } from './track';
import type { Tree, World } from './track';

export const ROT = 64; // rotation frames per car sprite

export interface Car {
  look: number;
  ai: boolean;
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  vf: number; // speed along the heading
  vr: number; // speed sideways (slip)
  steer: number;
  slide: boolean;
  idx: number; // nearest centre-line sample
  lap: number;
  done: boolean;
  skill: number;
  lane: number;
  laneT: number;
  grass: boolean;
  glob: number;
}

export interface DriveInput {
  steer: number;
  gas: boolean;
  brake: boolean;
  hand: boolean;
}

/** What a car runs on, and how the race wants to hear about hits. */
export interface Env {
  world: World;
  /** The car hit a wall or tree, or another car. */
  bump(c: Car): void;
  treeHit(t: Tree): void;
}

/* ------------------------------------------------------------------ */
/* Sprites                                                             */
/* ------------------------------------------------------------------ */

export interface Look {
  col: string;
  frames: HTMLCanvasElement[];
  shadows: HTMLCanvasElement[];
}

const CAR = ['..tt.....tt...', '.dwwwwwwwwwwd.', 'rwwgdddddggwwl', 'rwwgdsdsdggwww', 'rwwgdsdsdggwww', 'rwwgdddddggwwl', '.dwwwwwwwwwwd.', '..tt.....tt...'];

function makeFrames(body: string, darkc: string, stripe: string) {
  const pal: Record<string, string> = { t: '#101014', d: darkc, w: body, g: '#9fd8ff', s: stripe, r: '#ff4a3a', l: '#fff6b0' };
  const frames: HTMLCanvasElement[] = [];
  const shadows: HTMLCanvasElement[] = [];
  for (let k = 0; k < ROT; k++) {
    const th = (k / ROT) * TAU;
    const co = Math.cos(th);
    const si = Math.sin(th);
    const f = document.createElement('canvas');
    f.width = f.height = 18;
    const fc = f.getContext('2d')!;
    const sh = document.createElement('canvas');
    sh.width = sh.height = 18;
    const sc = sh.getContext('2d')!;
    sc.fillStyle = '#000';
    for (let oy = 0; oy < 18; oy++)
      for (let ox = 0; ox < 18; ox++) {
        const x = ox + 0.5 - 9;
        const y = oy + 0.5 - 9;
        const sx = x * co + y * si + 7;
        const sy = -x * si + y * co + 4;
        if (sx < 0 || sy < 0 || sx >= 14 || sy >= 8) continue;
        const ch = CAR[sy | 0][sx | 0];
        if (ch === '.') continue;
        fc.fillStyle = pal[ch];
        fc.fillRect(ox, oy, 1, 1);
        sc.fillRect(ox, oy, 1, 1);
      }
    frames.push(f);
    shadows.push(sh);
  }
  return { frames, shadows };
}

let LOOKS: Look[] | null = null;

/** Sprite sets, built once. Index 0 is the player's red car. */
export function getLooks(): Look[] {
  return (LOOKS ??= [
    { col: '#e4352b', ...makeFrames('#e4352b', '#8e1a14', '#ffd23f') },
    { col: '#3a78e8', ...makeFrames('#3a78e8', '#1c3e8a', '#f2f0ea') },
    { col: '#f2c230', ...makeFrames('#f2c230', '#8f6f10', '#17181f') },
    { col: '#3cbf5a', ...makeFrames('#3cbf5a', '#1d7032', '#f2f0ea') },
  ]);
}

/* ------------------------------------------------------------------ */
/* Cars                                                                */
/* ------------------------------------------------------------------ */

/** Four cars on the grid behind the start line; the player (look 0) starts last. */
export function createGrid(world: World): Car[] {
  const s0 = world.S[0];
  const a0 = Math.atan2(s0.ty, s0.tx);
  return [1, 2, 3, 0].map((look, g) => {
    const back = 22 + g * 18 + 3;
    const lat = g % 2 ? 12 : -12;
    const x = s0.x - s0.tx * back + s0.nx * lat;
    const y = s0.y - s0.ty * back + s0.ny * lat;
    return {
      look,
      ai: look !== 0,
      x,
      y,
      a: a0,
      vx: 0,
      vy: 0,
      vf: 0,
      vr: 0,
      steer: 0,
      slide: false,
      idx: globalIdx(world, x, y),
      lap: 0,
      done: false,
      skill: [0, 0.9, 0.95, 0.92][look],
      lane: rnd(-10, 10),
      laneT: 0,
      grass: false,
      glob: 0,
    };
  });
}

/** Sets `c.grass` and returns the heading vectors plus speed split into forward and sideways. */
export function carFrame(c: Car, world: World) {
  const fx = Math.cos(c.a);
  const fy = Math.sin(c.a);
  const rx = -fy;
  const ry = fx;
  const sf = surfAt(world, c.x, c.y);
  c.grass = sf === GRASS || sf === WATER;
  return { fx, fy, rx, ry, vf: c.vx * fx + c.vy * fy, vr: c.vx * rx + c.vy * ry };
}

/** Player physics: a grip model where the car breaks into a slide and the handbrake makes it easier. */
export function drive(c: Car, inp: DriveInput, dt: number, env: Env) {
  const { fx, fy, rx, ry, vf: vf0, vr: vr0 } = carFrame(c, env.world);
  let vf = vf0;
  let vr = vr0;
  const grass = c.grass;
  c.steer += (inp.steer - c.steer) * Math.min(1, 0.28 * dt);
  const sp = Math.abs(vf);
  let turn = (c.steer * 0.056 * Math.min(1, sp / 1.1) * (vf >= 0 ? 1 : -1)) / (1 + sp * 0.07);
  if (c.slide) turn *= 1.18;
  if (inp.hand) turn *= 1.55;
  c.a += turn * dt;
  const maxF = grass ? 2.3 : 4.35;
  if (inp.gas && vf < maxF) vf += 0.072 * dt * (1 - (0.55 * Math.max(0, vf)) / maxF);
  if (inp.brake) {
    if (vf > 0.2) vf -= 0.13 * dt;
    else if (vf > -1.6) vf -= 0.05 * dt;
  }
  vf *= Math.pow(grass ? 0.972 : 0.994, dt);
  if (!inp.gas && !inp.brake) vf *= Math.pow(0.99, dt);
  if (inp.hand) vf *= Math.pow(0.986, dt);
  if (vf > maxF) vf -= (vf - maxF) * 0.05 * dt;
  const slip = Math.abs(vr);
  if (!c.slide && (slip > 0.85 || (inp.hand && sp > 1.4))) c.slide = true;
  if (c.slide && slip < 0.28 && !inp.hand) c.slide = false;
  let grip = c.slide ? (inp.gas ? 0.952 : 0.935) : 0.79;
  if (inp.hand) grip = 0.976;
  if (grass) grip = c.slide ? 0.92 : 0.84;
  const vr2 = vr * Math.pow(grip, dt);
  if (vf > 0) vf += Math.abs(vr - vr2) * (inp.gas ? 0.42 : 0.25);
  vr = vr2;
  if (c.slide && !inp.hand && vf > 0.6) {
    const va = Math.atan2(fy * vf + ry * vr, fx * vf + rx * vr);
    c.a += wrapAngle(va - c.a) * 0.022 * dt;
  }
  c.vx = fx * vf + rx * vr;
  c.vy = fy * vf + ry * vr;
  c.vf = vf;
  c.vr = vr;
  moveCar(c, dt, env);
}

/** Advance the car, bouncing off solid scenery, the world edge and trees. */
export function moveCar(c: Car, dt: number, env: Env) {
  const { world } = env;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  if (surfAt(world, c.x, c.y) === SOLID) {
    c.x -= c.vx * dt * 1.5;
    c.y -= c.vy * dt * 1.5;
    c.vx *= -0.3;
    c.vy *= -0.3;
    env.bump(c);
  }
  if (c.x < 8 || c.x > world.w - 8) {
    c.vx *= -0.4;
    c.x = clamp(c.x, 8, world.w - 8);
  }
  if (c.y < 8 || c.y > world.h - 8) {
    c.vy *= -0.4;
    c.y = clamp(c.y, 8, world.h - 8);
  }
  for (const t of world.trees) {
    const dx = c.x - t.x;
    const dy = c.y - t.y;
    const d = Math.hypot(dx, dy);
    const m = t.r + 5;
    if (d < m && d > 0) {
      const nx = dx / d;
      const ny = dy / d;
      const vn = c.vx * nx + c.vy * ny;
      c.x = t.x + nx * m;
      c.y = t.y + ny * m;
      if (vn < 0) {
        c.vx -= 1.5 * vn * nx;
        c.vy -= 1.5 * vn * ny;
        c.vx *= 0.6;
        c.vy *= 0.6;
        env.bump(c);
        env.treeHit(t);
      }
    }
  }
}

/** Push overlapping cars apart and trade momentum. `onHit` gets the pair and the impact strength. */
export function collideCars(cars: Car[], onHit: (a: Car, b: Car, impact: number) => void) {
  for (let i = 0; i < cars.length; i++)
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < 11) {
        const nx = dx / d;
        const ny = dy / d;
        const o = (11 - d) / 2;
        a.x -= nx * o;
        a.y -= ny * o;
        b.x += nx * o;
        b.y += ny * o;
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const imp = -rv * 0.8;
          a.vx -= nx * imp * 0.5;
          a.vy -= ny * imp * 0.5;
          b.vx += nx * imp * 0.5;
          b.vy += ny * imp * 0.5;
          onHit(a, b, imp);
        }
      }
    }
}
