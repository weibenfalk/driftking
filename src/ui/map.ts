import { sampleCenterline } from '../race/track';
import type { Sample } from '../race/track';

type CP = [number, number][];

const cache = new WeakMap<CP, Sample[]>();

/** The smoothed centre line of a control-point loop, cached by the array. */
export function line(cp: CP): Sample[] {
  let s = cache.get(cp);
  if (!s) cache.set(cp, (s = sampleCenterline(cp).S));
  return s;
}

/**
 * Draws a track as a thick line fitted into the box (x, y, w, h), with the start marked: a bird's-eye map for lists
 * and the editor. `world` is the world size the control points live in.
 */
export function drawMap(ctx: CanvasRenderingContext2D, cp: CP, world: { w: number; h: number }, x: number, y: number, w: number, h: number, road: string, edge: string) {
  const sc = Math.min(w / world.w, h / world.h);
  const ox = x + (w - world.w * sc) / 2;
  const oy = y + (h - world.h * sc) / 2;
  const S = line(cp);
  ctx.fillStyle = edge;
  for (let i = 0; i < S.length; i += 2) ctx.fillRect(Math.round(ox + S[i].x * sc) - 2, Math.round(oy + S[i].y * sc) - 2, 5, 5);
  ctx.fillStyle = road;
  for (let i = 0; i < S.length; i += 2) ctx.fillRect(Math.round(ox + S[i].x * sc) - 1, Math.round(oy + S[i].y * sc) - 1, 3, 3);
  const s0 = S[0];
  ctx.fillStyle = '#000';
  ctx.fillRect(Math.round(ox + s0.x * sc) - 2, Math.round(oy + s0.y * sc) - 2, 5, 5);
  ctx.fillStyle = '#fd3';
  ctx.fillRect(Math.round(ox + s0.x * sc) - 1, Math.round(oy + s0.y * sc) - 1, 3, 3);
  return { sc, ox, oy };
}
