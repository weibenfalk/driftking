import { clamp, rnd, wrapAngle } from '../engine/util';
import { carFrame, moveCar } from './car';
import type { Car, Env, Persona } from './car';

/** The seven AI drivers: look (sprite set) and personality. Order is grid order. */
export const FIELD: { look: number; persona: Persona }[] = [
  { look: 6, persona: { name: 'ACE', skill: 0.97, corner: 1.05, aggression: 0.2, caution: 0.3, slip: 0.1 } },
  { look: 7, persona: { name: 'BRUTE', skill: 0.94, corner: 1.12, aggression: 0.9, caution: 0, slip: 0.2 } },
  { look: 8, persona: { name: 'NOVA', skill: 0.93, corner: 1.2, aggression: 0.3, caution: 0.1, slip: 0.9 } },
  { look: 9, persona: { name: 'MOSS', skill: 0.9, corner: 0.92, aggression: 0, caution: 1, slip: 0 } },
  { look: 10, persona: { name: 'FLASH', skill: 0.92, corner: 1.1, aggression: 0.7, caution: 0.1, slip: 0.3 } },
  { look: 11, persona: { name: 'DRIFTA', skill: 0.91, corner: 1.15, aggression: 0.2, caution: 0.2, slip: 1 } },
  { look: 12, persona: { name: 'SAGE', skill: 0.88, corner: 0.95, aggression: 0, caution: 0.8, slip: 0 } },
];

/** What a finished player gets handed to the AI as: skill 0, so the car just rolls to a stop. */
const COAST: Persona = { name: '', skill: 0, corner: 1, aggression: 0, caution: 0, slip: 0 };

/** The fastest target speed on the track (px/frame); corners subtract from it. See `aiSpeeds` in track.ts. */
const STRAIGHT = 4.0;

/**
 * How much faster than the baseline corner-speed profile the AI drives on Normal. Calibrated with a test-driver bot
 * on the real physics: the bot can hold ~1.4x that profile on dry tarmac and ~1.6x is its limit, but AI cars get
 * more forgiving grip than the player, so a pace of 1.25 puts the best AI (skill .97) at about a good driver's lap
 * time and the slowest AI at a beginner's. Easy and Hard scale this (see `DIFFICULTY` in game/settings.ts).
 */
export const AI_PACE = 1.25;

/** Race context the AI needs. */
export interface Rivalry {
  player: Car;
  racing: boolean;
  cars: Car[];
  /** Overall pace multiplier (`AI_PACE` times the difficulty); defaults to `AI_PACE`. */
  pace?: number;
}

/**
 * Steers towards a point on the centre line ahead, with a lane offset that wanders and reacts to traffic, and holds a
 * per-corner target speed shaped by the driver's persona:
 *  - aggressive drivers drift into cars alongside them, cautious ones give way and brake for cars ahead;
 *  - brave drivers keep more speed through corners, drifters let the tail slide to do it;
 *  - the rubber band is weak (a few percent) and only trims leaders and helps stragglers.
 */
export function aiDrive(c: Car, dt: number, env: Env, { player, racing, cars, pace = AI_PACE }: Rivalry) {
  const { S, N, aiSpd } = env.world;
  const p = c.persona ?? COAST;
  const fx0 = Math.cos(c.a);
  const fy0 = Math.sin(c.a);

  // traffic: nearest car straight ahead, and one alongside (lat > 0 means on our right)
  let aheadD = 1e9;
  let sideLat = 0;
  let beside = false;
  for (const o of cars) {
    if (o === c || o.z !== c.z) continue;
    const dx = o.x - c.x;
    const dy = o.y - c.y;
    const fwd = dx * fx0 + dy * fy0;
    const lat = -dx * fy0 + dy * fx0;
    if (fwd > 0 && fwd < 26 && Math.abs(lat) < 10 && fwd < aheadD) aheadD = fwd;
    if (Math.abs(fwd) < 14 && Math.abs(lat) < 20) {
      beside = true;
      sideLat = lat;
    }
  }

  if ((c.laneT -= dt) <= 0) {
    c.lane = c.lane + rnd(-8, 8);
    c.laneT = rnd(60, 160);
  }
  if (beside) {
    const dir = Math.sign(sideLat) || 1;
    c.lane += dir * (p.aggression * 0.7 - p.caution * 0.9) * dt;
  }
  c.lane = clamp(c.lane, -15, 15);

  const look = 12 + Math.round(Math.abs(c.vf) * 3);
  const s = S[(c.idx + look) % N];
  const tx = s.x + s.nx * c.lane;
  const ty = s.y + s.ny * c.lane;
  const want = Math.atan2(ty - c.y, tx - c.x);
  c.a += clamp(wrapAngle(want - c.a), -0.065 * dt, 0.065 * dt);
  const { fx, fy, rx, ry, vf: vf0, vr: vr0 } = carFrame(c, env.world);
  let vf = vf0;
  let vr = vr0;

  const slow = STRAIGHT - aiSpd[c.idx]; // how much the next corner takes off
  let tgt = p.skill * pace * Math.max(0.5, STRAIGHT - slow / p.corner) * (c.grass ? 0.6 : Math.sqrt(env.world.track.roadGrip * (env.grip ?? 1)));
  if (c.persona && racing) {
    const gap = c.lap * N + c.idx - (player.lap * N + player.idx);
    tgt *= clamp(1 - (gap / N) * 0.12, 0.96, 1.03);
  }
  // everyone keeps some distance to the car ahead (aggressive drivers too), cautious ones more
  if (aheadD < 26) tgt *= 1 - Math.max(0.5, p.caution) * (1 - aheadD / 26) * 0.6;
  if (c.boost > 0) tgt *= 1.18;
  tgt *= 1 + 0.05 * c.draft;
  if (c.hazard) tgt *= c.hazard === 2 ? 0.85 : 0.93;

  if (vf < tgt) vf += 0.065 * dt * (c.boost > 0 ? 2 : 1);
  else vf -= 0.09 * dt;
  // grip: drifters keep more of their sideways speed, and hazards take grip away from everyone
  const keep = 0.72 + 0.16 * p.slip + (c.hazard === 2 ? 0.2 : c.hazard === 1 ? 0.1 : 0);
  vr *= Math.pow(Math.min(0.97, keep), dt);
  c.vx = fx * vf + rx * vr;
  c.vy = fy * vf + ry * vr;
  c.vf = vf;
  c.vr = vr;
  c.slide = Math.abs(vr) > 0.7;
  moveCar(c, dt, env);
}
