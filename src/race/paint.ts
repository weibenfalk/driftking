import { band, hash2, makeNoise, quantize, ramp, shade } from '../engine/pal';
import type { RGB } from '../engine/pal';
import { TAU, clamp, mulberry32 } from '../engine/util';
import { ASPHALT, CURB, GRASS, HAZ_OIL, HAZ_PUDDLE, SOLID, WATER } from './surfaces';
import type { PropPalette, PropStyle, Sample, Track } from './track';

/** A round obstacle: trees, rocks, cacti, tyre stacks. */
export interface Tree {
  x: number;
  y: number;
  r: number;
  /** Tyre stacks kick up dirt rather than leaves when hit. */
  kind?: 'tire';
}

/** A boost strip on the road: centre and driving direction. */
export interface BoostPad {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

export interface Painted {
  img: ImageData;
  surf: Uint8Array;
  hazard: Uint8Array;
  trees: Tree[];
  boosts: BoostPad[];
  water: { x0: number; y0: number; x1: number; y1: number } | null;
  mini: HTMLCanvasElement;
}

/** Pixel access to the world bitmap and its surface map, with bounds checks. */
class Pix {
  readonly d: Uint8ClampedArray;
  readonly img: ImageData;
  readonly surf: Uint8Array;
  readonly W: number;
  readonly H: number;
  constructor(img: ImageData, surf: Uint8Array, W: number, H: number) {
    this.img = img;
    this.surf = surf;
    this.W = W;
    this.H = H;
    this.d = img.data;
  }
  inb(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.W && y < this.H;
  }
  put(x: number, y: number, c: ArrayLike<number>, s?: number) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inb(x, y)) return;
    const i = (y * this.W + x) * 4;
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
    if (s !== undefined) this.surf[y * this.W + x] = s;
  }
  /** Surface id at a pixel, or 255 outside the world. */
  at(x: number, y: number) {
    x = Math.floor(x);
    y = Math.floor(y);
    return this.inb(x, y) ? this.surf[y * this.W + x] : 255;
  }
  get(x: number, y: number): RGB {
    const i = (Math.floor(y) * this.W + Math.floor(x)) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2]];
  }
  darken(x: number, y: number, k: number) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inb(x, y)) return;
    const i = (y * this.W + x) * 4;
    this.d[i] *= k;
    this.d[i + 1] *= k;
    this.d[i + 2] *= k;
  }
}

type Noise = (x: number, y: number) => number;

/* ------------------------------------------------------------------ */
/* Terrain: ground, road and curbs                                     */
/* ------------------------------------------------------------------ */

/*
 * Look of the ground, in the spirit of Super Cars II: the road itself is clean and flat, while the surroundings are
 * big patches of a few tones that meet in a narrow dithered seam (the Amiga trick for blending two colours) rather
 * than being speckled all over.
 */
function groundColor(track: Track, noise: Noise, x: number, y: number): RGB {
  const { ground, detail } = track.theme;
  let t = noise(x / 95, y / 95) * 0.7 + noise(x / 38, y / 38) * 0.3;
  t = clamp((t - 0.3) * 2.2, 0, 1);
  switch (detail) {
    case 'meadow':
      t = clamp(t + (Math.floor((x + y * 0.4) / 26) % 2 ? -0.08 : 0.08), 0, 1); // mown stripes
      break;
    case 'sand': {
      // dune ridges: one dark line
      const r = Math.sin(x * 0.045 + y * 0.03 + noise(x / 110, y / 110) * 7);
      if (Math.abs(r) < 0.04) return ground[0];
      break;
    }
    case 'city':
      // paving slabs with seams, alternate slabs a tone apart
      if (x % 24 === 0 || y % 24 === 0) return ground[0];
      return (Math.floor(x / 24) + Math.floor(y / 24)) % 2 ? ground[2] : ground[1];
    case 'forest':
      t = clamp(t - 0.15, 0, 1);
      break;
  }
  // tone position 0..3; dither only in the middle third of each step, so seams are narrow
  const v = Math.min(2.999, t * 3);
  const i = Math.floor(v);
  const f = clamp((v - i - 0.35) * 3.4, 0, 1);
  return ramp(ground, i + f, x, y);
}

