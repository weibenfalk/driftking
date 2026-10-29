import { TAU } from '../engine/util';
import { ROT } from './car';
import { globalIdx, nearestIdx } from './track';
import type { World } from './track';

/** Ghost samples per second. */
export const GHOST_HZ = 20;
const STEP = 1 / GHOST_HZ;

/**
 * A lap as a flat list of integer triples: x, y, heading as a sprite frame (0..ROT-1), one triple every 1/GHOST_HZ s
 * counted from the moment the car crossed the line. Integers keep the saved JSON small (~10 KB for a 40 s lap).
 */
export type GhostData = number[];

export interface GhostPose {
  x: number;
  y: number;
  a: number; // radians
}

/** Collects a lap while it is driven. */
export class LapRecorder {
  data: GhostData = [];
  private next = 0;

  /** Call every frame with seconds since the lap began. */
  tick(t: number, x: number, y: number, a: number) {
    while (t >= this.next) {
      this.data.push(Math.round(x), Math.round(y), ((Math.round((a / TAU) * ROT) % ROT) + ROT) % ROT);
      this.next += STEP;
    }
  }

  /** Closes the lap with the car's final position (on the line). */
  finish(x: number, y: number, a: number) {
    this.data.push(Math.round(x), Math.round(y), ((Math.round((a / TAU) * ROT) % ROT) + ROT) % ROT);
    return this.data;
  }
}

/** Where the ghost is `t` seconds into its lap, or null once it has finished. */
export function ghostAt(data: GhostData, t: number): GhostPose | null {
  const n = data.length / 3;
  if (n < 2) return null;
  const f = t / STEP;
  if (f >= n - 1) return null;
  const i = Math.floor(f);
  const k = f - i;
  const o = i * 3;
  let da = data[o + 5] - data[o + 2];
  if (da > ROT / 2) da -= ROT;
  else if (da < -ROT / 2) da += ROT;
  return {
    x: data[o] + (data[o + 3] - data[o]) * k,
    y: data[o + 1] + (data[o + 4] - data[o + 1]) * k,
    a: ((data[o + 2] + da * k) / ROT) * TAU,
  };
}

/**
 * For every centre-line sample, the time (s) at which the ghost first passed it, or NaN where it never did.
 * Comparing the player's lap clock with this at their own position gives the live gap to the ghost.
 */
export function ghostTimeline(world: World, data: GhostData): Float32Array {
  const { N } = world;
  const tl = new Float32Array(N).fill(NaN);
  const n = data.length / 3;
  if (n < 2) return tl;
  let cur = globalIdx(world, data[0], data[1]);
  tl[cur] = 0;
  for (let i = 1; i < n; i++) {
    const ni = nearestIdx(world, data[i * 3], data[i * 3 + 1], cur, 5, 25);
    const step = (((ni - cur) % N) + N) % N;
    if (step > 0 && step < N / 2) {
      for (let k = 1; k <= step; k++) {
        const j = (cur + k) % N;
        if (Number.isNaN(tl[j])) tl[j] = i * STEP;
      }
      cur = ni;
    }
  }
  return tl;
}
