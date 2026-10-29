import { clamp, rnd, wrapAngle } from '../engine/util';
import { carFrame, moveCar } from './car';
import type { Car, Env } from './car';

/** Race context the AI needs for rubber-banding. */
export interface Rivalry {
  player: Car;
  racing: boolean;
}

/**
 * Steers towards a point on the centre line ahead (with a lane offset that wanders) and holds the
 * track's per-corner target speed. AI cars never slide on purpose; they just kill sideways speed.
 * A finished player is handed to this too, with skill 0, so the car rolls to a stop.
 */
export function aiDrive(c: Car, dt: number, env: Env, { player, racing }: Rivalry) {
  const { S, N, aiSpd } = env.world;
  if ((c.laneT -= dt) <= 0) {
    c.lane = clamp(c.lane + rnd(-8, 8), -14, 14);
    c.laneT = rnd(60, 160);
  }
  const look = 12 + Math.round(Math.abs(c.vf) * 3);
  const s = S[(c.idx + look) % N];
  const tx = s.x + s.nx * c.lane;
  const ty = s.y + s.ny * c.lane;
  const want = Math.atan2(ty - c.y, tx - c.x);
  c.a += clamp(wrapAngle(want - c.a), -0.065 * dt, 0.065 * dt);
  const { fx, fy, rx, ry, vf: vf0, vr: vr0 } = carFrame(c, env.world);
  let vf = vf0;
  let vr = vr0;
  let tgt = (c.ai ? c.skill : 0.85) * aiSpd[c.idx] * (c.grass ? 0.6 : 1);
  if (c.ai && racing) {
    const gap = c.lap * N + c.idx - (player.lap * N + player.idx);
    tgt *= clamp(1 - (gap / N) * 0.25, 0.9, 1.05);
  }
  if (vf < tgt) vf += 0.065 * dt;
  else vf -= 0.09 * dt;
  vr *= Math.pow(0.72, dt);
  c.vx = fx * vf + rx * vr;
  c.vy = fy * vf + ry * vr;
  c.vf = vf;
  c.vr = vr;
  c.slide = Math.abs(vr) > 0.7;
  moveCar(c, dt, env);
}