function roadColor(track: Track): RGB {
  return track.theme.road.base;
}

/** The flat colours the anti-aliased arcs are drawn in, so every pixel can be classified. */
const REFS: [number, number, number, number][] = [
  [60, 138, 58, GRASS],
  [216, 50, 42, CURB],
  [236, 236, 236, SOLID], // the white curb stripe; drives like the red one
  [85, 87, 101, ASPHALT],
];

function paintTerrain(track: Track, S: Sample[], hw: Float32Array, noise: Noise) {
  const { width: W, height: H, theme } = track;
  const N = S.length;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const w = cv.getContext('2d', { willReadFrequently: true })!;
  w.fillStyle = 'rgb(60,138,58)';
  w.fillRect(0, 0, W, H);
  for (let i = 0; i < N; i++) {
    w.fillStyle = Math.floor(i / 3) % 2 ? 'rgb(236,236,236)' : 'rgb(216,50,42)';
    w.beginPath();
    w.arc(S[i].x, S[i].y, hw[i] + 5, 0, TAU);
    w.fill();
  }
  w.fillStyle = 'rgb(85,87,101)';
  for (let i = 0; i < N; i++) {
    w.beginPath();
    w.arc(S[i].x, S[i].y, hw[i], 0, TAU);
    w.fill();
  }
  const img = w.getImageData(0, 0, W, H);
  const surf = new Uint8Array(W * H);
  const d = img.data;
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    let best = 0;
    let bd = 1e9;
    for (let k = 0; k < 4; k++) {
      const r = REFS[k];
      const e = (d[i] - r[0]) ** 2 + (d[i + 1] - r[1]) ** 2 + (d[i + 2] - r[2]) ** 2;
      if (e < bd) {
        bd = e;
        best = k;
      }
    }
    const x = p % W;
    const y = (p / W) | 0;
    const cls = REFS[best][3];
    let c: RGB;
    if (cls === GRASS) {
      c = groundColor(track, noise, x, y);
      surf[p] = GRASS;
    } else if (cls === ASPHALT) {
      c = roadColor(track);
      surf[p] = ASPHALT;
    } else {
      c = theme.curb[cls === CURB ? 0 : 1];
      surf[p] = CURB;
    }
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  }
  return new Pix(img, surf, W, H);
}

/** Small multi-pixel ground features: tufts, flowers, pebbles, needles. Only ever drawn on bare ground. */
function paintGroundDetail(px: Pix, track: Track) {
  const { W, H } = px;
  const { ground, detail } = track.theme;
  const dot = (x: number, y: number, c: RGB) => {
    if (px.at(x, y) === GRASS) px.put(x, y, c);
  };
  const FLOWERS: RGB[] = [[255, 255, 255], [255, 221, 51], [255, 136, 170], [204, 153, 255]];
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      if (px.surf[y * W + x] !== GRASS) continue;
      const h = hash2(x, y, 7);
      if (detail === 'meadow') {
        if (h % 650 === 0) {
          dot(x, y, ground[0]);
          dot(x, y - 1, ground[0]);
          dot(x - 1, y - 2, ground[3]);
          dot(x + 1, y - 2, ground[3]);
        } else if (h % 2400 === 1) {
          const f = FLOWERS[(h >>> 8) % 4];
          dot(x, y, f);
          dot(x + 1, y, f);
          dot(x, y + 1, [34, 119, 34]);
        }
      } else if (detail === 'sand') {
        if (h % 2200 === 0) {
          dot(x, y, ground[0]);
          dot(x + 1, y, ground[0]);
          dot(x, y - 1, ground[3]);
        }
      } else if (detail === 'forest') {
        if (h % 260 === 0) {
          dot(x, y, ground[0]);
          dot(x + 1, y, ground[0]);
        } else if (h % 3500 === 2) {
          dot(x, y, [221, 51, 34]); // toadstool
          dot(x + 1, y, [238, 238, 238]);
        }
      } else if (detail === 'snow') {
        if (h % 1600 === 0) {
          dot(x, y, ground[0]);
          dot(x + 1, y, ground[0]);
        }
      } else if (detail === 'city') {
        if (h % 2200 === 0) {
          // manhole cover
          for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (a * a + b * b <= 5) dot(x + a, y + b, a === 0 || b === 0 ? ground[0] : shade(ground[0], 0.8));
        }
      }
    }
}

