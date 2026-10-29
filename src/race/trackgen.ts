import { TAU, mulberry32, wrapAngle } from '../engine/util';
import { sampleCenterline } from './track';

export interface GenOpts {
  width: number;
  height: number;
  /** Half road width on straights plus corner widening: the room a corner needs. */
  roadHalf: number;
  /** 0..1, how twisty. */
  twist?: number;
  /** Sharp-ish corners a track needs to be accepted. */
  minCorners?: number;
}

type CP = [number, number][];

const MARGIN = 140;

/**
 * Checks a centre line the way the game needs it: stays inside the world, no two far-apart stretches
 * come close enough to touch, no hairpin sharper than the car can take, and a straight at the start for the grid.
 */
export function validate(cp: CP, o: GenOpts): boolean {
  const { S, N } = sampleCenterline(cp);
  const len = N * 4;
  if (len < 3000 || len > 7000) return false;
  for (const s of S) if (s.x < MARGIN || s.y < MARGIN || s.x > o.width - MARGIN || s.y > o.height - MARGIN) return false;
  const gap = 2 * (o.roadHalf + 5) + 24;
  for (let i = 0; i < N; i += 2)
    for (let j = i + 2; j < N; j += 2) {
      const near = Math.min(j - i, N - (j - i));
      if (near < 70) continue; // 280px along the track: same corner
      if (Math.hypot(S[i].x - S[j].x, S[i].y - S[j].y) < gap) return false;
    }
  const head = (i: number) => Math.atan2(S[(i + N) % N].ty, S[(i + N) % N].tx);
  // corners: heading change over 72px. None too sharp, and enough of them to be worth driving.
  const turn = Array.from({ length: N }, (_, i) => Math.abs(wrapAngle(head(i + 18) - head(i))));
  if (Math.max(...turn) > 1.75) return false;
  let corners = 0;
  for (let i = 0; i < N; i++) if (turn[i] > 0.85 && turn[i] >= turn[(i + N - 1) % N] && turn[i] > turn[(i + 1) % N]) corners++;
  if (corners < (o.minCorners ?? 6)) return false;
  if (Math.abs(wrapAngle(head(-25) - head(0))) > 0.08 || Math.abs(wrapAngle(head(25) - head(0))) > 0.08) return false;
  return true;
}

/** Clockwise loop with a straight along the top (point 0 is the start line). Retries with derived seeds until one validates. */
export function generateCenterline(seed: number, o: GenOpts): CP {
  const twist = o.twist ?? 0.6;
  const cx = o.width / 2;
  const cy = o.height / 2;
  const rx = o.width / 2 - MARGIN - 20;
  const ry = o.height / 2 - MARGIN - 20;
  for (let attempt = 0; attempt < 600; attempt++) {
    const rng = mulberry32(seed * 7919 + attempt);
    const harm = [2, 3, 4, 5, 6].map((k) => ({ k, amp: ((0.14 + rng() * 0.3 * twist) * 1.7) / k, ph: rng() * TAU }));
    const f = (th: number) => Math.min(1, Math.max(0.36, 0.9 + harm.reduce((s, h) => s + h.amp * Math.sin(h.k * th + h.ph), 0)));
    const gapA = 0.7;
    const m = 14 + Math.floor(rng() * 6);
    const y0 = cy - ry * 0.92;
    const cp: CP = [
      [cx - 0.12 * rx, y0],
      [cx + 0.2 * rx, y0],
    ];
    for (let i = 0; i < m; i++) {
      const th = -Math.PI / 2 + gapA + ((TAU - 2 * gapA) * (i + 0.5 + (rng() - 0.5) * 0.4)) / m;
      const r = f(th) * (0.94 + rng() * 0.12);
      cp.push([cx + rx * r * Math.cos(th), cy + ry * r * Math.sin(th)]);
    }
    cp.push([cx - 0.5 * rx, y0], [cx - 0.32 * rx, y0]); // collinear lead-in keeps the grid straight
    if (validate(cp, o)) return cp;
  }
  throw new Error(`no valid track for seed ${seed}`);
}

/** A spot for a lake: the free point (out of 40 tries) furthest from the road, if there is real room. */
export function lakeSpot(cp: CP, seed: number, o: GenOpts) {
  const { S } = sampleCenterline(cp);
  const rng = mulberry32(seed + 99);
  let best = { x: 0, y: 0, d: 0 };
  for (let t = 0; t < 40; t++) {
    const x = MARGIN + rng() * (o.width - 2 * MARGIN);
    const y = MARGIN + rng() * (o.height - 2 * MARGIN);
    let d = 1e9;
    for (let i = 0; i < S.length; i += 3) d = Math.min(d, Math.hypot(S[i].x - x, S[i].y - y));
    if (d > best.d) best = { x, y, d };
  }
  if (best.d < o.roadHalf + 110) return undefined;
  const rx = Math.min(130, best.d - o.roadHalf - 40);
  return { x: Math.round(best.x), y: Math.round(best.y), rx: Math.round(rx), ry: Math.round(rx * 0.6) };
}
