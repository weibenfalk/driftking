/*
 * Amiga-style colour tools. The OCS/ECS chipset had 12-bit colour (16 levels per channel), and artists faked
 * smooth shading with dithering: a 4x4 ordered (Bayer) pattern is used here, so tones blend in the typical
 * checkerboard way instead of with random noise.
 */

export type RGB = [number, number, number];

/** Snap a channel to the 12-bit grid (0, 17, 34 ... 255). */
export const snap = (v: number) => Math.round(Math.min(255, Math.max(0, v)) / 17) * 17;

/** Snap every pixel of an image to the 12-bit palette grid. */
export function quantize(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = snap(d[i]);
    d[i + 1] = snap(d[i + 1]);
    d[i + 2] = snap(d[i + 2]);
  }
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered-dither threshold for a pixel, 0..1. */
export const bayer = (x: number, y: number) => (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;

/** Pick from a tone ramp at position `t` (0 .. ramp.length-1), dithering between the two nearest tones. */
export function ramp(tones: RGB[], t: number, x: number, y: number): RGB {
  const max = tones.length - 1;
  if (t <= 0) return tones[0];
  if (t >= max) return tones[max];
  const i = Math.floor(t);
  return t - i > bayer(x, y) ? tones[i + 1] : tones[i];
}

export const shade = (c: RGB, k: number): RGB => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

/** Integer hash of a position: stable "random" per pixel, so painting is repeatable. */
export function hash2(x: number, y: number, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Smooth value noise (0..1) on a 128-cell wrapping lattice; scale the input to choose the feature size. */
export function makeNoise(rand: () => number) {
  const L = new Float32Array(128 * 128);
  for (let i = 0; i < L.length; i++) L[i] = rand();
  const g = (a: number, b: number) => L[((b & 127) << 7) | (a & 127)];
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * sx;
    const bot = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * sx;
    return top + (bot - top) * sy;
  };
}

/** Pick a tone from a ramp with hard edges between the bands (no dithering): `t` runs 0 .. ramp.length. */
export const band = <T>(tones: T[], t: number): T => tones[Math.max(0, Math.min(tones.length - 1, Math.floor(t)))];