/** Dark outline on the outer edge of the curb and a two-tone strip of bare verge beside it. */
function paintEdges(px: Pix, track: Track) {
  const { W, H, surf } = px;
  const { theme } = track;
  const OUT: RGB = [34, 17, 17];
  const nb = (i: number, v: number) => surf[i - 1] === v || surf[i + 1] === v || surf[i - W] === v || surf[i + W] === v;
  const dist = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (surf[i] === CURB && nb(i, GRASS)) px.put(x, y, OUT);
      else if (surf[i] === GRASS && nb(i, CURB)) dist[i] = 1;
    }
  const VERGE = 4;
  for (let d = 2; d <= VERGE; d++)
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (surf[i] !== GRASS || dist[i] !== 0) continue;
        if (dist[i - 1] === d - 1 || dist[i + 1] === d - 1 || dist[i - W] === d - 1 || dist[i + W] === d - 1) dist[i] = d;
      }
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const d = dist[y * W + x];
      if (!d) continue;
      px.put(x, y, d <= 2 ? theme.verge[0] : theme.verge[1]);
    }
}

/** Edge lines and a dashed centre line. */
function paintMarkings(px: Pix, S: Sample[], hw: Float32Array, track: Track) {
  const { road } = track.theme;
  const N = S.length;
  const onRoad = (x: number, y: number) => px.at(x, y) === ASPHALT;
  for (let i = 0; i < N; i++) {
    const a = S[i];
    const b = S[(i + 1) % N];
    const w = hw[i];
    const nearStart = i >= N - 30 || i < 12;
    for (let k = 0; k < 4; k++) {
      const t = k / 4;
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.y + (b.y - a.y) * t;
      const nx = a.nx;
      const ny = a.ny;
      if (!road.marks) continue;
      for (const side of [-1, 1]) {
        const x = cx + nx * side * (w - 3.5);
        const y = cy + ny * side * (w - 3.5);
        if (onRoad(x, y)) px.put(x, y, road.line);
      }
      if (!nearStart && Math.floor(i / 3) % 2 === 0) {
        for (const u of [-0.5, 0.5]) {
          const x = cx + nx * u;
          const y = cy + ny * u;
          if (onRoad(x, y)) px.put(x, y, road.center);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Start line, gantry and grandstand                                   */
/* ------------------------------------------------------------------ */

function paintStart(px: Pix, s0: Sample, half: number) {
  for (let u = -half; u <= half; u += 0.5)
    for (let v = -4; v < 4; v += 0.5) {
      const col = (Math.floor((u + half) / 3) + Math.floor((v + 4) / 3)) % 2 ? [245, 245, 245] : [20, 20, 24];
      px.put(s0.x + s0.nx * u + s0.tx * v, s0.y + s0.ny * u + s0.ty * v, col, ASPHALT);
    }
  // eight grid slots: two columns, staggered
  for (let g = 0; g < 8; g++) {
    const back = 22 + (g >> 1) * 18 + (g & 1) * 9;
    const lat = g & 1 ? 12 : -12;
    const cx = s0.x - s0.tx * back + s0.nx * lat;
    const cy = s0.y - s0.ty * back + s0.ny * lat;
    for (let u = -6; u <= 6; u += 0.5) px.put(cx + s0.nx * u - s0.tx * 7, cy + s0.ny * u - s0.ty * 7, [230, 230, 230]);
    for (let v = -7; v <= -3; v += 0.5) {
      px.put(cx + s0.nx * -6 + s0.tx * v, cy + s0.ny * -6 + s0.ty * v, [230, 230, 230]);
      px.put(cx + s0.nx * 6 + s0.tx * v, cy + s0.ny * 6 + s0.ty * v, [230, 230, 230]);
    }
  }
  // gantry: two posts beside the road, and the shadow of the bar that the renderer draws across it
  const edge = half + 9;
  for (const side of [-1, 1]) {
    const cx = s0.x + s0.nx * side * edge;
    const cy = s0.y + s0.ny * side * edge;
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) {
        const c: RGB = a < 0 && b < 0 ? [153, 153, 170] : a > 0 || b > 0 ? [34, 34, 51] : [85, 85, 102];
        px.put(cx + a, cy + b, c, SOLID);
      }
  }
  for (let u = -edge; u <= edge; u += 0.5)
    for (let t = 0; t < 2; t++) px.darken(s0.x + s0.nx * u + 4 + t, s0.y + s0.ny * u + 6, 0.7);
}

/** Tiered stand to the left of the start line (looking along the track), drawn in the track's own orientation. */
function paintGrandstand(px: Pix, s0: Sample, half: number) {
  const off = half + 24;
  const SEATS: RGB[] = [[153, 153, 170], [119, 119, 136]];
  const CROWD: RGB[] = [[221, 51, 34], [255, 204, 51], [51, 102, 221], [238, 238, 238], [34, 170, 68], [255, 136, 170]];
  const at = (x: number, y: number, c: RGB) => px.put(s0.x + s0.nx * (x - off) + s0.tx * y, s0.y + s0.ny * (x - off) + s0.ty * y, c, SOLID);
  for (let y = -56; y < 56; y += 0.5)
    for (let x = -10; x < 10; x += 0.5) {
      let c: RGB;
      if (x < -8) c = [51, 51, 68]; // back wall
      else if (x >= 8) c = x >= 9 ? [34, 34, 51] : [187, 187, 204]; // front rail with its highlight
      else {
        const tier = Math.floor((x + 8) / 2);
        c = SEATS[tier % 2];
        const cx = Math.floor(y / 3);
        const h = hash2(cx, tier, 21);
        if (h % 100 < 62 && (x + 8) % 2 < 1.5) {
          const col = CROWD[(h >>> 7) % CROWD.length];
          c = Math.floor(y) % 3 === 0 ? shade(col, 1.25) : Math.floor(y) % 3 === 1 ? col : shade(col, 0.7);
        }
      }
      if (y < -55 || y >= 55) c = [34, 34, 51]; // outline at the ends
      at(x, y, c);
    }
}

/* ------------------------------------------------------------------ */
/* Scenery                                                             */
/* ------------------------------------------------------------------ */

type Edge = (dx: number, dy: number) => number;

/**
 * Paints a cel-shaded blob. `edge` says how far inside the shape a point is (0 at the outline, up to 1 in the middle,
 * negative outside). Light comes from the top left, so the top-left is lit and the bottom-right is dark, in flat
 * bands with a dark rim all round.
 */
function paintBlob(px: Pix, cx: number, cy: number, r: number, edge: Edge, pal: PropPalette, rng: () => number, reach: number, solid: boolean) {
  const R = Math.ceil(reach);
  // cast shadow, offset down-right
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      if (edge(dx - 3, dy - 3) < 0 || edge(dx, dy) >= 0) continue;
      const X = Math.floor(cx + dx);
      const Y = Math.floor(cy + dy);
      if (px.at(X, Y) === GRASS) px.darken(X, Y, 0.62);
    }
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const e = edge(dx, dy);
      if (e < 0) continue;
      const X = Math.floor(cx + dx);
      const Y = Math.floor(cy + dy);
      if (e < 0.16) {
        px.put(X, Y, pal.rim, solid ? SOLID : undefined);
        continue;
      }
      const light = clamp((-dx - dy) / (1.4 * r), -1, 1) * 0.5 + 0.5;
      void rng;
      px.put(X, Y, band(pal.ramp, clamp(light * 0.85 + e * 0.3, 0, 0.999) * 4), solid ? SOLID : undefined);
    }
}

const lobeEdge = (lobes: { x: number; y: number; r: number }[]): Edge => (dx, dy) => {
  let e = -1;
  for (const l of lobes) e = Math.max(e, 1 - Math.hypot(dx - l.x, dy - l.y) / l.r);
  return e;
};

function paintProp(px: Pix, style: PropStyle, x: number, y: number, r: number, pal: PropPalette, rng: () => number) {
  const ph = rng() * TAU;
  if (style === 'tree' || style === 'bush') {
    const lobes = [{ x: 0, y: 0, r: r * 0.85 }];
    for (let k = 0; k < 3; k++) {
      const a = ph + k * 2.1;
      lobes.push({ x: Math.cos(a) * r * 0.5, y: Math.sin(a) * r * 0.5, r: r * 0.62 });
    }
    paintBlob(px, x, y, r, lobeEdge(lobes), pal, rng, r * 1.25, style === 'tree');
  } else if (style === 'pine') {
    // a six-pointed star of branches
    const edge: Edge = (dx, dy) => 1 - Math.hypot(dx, dy) / (r * (0.58 + 0.42 * Math.abs(Math.cos(3 * Math.atan2(dy, dx) + ph))));
    paintBlob(px, x, y, r, edge, pal, rng, r * 1.1, true);
    px.put(x, y, pal.rim, SOLID);
  } else if (style === 'rock') {
    const edge: Edge = (dx, dy) => 1 - Math.hypot(dx, dy) / (r * (0.8 + 0.2 * Math.sin(2.3 * Math.atan2(dy, dx) + ph)));
    paintBlob(px, x, y, r, edge, pal, rng, r * 1.1, true);
  } else if (style === 'cactus') {
    const edge: Edge = (dx, dy) => Math.max(Math.min(1.6 - Math.abs(dx), r + 1 - Math.abs(dy)) / 1.6, Math.min(1.4 - Math.abs(dy + 1), r * 0.9 - Math.abs(dx)) / 1.4);
    paintBlob(px, x, y, r, edge, pal, rng, r + 2, true);
  }
}

/** Buildings: flat roofs seen from above, with a long shadow, a paved apron, seams, air-conditioning units and skylights. */
function paintBuilding(px: Pix, x: number, y: number, hw: number, hh: number, roof: RGB, track: Track, rng: () => number) {
  const { ground } = track.theme;
  for (let dy = -hh - 3; dy <= hh + 3; dy++)
    for (let dx = -hw - 3; dx <= hw + 3; dx++) {
      if (px.at(x + dx, y + dy) === GRASS) px.put(x + dx, y + dy, ground[3]); // apron
    }
  for (let dy = -hh; dy <= hh + 6; dy++)
    for (let dx = -hw; dx <= hw + 6; dx++) {
      const inRoof = dx <= hw && dy <= hh;
      if (!inRoof && dx + 0 >= -hw + 5 && dy >= -hh + 5 && px.at(x + dx, y + dy) === GRASS) px.darken(x + dx, y + dy, 0.6); // shadow
    }
  const light = shade(roof, 1.3);
  const dark = shade(roof, 0.68);
  const rim = shade(roof, 0.4);
  for (let dy = -hh; dy <= hh; dy++)
    for (let dx = -hw; dx <= hw; dx++) {
      let c = roof;
      if (dy === -hh || dx === -hw || dy === hh || dx === hw) c = rim;
      else if (dy === -hh + 1 || dx === -hw + 1) c = light;
      else if (dy === hh - 1 || dx === hw - 1) c = dark;
      else if ((dy + hh) % 7 === 0) c = dark; // roof seams
      px.put(x + dx, y + dy, c, SOLID);
    }
  // rooftop gear
  const units = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < units; k++) {
    const ux = Math.round(x + (rng() - 0.5) * (hw - 4) * 1.6);
    const uy = Math.round(y + (rng() - 0.5) * (hh - 4) * 1.6);
    if (rng() < 0.5) {
      for (let a = -2; a <= 2; a++) for (let b = -1; b <= 1; b++) px.put(ux + a, uy + b, a === -2 || b === -1 ? [187, 187, 204] : [119, 119, 136], SOLID);
    } else {
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) px.put(ux + a, uy + b, a === -2 || b === -2 ? [204, 238, 255] : [102, 170, 221], SOLID);
    }
  }
}

