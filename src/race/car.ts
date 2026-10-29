import { TAU, clamp, rnd, wrapAngle } from '../engine/util';
import { GRASS, HAZ_NONE, HAZ_PUDDLE, SOLID, WATER, globalIdx, hazardAt, surfAt } from './track';
import type { Ground, Tree, World } from './track';

export const ROT = 64; // rotation frames per car sprite

/** Off-road physics: top speed, per-frame speed retention, and how much sideways speed survives (lower = more grip). */
export const GROUNDS: Record<Ground, { maxF: number; drag: number; grip: number; slipGrip: number }> = {
  grass: { maxF: 2.3, drag: 0.972, grip: 0.84, slipGrip: 0.92 },
  sand: { maxF: 1.9, drag: 0.962, grip: 0.86, slipGrip: 0.93 },
  snow: { maxF: 2.6, drag: 0.978, grip: 0.9, slipGrip: 0.955 },
  mud: { maxF: 1.7, drag: 0.955, grip: 0.82, slipGrip: 0.9 },
};

/** How a car differs from the baseline (all 1). Each is a multiplier on the matching bit of physics. */
export interface CarStats {
  /** Sideways grip on the road. */
  grip: number;
  /** Acceleration. */
  accel: number;
  /** Top speed on the road (half as much effect off-road). */
  top: number;
  /** How readily it breaks into a slide and how far it rotates in one. */
  drift: number;
  /** Braking force. */
  brake: number;
}

export const UNIT_STATS: CarStats = { grip: 1, accel: 1, top: 1, drift: 1, brake: 1 };

/** How an AI driver behaves. All values are 0..1 except skill and corner, which are multipliers near 1. */
export interface Persona {
  name: string;
  /** Overall pace. */
  skill: number;
  /** How much of the safe corner-speed slowdown it keeps (above 1 = brave, below = careful). */
  corner: number;
  /** Willingness to move over towards a car alongside. */
  aggression: number;
  /** Brakes for cars ahead and moves away from ones alongside. */
  caution: number;
  /** How much sideways slide it tolerates (drifters). */
  slip: number;
}

