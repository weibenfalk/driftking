import { makeNoise, quantize } from '../engine/pal';
import type { RGB } from '../engine/pal';
import { clamp, mulberry32 } from '../engine/util';
import { findCrossings, trackWidths } from '../race/track';
import type { Track } from '../race/track';
import { line } from './map';

/** A track picture and where the world sits in it, so a marker can be placed at a world position. */
export interface Thumb {
  canvas: HTMLCanvasElement;
  sc: number;
  ox: number;
  oy: number;
  /** How many bridges the lap has. */
  bridges: number;
}

const cache = new Map<string, Thumb>();

const hashId = (id: string) => [...id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;

/**
 * A little bird's-eye picture of a track in its own colours: ground tones, lake, a sprinkling of scenery, the road with
 * kerbs and a dashed centre line, a chequered start line, and bridges as light decks with a shadow over the road below.
 * Drawn once per track and size (custom tracks that were edited get a new key).
 */
export function thumb(track: Track, w: number, h: number): Thumb {
  const key = `${track.id}|${w}x${h}|${track.cp.length}|${Math.round(track.cp.reduce((a, p) => a + p[0] * 3 + p[1], 0))}|${track.halfWidth}|${track.bridges ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const sc = Math.min(w / track.width, h / track.height);
  const ox = (w - track.width * sc) / 2;
  const oy = (h - track.height * sc) / 2;
  const img = new ImageData(w, h);
  const d = img.data;
  const busy = new Uint8Array(w * h); // road, water and their surroundings: no scenery here
  const set = (x: number, y: number, c: ArrayLike<number>) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  };
  const { theme } = track;
  const rng = mulberry32(hashId(track.id));
  const noise = makeNoise(rng);

  // ground: big patches of the theme's tones
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const wx = (x - ox) / sc;
      const wy = (y - oy) / sc;
      const t = clamp((noise(wx / 95, wy / 95) * 0.7 + noise(wx / 38, wy / 38) * 0.3 - 0.3) * 2.2, 0, 1);
      set(x, y, theme.ground[Math.min(3, Math.round(t * 3))]);
    }

  // lake
  if (track.lake) {
    const { x: lx, y: ly, rx, ry } = track.lake;
    const cx = ox + lx * sc;
    const cy = oy + ly * sc;
    for (let y = Math.floor(cy - ry * sc - 1); y <= cy + ry * sc + 1; y++)
      for (let x = Math.floor(cx - rx * sc - 1); x <= cx + rx * sc + 1; x++) {
        const e = ((x - cx) / (rx * sc)) ** 2 + ((y - cy) / (ry * sc)) ** 2;
        if (e > 1) continue;
        set(x, y, e > 0.75 ? theme.water.shore : theme.water.mid);
        if (x >= 0 && y >= 0 && x < w && y < h) busy[y * w + x] = 1;
      }
  }

  // a road close in tone to the ground (moon, tropics) would vanish at this size: use its darker tone instead
  const lum = (c: ArrayLike<number>) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const groundLum = theme.ground.reduce((a, c) => a + lum(c), 0) / theme.ground.length;
  const roadColor = Math.abs(lum(theme.road.base) - groundLum) < 40 ? theme.road.dark : theme.road.base;

  const S = line(track.cp);
  const hw = trackWidths(track, S, track.cp);
  const half = (i: number) => Math.max(1, Math.round(hw[i] * sc));
  const at = (i: number) => [Math.round(ox + S[i].x * sc), Math.round(oy + S[i].y * sc)] as const;
  const square = (cx: number, cy: number, r: number, fn: (x: number, y: number) => void) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) fn(cx + dx, cy + dy);
  };

  // keep scenery off the road
  for (let i = 0; i < S.length; i++) {
    const [cx, cy] = at(i);
    square(cx, cy, half(i) + 2, (x, y) => {
      if (x >= 0 && y >= 0 && x < w && y < h) busy[y * w + x] = 1;
    });
  }
  const dots: RGB[] = [...Object.values(theme.props).map((p) => p.ramp[1]), ...(track.props.mix.some(([s]) => s === 'building') ? theme.roofs : [])];
  if (dots.length)
    for (let n = 0; n < (w * h) / 45; n++) {
      const x = Math.floor(rng() * (w - 2));
      const y = Math.floor(rng() * (h - 2));
      const c = dots[Math.floor(rng() * dots.length)];
      if (busy[y * w + x] || busy[y * w + x + 1] || busy[(y + 1) * w + x] || busy[(y + 1) * w + x + 1]) continue;
      set(x, y, c);
      set(x + 1, y, c);
      set(x, y + 1, c);
      set(x + 1, y + 1, c);
    }

  // road: kerb ring first, then the surface, then the dashed centre line
  for (let i = 0; i < S.length; i++) {
    const [cx, cy] = at(i);
    const c = theme.curb[Math.floor(i / 3) % 2];
    square(cx, cy, half(i) + 1, (x, y) => set(x, y, c));
  }
  for (let i = 0; i < S.length; i++) {
    const [cx, cy] = at(i);
    square(cx, cy, half(i), (x, y) => set(x, y, roadColor));
  }
  if (theme.road.marks)
    for (let i = 0; i < S.length; i++) if (half(i) >= 2 && Math.floor(i / 4) % 2 === 0) set(...at(i), theme.road.center);

  // bridges
  let bridges = 0;
  const found = track.bridges ? findCrossings(S, hw) : null;
  if (found && typeof found !== 'string') {
    const lvl = found.lvl;
    const shaded = new Uint8Array(w * h);
    for (let i = 0; i < S.length; i++) {
      if (!lvl[i]) continue;
      if (!lvl[(i - 1 + S.length) % S.length]) bridges++;
      const [cx, cy] = at(i);
      square(cx + 1, cy + 1, half(i) + 1, (x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h || shaded[y * w + x]) return;
        shaded[y * w + x] = 1;
        const k = (y * w + x) * 4;
        d[k] *= 0.55;
        d[k + 1] *= 0.55;
        d[k + 2] *= 0.55;
      });
    }
    for (let i = 0; i < S.length; i++) {
      if (!lvl[i]) continue;
      const [cx, cy] = at(i);
      square(cx, cy, half(i) + 1, (x, y) => set(x, y, [68, 68, 102]));
    }
    for (let i = 0; i < S.length; i++) {
      if (!lvl[i]) continue;
      const [cx, cy] = at(i);
      square(cx, cy, half(i), (x, y) => set(x, y, [204, 204, 221]));
    }
  }

  // chequered start line across the road
  {
    const s = S[0];
    const r = half(0);
    const [cx, cy] = at(0);
    for (let u = -r - 1; u <= r + 1; u++)
      for (let v = 0; v < 2; v++) set(cx + s.nx * u + s.tx * v, cy + s.ny * u + s.ty * v, (u + v) & 1 ? [255, 255, 255] : [0, 0, 0]);
  }

  quantize(d);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  const t: Thumb = { canvas, sc, ox, oy, bridges };
  cache.set(key, t);
  return t;
}