const SIZE: Record<PropStyle, [number, number]> = { tree: [6, 10], pine: [6, 10], bush: [3, 5], cactus: [3, 5], rock: [3, 7], building: [9, 20] };

function plantProps(px: Pix, track: Track, rng: () => number): Tree[] {
  const { width: W, height: H, theme, props } = track;
  const trees: Tree[] = [];
  const placed: { x: number; y: number; r: number }[] = [];
  const total = props.mix.reduce((s, [, w]) => s + w, 0);
  const pick = () => {
    let t = rng() * total;
    for (const [style, w] of props.mix) if ((t -= w) <= 0) return style;
    return props.mix[0][0];
  };
  const isClear = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy += 3)
      for (let dx = -r; dx <= r; dx += 3) {
        const X = Math.floor(x + dx);
        const Y = Math.floor(y + dy);
        if (X < 4 || Y < 4 || X >= W - 4 || Y >= H - 4) return false;
        if (px.surf[Y * W + X] !== GRASS) return false;
      }
    return true;
  };
  let tries = 0;
  let count = 0;
  while (count < props.count && tries++ < 6000) {
    const style = pick();
    const [lo, hi] = SIZE[style];
    const r = Math.round(lo + rng() * (hi - lo));
    const x = Math.round(10 + rng() * (W - 20));
    const y = Math.round(10 + rng() * (H - 20));
    const margin = style === 'building' ? r + 14 : r + (style === 'bush' ? 8 : 14);
    if (!isClear(x, y, margin)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + (style === 'building' ? 10 : 5))) continue;
    placed.push({ x, y, r });
    count++;
    if (style === 'building') {
      const hw = r;
      const hh = Math.round(lo + rng() * (hi - lo));
      paintBuilding(px, x, y, hw, hh, theme.roofs[Math.floor(rng() * theme.roofs.length)], track, rng);
      continue;
    }
    const pal = theme.props[style] ?? theme.props.tree;
    if (!pal) continue;
    paintProp(px, style, x, y, r, pal, rng);
    if (style !== 'bush') trees.push({ x, y, r });
  }
  return trees;
}