export interface Car {
  look: number;
  persona: Persona | null;
  stats: CarStats;
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
  lane: number;
  laneT: number;
  grass: boolean;
  glob: number;
  /** Slipstream strength 0..1 from the car ahead. */
  draft: number;
  /** Frames of boost left. */
  boost: number;
  /** HAZ_* under the car. */
  hazard: number;
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

/** Sprite sets: 0-5 are the player's cars (same order as `CAR_MODELS`), 6-12 the AI's. */
const LOOK_COLORS: [string, string, string][] = [
  ['#e4352b', '#8e1a14', '#ffd23f'],
  ['#f08a2a', '#8f4a10', '#f2f0ea'],
  ['#2ab8a8', '#146058', '#f2f0ea'],
  ['#9a4ae0', '#4e1e8a', '#ffd23f'],
  ['#f2f0ea', '#8a90a8', '#3a78e8'],
  ['#2a2a34', '#101018', '#ffd23f'],
  ['#3a78e8', '#1c3e8a', '#f2f0ea'],
  ['#f2c230', '#8f6f10', '#17181f'],
  ['#3cbf5a', '#1d7032', '#f2f0ea'],
  ['#e85a9a', '#8a2458', '#f2f0ea'],
  ['#38c8f0', '#12708c', '#17181f'],
  ['#b06a3a', '#5a3018', '#f2c230'],
  ['#aeb4c2', '#5a6070', '#e4352b'],
];

/** Look used for the time attack ghost. */
export const GHOST_LOOK = 6;

let LOOKS: Look[] | null = null;

/** Sprite sets, built once. */
export function getLooks(): Look[] {
  return (LOOKS ??= LOOK_COLORS.map(([body, dark, stripe]) => ({ col: body, ...makeFrames(body, dark, stripe) })));
}

/* ------------------------------------------------------------------ */
/* Cars                                                                */
/* ------------------------------------------------------------------ */

/** The AI cars first, then the player in the last grid slot: two columns, staggered, behind the start line. */
export function createGrid(world: World, field: { look: number; persona: Persona }[], playerLook = 0, playerStats: CarStats = UNIT_STATS): Car[] {
  const s0 = world.S[0];
  const a0 = Math.atan2(s0.ty, s0.tx);
  const entries = [...field.map((f) => ({ ...f, isAi: true })), { look: playerLook, persona: null, isAi: false }];
  return entries.map(({ look, persona, isAi }, g) => {
    const back = 22 + (g >> 1) * 18 + (g & 1) * 9 + 3;
    const lat = g & 1 ? 12 : -12;
    const x = s0.x - s0.tx * back + s0.nx * lat;
    const y = s0.y - s0.ty * back + s0.ny * lat;
    return {
      look,
      persona,
      stats: isAi ? UNIT_STATS : playerStats,
      ai: isAi,
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
      lane: rnd(-10, 10),
      laneT: 0,
      grass: false,
      glob: 0,
      draft: 0,
      boost: 0,
      hazard: HAZ_NONE,
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
  c.hazard = hazardAt(world, c.x, c.y);
  return { fx, fy, rx, ry, vf: c.vx * fx + c.vy * fy, vr: c.vx * rx + c.vy * ry };
}

/** Grip left on a puddle and on oil, as a share of the road's. */
const HAZARD_GRIP = [1, 0.55, 0.2];

/** Player physics: a grip model where the car breaks into a slide and the handbrake makes it easier. */
export function drive(c: Car, inp: DriveInput, dt: number, env: Env) {
  const { fx, fy, rx, ry, vf: vf0, vr: vr0 } = carFrame(c, env.world);
  let vf = vf0;
  let vr = vr0;
  const grass = c.grass;
  const ground = GROUNDS[env.world.track.ground];
  const roadGrip = env.world.track.roadGrip;
  const st = c.stats;
  const hz = HAZARD_GRIP[c.hazard];
  const boosted = c.boost > 0 ? 1 : 0;
  const slippery = (g: number) => 1 - (1 - g) * roadGrip * st.grip * hz; // scale how much sideways speed the tyres remove
  c.steer += (inp.steer - c.steer) * Math.min(1, 0.28 * dt);
  const sp = Math.abs(vf);
  let turn = (c.steer * 0.056 * Math.min(1, sp / 1.1) * (vf >= 0 ? 1 : -1)) / (1 + sp * 0.07);
  if (c.slide) turn *= 1 + 0.18 * st.drift;
  if (inp.hand) turn *= 1.55;
  c.a += turn * dt;
  const maxF = (grass ? ground.maxF * (1 + (st.top - 1) * 0.5) : 4.35 * st.top) * (1 + 0.2 * boosted + 0.07 * c.draft);
  if (inp.gas && vf < maxF) vf += 0.072 * st.accel * (1 + 1.2 * boosted + 0.3 * c.draft) * (grass ? 1 : 0.6 + 0.4 * roadGrip) * dt * (1 - (0.55 * Math.max(0, vf)) / maxF);
  if (inp.brake) {
    if (vf > 0.2) vf -= 0.13 * st.brake * dt;
    else if (vf > -1.6) vf -= 0.05 * dt;
  }
  vf *= Math.pow(grass ? ground.drag : c.hazard === HAZ_PUDDLE ? 0.988 : 0.994, dt);
  if (!inp.gas && !inp.brake) vf *= Math.pow(0.99, dt);
  if (inp.hand) vf *= Math.pow(0.986, dt);
  if (vf > maxF) vf -= (vf - maxF) * 0.05 * dt;
  const slip = Math.abs(vr);
  if (!c.slide && (slip > 0.85 / st.drift || (inp.hand && sp > 1.4))) c.slide = true;
  if (c.slide && slip < 0.28 && !inp.hand) c.slide = false;
  let grip = slippery(c.slide ? (inp.gas ? 0.952 : 0.935) : 0.79);
  if (inp.hand) grip = slippery(0.976);
  if (grass) grip = c.slide ? ground.slipGrip : ground.grip;
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

/** Frames a boost strip lasts. */
export const BOOST_FRAMES = 70;

/** Driving over a boost strip gives a speed kick and a short burst of extra power. Returns true when it fired. */
export function checkBoost(c: Car, world: World): boolean {
  if (c.boost > BOOST_FRAMES - 20) return false; // just triggered
  for (const p of world.boosts) {
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    const along = dx * p.tx + dy * p.ty;
    const across = -dx * p.ty + dy * p.tx;
    if (Math.abs(along) < 12 && Math.abs(across) < 15) {
      c.boost = BOOST_FRAMES;
      c.vx += Math.cos(c.a) * 0.6;
      c.vy += Math.sin(c.a) * 0.6;
      return true;
    }
  }
  return false;
}

/**
 * Slipstream: a car close behind another, in line with it, builds up draft (up to 1); it fades quickly otherwise.
 * `drive`/`aiDrive` turn that into a little extra top speed and acceleration.
 */
export function updateDraft(cars: Car[], dt: number) {
  for (const c of cars) {
    const fx = Math.cos(c.a);
    const fy = Math.sin(c.a);
    let best = 0;
    for (const o of cars) {
      if (o === c || o.vf < 1.5 || Math.cos(o.a - c.a) < 0.8) continue;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const ahead = dx * fx + dy * fy;
      if (ahead < 8 || ahead > 75 || Math.abs(-dx * fy + dy * fx) > 9) continue;
      best = Math.max(best, 1 - (ahead - 8) / 67);
    }
    c.draft += (best - c.draft) * Math.min(1, (best > c.draft ? 0.08 : 0.2) * dt);
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
          kick(a, dx, dy, imp);
          kick(b, -dx, -dy, imp);
          onHit(a, b, imp);
        }
      }
    }
}

/** A hit on one side of the nose turns the car the other way: (dx, dy) points from the car to what it hit. */
function kick(c: Car, dx: number, dy: number, imp: number) {
  const d = Math.hypot(dx, dy) || 1;
  const side = (Math.cos(c.a) * dy - Math.sin(c.a) * dx) / d;
  c.a -= side * Math.min(imp, 1.5) * 0.05;
}
