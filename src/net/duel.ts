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
/** Seconds the loser gets to cross the line once the winner has. */
export const DNF_AFTER = 25;

/** One tick of the guest's controls: number, dt, steer, gas, brake, handbrake. */
export type InputTick = [k: number, dt: number, s: number, g: 0 | 1, b: 0 | 1, h: 0 | 1];

/** A few ticks at a time, so a fast frame rate doesn't mean a flood of messages. */
export interface InputMsg {
  t: 'in';
  rid: number;
  b: InputTick[];
}

/** A car on the wire: x, y, angle, vx, vy, vf, vr, steer, slide, boost, draft, lap, idx, done. */
export type WireCar = number[];

export interface SnapMsg {
  t: 'snap';
  rid: number;
  /** The last guest input tick the host had stepped when this was taken. */
  k: number;
  /** Host clock (ms) when this was taken, for drawing the host's car at the right moment. */
  ts: number;
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

/**
 * Snapshots of the other car, drawn a little in the past on the host's own timeline: arrival times jump around, the
 * host's timestamps don't. The delay follows how much the arrivals wobble, so a steady connection looks sharp and a
 * shaky one still looks smooth.
 */
export class Interp {
  private buf: { ts: number; w: WireCar }[] = [];
  private lag: number[] = [];
  /** Estimated (arrival - timestamp) of a snapshot that took no extra time, ms. */
  private base = NaN;
  /** How far in the past the car is drawn, ms. */
  delay = 90;

  push(w: WireCar, ts: number, now: number) {
    const last = this.buf[this.buf.length - 1];
    if (last && ts <= last.ts) return; // late or repeated
    this.buf.push({ ts, w });
    if (this.buf.length > 40) this.buf.shift();
    this.lag.push(now - ts);
    if (this.lag.length > 120) this.lag.shift();
    const best = Math.min(...this.lag);
    this.base = Number.isNaN(this.base) || best < this.base ? best : this.base + (best - this.base) * 0.02;
    const wobble = this.lag.map((l) => l - best).sort((x, y) => x - y)[Math.floor(this.lag.length * 0.9)] ?? 0;
    const want = Math.min(300, Math.max(70, wobble + SNAP_EVERY * 1000 + 25));
    this.delay += (want - this.delay) * (want > this.delay ? 0.2 : 0.02); // quick to grow, slow to shrink
  }

  get ready() {
    return this.buf.length > 0;
  }

  /** Places `c` where the car was `delay` ms ago, holding on and running on a little if the next snapshot is late. */
  place(c: Car, now: number) {
    const b = this.buf;
    if (!b.length) return;
    const t = now - this.base - this.delay;
    let i = b.length - 1;
    while (i > 0 && b[i].ts > t) i--;
    const lo = b[i];
    const hi = b[i + 1];
    if (!hi) {
      const f = Math.min(t - lo.ts, 120) / 16.67; // frames since the last snapshot, up to a little over a tenth of a second
      const ahead = Math.max(0, f);
      c.x = lo.w[0] + lo.w[3] * ahead;
      c.y = lo.w[1] + lo.w[4] * ahead;
      c.a = lo.w[2];
      return;
    }
    const f = Math.min(1, Math.max(0, (t - lo.ts) / (hi.ts - lo.ts)));
    // a gap this big is a reset (water, off track): jump rather than slide across the map
    const g = Math.hypot(hi.w[0] - lo.w[0], hi.w[1] - lo.w[1]) > 60 ? (f >= 0.5 ? 1 : 0) : f;
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
   * comparison doesn't count the same error twice) all the way there and says how far that was; null when tick k is
   * no longer remembered or the two already agree.
   */
  correct(k: number, w: WireCar, c: Car): { dist: number; dx: number; dy: number; da: number } | null {
    let at = -1;
    for (let i = this.poses.length - 1; i >= 0; i--)
      if (this.poses[i].k <= k) {
        at = i;
        break;
      }
    if (at < 0) return null;
    const m = this.poses[at];
    const dist = Math.hypot(w[0] - m.x, w[1] - m.y);
    if (dist < 0.3) return { dist, dx: 0, dy: 0, da: 0 };
    const d = { x: w[0] - m.x, y: w[1] - m.y, a: wrapAngle(w[2] - m.a), vx: w[3] - m.vx, vy: w[4] - m.vy, vf: w[5] - m.vf, vr: w[6] - m.vr };
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
    return { dist, dx: d.x, dy: d.y, da: d.a };
  }
}