/** Red and white tyre stacks on the outside of the sharpest corners, where a car that overcooks it ends up. */
function plantTyres(px: Pix, S: Sample[], hw: Float32Array, turn: Float32Array): Tree[] {
  const N = S.length;
  const out: Tree[] = [];
  const R = 3;
  for (let i = 4; i < N - 4 && out.length < 70; i += 2) {
    if (turn[i] < 0.6) continue;
    const a = S[i];
    const b = S[(i + 18) % N];
    const outside = a.tx * b.ty - a.ty * b.tx > 0 ? -1 : 1; // normal points to the right of travel
    const lat = outside * (hw[i] + 22);
    const x = Math.round(a.x + a.nx * lat);
    const y = Math.round(a.y + a.ny * lat);
    let free = true;
    for (let dy = -R - 1; dy <= R + 1 && free; dy++) for (let dx = -R - 1; dx <= R + 1; dx++) if (px.at(x + dx, y + dy) !== GRASS) free = false;
    if (!free || out.some((t) => Math.hypot(t.x - x, t.y - y) < 7)) continue;
    const col: RGB = out.length % 2 ? [238, 238, 238] : [221, 51, 34];
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > R + 0.3) continue;
        const c: RGB = d > R - 0.8 ? [34, 17, 17] : d < 1.2 ? [17, 17, 17] : dx + dy < 0 ? shade(col, 1.2) : col;
        px.put(x + dx, y + dy, c, SOLID);
      }
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (Math.hypot(dx - 3, dy - 3) < 2 && px.at(x + dx + 3, y + dy + 3) === GRASS) px.darken(x + dx + 3, y + dy + 3, 0.7);
    out.push({ x, y, r: R, kind: 'tire' });
  }
  return out;
}

