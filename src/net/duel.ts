/*
 * Sync helpers for the two-player duel. The host runs the whole race; the guest sends its inputs (one per frame,
 * numbered) and predicts its own car locally. The host steps the guest's car with exactly those inputs, so after tick
 * k both sides hold the same state apart from collisions, and the host's snapshot says "after your tick k I had the
 * car here". The guest compares that with what it remembers for tick k and eases the difference away. The host's car
 * is drawn from snapshots, a little in the past, interpolated.
 */
import { wrapAngle } from '../engine/util';
import type { Car } from '../race/car';

/** Seconds between host snapshots. */
export const SNAP_EVERY = 0.033;
/** How far in the past the other car is drawn, so there are normally two snapshots to blend between. */
export const INTERP_DELAY = 0.07;
/** Seconds the loser gets to cross the line once the winner has. */
export const DNF_AFTER = 25;

/** One frame of the guest's controls. */
export interface InputMsg {
  t: 'in';
  rid: number;
  k: number;
  dt: number;
  s: number;
  g: 0 | 1;
  b: 0 | 1;
  h: 0 | 1;
}

/** A car on the wire: x, y, angle, vx, vy, vf, vr, steer, slide, boost, draft, lap, idx, done. */
export type WireCar = number[];

export interface SnapMsg {
  t: 'snap';
  rid: number;
  /** The last guest input tick the host had stepped when this was taken. */
  k: number;
  /** Race clock, start countdown, and whether the lights have gone green. */
  rt: number;
  ct: number;
  go: 0 | 1;
  /** Place of the guest's car, for its HUD. */
  pos: number;
  /** Host's car, then the guest's. */
  cars: [WireCar, WireCar];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function packCar(c: Car): WireCar {
  return [r2(c.x), r2(c.y), r2(c.a), r2(c.vx), r2(c.vy), r2(c.vf), r2(c.vr), r2(c.steer), c.slide ? 1 : 0, Math.round(c.boost), r2(c.draft), c.lap, c.idx, c.done ? 1 : 0];
}

/** Everything but where the car is; used for the host's car on the guest, which is placed by interpolation. */
export function applyMotion(c: Car, w: WireCar) {
  c.vx = w[3];
  c.vy = w[4];
  c.vf = w[5];
  c.vr = w[6];
  c.steer = w[7];
  c.slide = !!w[8];
  c.boost = w[9];
  c.draft = w[10];
  c.lap = w[11];
  c.idx = w[12];
  c.done = !!w[13];
}

/** Snapshots of the other car with their arrival times, sampled `INTERP_DELAY` in the past. */
export class Interp {
  private buf: { at: number; w: WireCar }[] = [];

  push(w: WireCar, now: number) {
    this.buf.push({ at: now, w });
    if (this.buf.length > 12) this.buf.shift();
  }

  get ready() {
    return this.buf.length > 0;
  }

  /** Places `c` where the car was `INTERP_DELAY` ago (held at the newest snapshot when it has run dry). */
  place(c: Car, now: number) {
    const b = this.buf;
    if (!b.length) return;
    const t = now - INTERP_DELAY * 1000;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].at > t) i--;
    const hi = b[i];
    const lo = i > 0 ? b[i - 1] : hi;
    const f = hi === lo || t >= hi.at ? 1 : t <= lo.at ? 0 : (t - lo.at) / (hi.at - lo.at);
    // a gap this big is a reset (water, off track): jump rather than slide across the map
    const jump = Math.hypot(hi.w[0] - lo.w[0], hi.w[1] - lo.w[1]) > 60;
    const g = jump ? 1 : f;
    c.x = lo.w[0] + (hi.w[0] - lo.w[0]) * g;
    c.y = lo.w[1] + (hi.w[1] - lo.w[1]) * g;
    c.a = lo.w[2] + wrapAngle(hi.w[2] - lo.w[2]) * g;
  }
}

interface Pose {
  k: number;
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  vf: number;
  vr: number;
}

/** The guest's own car after each of its recent ticks, to compare with what the host says. */
export class PoseHistory {
  private poses: Pose[] = [];

  push(k: number, c: Car) {
    this.poses.push({ k, x: c.x, y: c.y, a: c.a, vx: c.vx, vy: c.vy, vf: c.vf, vr: c.vr });
    if (this.poses.length > 240) this.poses.shift();
  }

  /**
   * The host held the car at `w` after tick `k`. Moves the car (and the remembered poses from tick k on, so the next
   * comparison doesn't count the same error twice) part of the way there. Returns the error in pixels, or -1 when
   * tick k is no longer remembered.
   */
  correct(k: number, w: WireCar, c: Car): number {
    let at = -1;
    for (let i = this.poses.length - 1; i >= 0; i--)
      if (this.poses[i].k <= k) {
        at = i;
        break;
      }
    if (at < 0) return -1;
    const m = this.poses[at];
    const dist = Math.hypot(w[0] - m.x, w[1] - m.y);
    const gain = dist > 40 ? 1 : dist < 0.4 ? 0 : 0.3;
    if (gain === 0) return dist;
    const d = { x: (w[0] - m.x) * gain, y: (w[1] - m.y) * gain, a: wrapAngle(w[2] - m.a) * gain, vx: (w[3] - m.vx) * gain, vy: (w[4] - m.vy) * gain, vf: (w[5] - m.vf) * gain, vr: (w[6] - m.vr) * gain };
    const shift = (p: { x: number; y: number; a: number; vx: number; vy: number; vf: number; vr: number }) => {
      p.x += d.x;
      p.y += d.y;
      p.a += d.a;
      p.vx += d.vx;
      p.vy += d.vy;
      p.vf += d.vf;
      p.vr += d.vr;
    };
    shift(c);
    for (let i = at; i < this.poses.length; i++) shift(this.poses[i]);
    return dist;
  }
}