/** Water with a sandy shore, deep in the middle; stays clear of the road. Returns its bounding box. */
function paintLake(px: Pix, track: Track) {
  const { width: W, height: H } = track;
  const { x: lx, y: ly, rx, ry } = track.lake!;
  const water = track.theme.water;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? GRASS : px.surf[y * W + x]);
  let x0 = W;
  let y0 = H;
  let x1 = 0;
  let y1 = 0;
  for (let dy = -(ry + 8); dy <= ry + 8; dy++)
    for (let dx = -(rx + 5); dx <= rx + 5; dx++) {
      const e = (dx / rx) ** 2 + (dy / ry) ** 2 + Math.sin(dx * 0.07) * 0.05;
      const X = Math.floor(lx + dx);
      const Y = Math.floor(ly + dy);
      if (e > 1 || at(X, Y) !== GRASS) continue;
      let near = false;
      for (const o of [[8, 0], [-8, 0], [0, 8], [0, -8]]) {
        const v = at(X + o[0], Y + o[1]);
        if (v === ASPHALT || v === CURB) near = true;
      }
      if (near) continue;
      if (e > 0.88) {
        px.put(X, Y, e > 0.95 ? shade(water.shore, 0.85) : water.shore);
      } else {
        px.put(X, Y, e > 0.66 ? water.mid : water.deep, WATER);
        x0 = Math.min(x0, X);
        y0 = Math.min(y0, Y);
        x1 = Math.max(x1, X);
        y1 = Math.max(y1, Y);
      }
    }
  return x1 > x0 ? { x0, y0, x1, y1 } : null;
}

/* ------------------------------------------------------------------ */
/* Boost strips and hazards                                            */
/* ------------------------------------------------------------------ */

/** Boost strips go on the long straights, spread round the lap and away from the start grid. */
function placeBoosts(S: Sample[], turn: Float32Array): { pad: BoostPad; idx: number }[] {
  const N = S.length;
  const out: { pad: BoostPad; idx: number }[] = [];
  let last = -1e9;
  for (let i = 80; i < N - 60 && out.length < 4; i++) {
    let straight = true;
    for (let k = 0; k < 30 && straight; k++) if (turn[(i + k) % N] > 0.14) straight = false;
    if (!straight || i - last < N / 5) continue;
    const s = S[i + 15];
    out.push({ pad: { x: s.x, y: s.y, tx: s.tx, ty: s.ty }, idx: i + 15 });
    last = i;
  }
  return out;
}

function paintBoost(px: Pix, p: BoostPad) {
  const nx = -p.ty;
  const ny = p.tx;
  for (let u = -14; u <= 14; u += 0.5)
    for (let v = -12; v <= 12; v += 0.5) {
      let c: RGB = [17, 34, 68];
      if (Math.abs(u) >= 13 || Math.abs(v) >= 11.5) c = [255, 221, 51];
      else if ((((v + Math.abs(u) * 0.5 + 100) % 8) + 8) % 8 < 3) c = [85, 238, 255];
      else if ((((v + Math.abs(u) * 0.5 + 100) % 8) + 8) % 8 < 4) c = [34, 119, 187];
      px.put(p.x + nx * u + p.tx * v, p.y + ny * u + p.ty * v, c);
    }
}

/** Puddles (less grip) and oil (almost none) scattered on the asphalt. Same track, same spots. */
function paintHazards(px: Pix, hazard: Uint8Array, track: Track, S: Sample[], hw: Float32Array, avoid: number[]) {
  const { width: W, height: H } = track;
  const N = S.length;
  let h = 2166136261;
  for (const ch of track.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rng = mulberry32(h >>> 0);
  const placed: number[] = [...avoid];
  const kinds = [HAZ_PUDDLE, HAZ_PUDDLE, HAZ_OIL, HAZ_PUDDLE, HAZ_PUDDLE, HAZ_OIL, HAZ_PUDDLE, HAZ_OIL, HAZ_PUDDLE];
  for (const kind of kinds) {
    let idx = -1;
    for (let t = 0; t < 40 && idx < 0; t++) {
      const i = 80 + Math.floor(rng() * (N - 140));
      if (placed.every((p) => Math.min(Math.abs(p - i), N - Math.abs(p - i)) > 24)) idx = i;
    }
    if (idx < 0) continue;
    placed.push(idx);
    const s = S[idx];
    const lat = (rng() - 0.5) * 2 * hw[idx] * 0.6;
    const cx = s.x + s.nx * lat;
    const cy = s.y + s.ny * lat;
    const rA = kind === HAZ_PUDDLE ? 11 + rng() * 6 : 8 + rng() * 3; // across the road
    const rB = kind === HAZ_PUDDLE ? rA * 0.7 : rA; // along it
    for (let dy = -rA - 2; dy <= rA + 2; dy += 0.5)
      for (let dx = -rA - 2; dx <= rA + 2; dx += 0.5) {
        // dx runs across the road (normal), dy along it (tangent)
        const e = (dx / rA) ** 2 + (dy / rB) ** 2 + Math.sin(dx * 0.5 + dy * 0.3) * 0.06;
        if (e > 1) continue;
        const X = Math.floor(cx + s.nx * dx + s.tx * dy);
        const Y = Math.floor(cy + s.ny * dx + s.ty * dy);
        if (X < 0 || Y < 0 || X >= W || Y >= H || px.surf[Y * W + X] !== ASPHALT) continue;
        hazard[Y * W + X] = kind;
        let c: RGB;
        if (kind === HAZ_PUDDLE) {
          const rim = e > 0.78;
          c = rim ? [34, 68, 102] : dx + dy < -rA * 0.7 && dx + dy > -rA * 0.95 ? [170, 204, 238] : [51, 102, 153];
        } else {
          c = e > 0.8 ? [34, 34, 51] : dx + dy < -rA * 0.35 && dx + dy > -rA * 0.6 ? [85, 51, 119] : [17, 17, 24];
        }
        px.put(X, Y, c);
      }
  }
}

/* ------------------------------------------------------------------ */

function makeMinimap(S: Sample[], track: Track) {
  const mini = document.createElement('canvas');
  mini.width = 70;
  mini.height = 50;
  const m = mini.getContext('2d')!;
  m.fillStyle = '#001';
  m.fillRect(0, 0, 70, 50);
  const X = (s: Sample) => ((s.x / track.width) * 62 + 4) | 0;
  const Y = (s: Sample) => ((s.y / track.height) * 42 + 4) | 0;
  m.fillStyle = '#668';
  for (const s of S) m.fillRect(X(s) - 1, Y(s) - 1, 3, 3);
  m.fillStyle = '#ccd';
  for (const s of S) m.fillRect(X(s), Y(s), 1, 1);
  m.fillStyle = '#fd3';
  m.fillRect(X(S[0]) - 1, Y(S[0]) - 1, 3, 3);
  // bevel
  m.fillStyle = '#aab';
  m.fillRect(0, 0, 70, 1);
  m.fillRect(0, 0, 1, 50);
  m.fillStyle = '#224';
  m.fillRect(0, 49, 70, 1);
  m.fillRect(69, 0, 1, 50);
  return mini;
}

/** Paints the whole world bitmap and its surface and hazard maps. */
export function paintWorld(track: Track, S: Sample[], hw: Float32Array, turn: Float32Array): Painted {
  const rng = mulberry32(
    [...track.id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0,
  );
  const noise = makeNoise(rng);
  const px = paintTerrain(track, S, hw, noise);
  paintGroundDetail(px, track);
  paintEdges(px, track);
  paintMarkings(px, S, hw, track);
  paintStart(px, S[0], track.halfWidth);
  paintGrandstand(px, S[0], track.halfWidth);
  const boosts = placeBoosts(S, turn);
  for (const b of boosts) paintBoost(px, b.pad);
  const hazard = new Uint8Array(track.width * track.height);
  paintHazards(px, hazard, track, S, hw, boosts.map((b) => b.idx));
  const water = track.lake ? paintLake(px, track) : null;
  const trees = [...plantTyres(px, S, hw, turn), ...plantProps(px, track, rng)];
  quantize(px.d);
  return { img: px.img, surf: px.surf, hazard, trees, boosts: boosts.map((b) => b.pad), water, mini: makeMinimap(S, track) };
}
