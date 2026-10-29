import type { GameApi, GameInstance } from '../engine/types';
import { drawText } from '../engine/pixelfont';
import { TAU, clamp, formatTime, rnd, wrapAngle } from '../engine/util';

const SW = 320;
const SH = 200;
const WW = 1400;
const WH = 1000;
const HALF = 30; // half road width on the straights
const CORNER_EXTRA = 18; // how much wider each side gets in the sharpest corners
const LAPS = 2;
const ROT = 64;
const OFFROAD = 55; // grass beyond the curb before the player is reset

/* ------------------------------------------------------------------ */
/* Track and world are built once per page load and shared by turns.   */
/* ------------------------------------------------------------------ */

interface Sample {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}
interface Tree {
  x: number;
  y: number;
  r: number;
}
interface World {
  S: Sample[];
  N: number;
  aiSpd: Float32Array;
  hw: Float32Array; // half road width per sample (wider in corners so there is room to drift)
  base: ImageData;
  surf: Uint8Array; // 0 grass, 1 asphalt, 2 curb, 3 solid, 4 water
  trees: Tree[];
  mini: HTMLCanvasElement;
  looks: { col: string; frames: HTMLCanvasElement[]; shadows: HTMLCanvasElement[] }[];
}
let WORLD: World | null = null;

const CP: [number, number][] = [
  [200, 560], [200, 300], [300, 170], [480, 160], [560, 280], [520, 420], [640, 520], [820, 480], [900, 300], [1050, 180],
  [1220, 240], [1250, 420], [1120, 520], [1150, 680], [1240, 800], [1100, 880], [800, 860], [640, 760], [480, 860], [300, 880], [200, 800],
];

function cr(a: number, b: number, c: number, d: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

function buildWorld(): World {
  const dense: [number, number][] = [];
  for (let i = 0; i < CP.length; i++) {
    const p0 = CP[(i - 1 + CP.length) % CP.length];
    const p1 = CP[i];
    const p2 = CP[(i + 1) % CP.length];
    const p3 = CP[(i + 2) % CP.length];
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      dense.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  const S: Sample[] = [];
  {
    let acc = 0;
    S.push({ x: dense[0][0], y: dense[0][1], tx: 0, ty: 0, nx: 0, ny: 0 });
    for (let i = 1; i <= dense.length; i++) {
      const a: [number, number] = [dense[i - 1][0], dense[i - 1][1]];
      const b = dense[i % dense.length];
      let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc + seg >= 4) {
        const t = (4 - acc) / seg;
        const nx = a[0] + (b[0] - a[0]) * t;
        const ny = a[1] + (b[1] - a[1]) * t;
        S.push({ x: nx, y: ny, tx: 0, ty: 0, nx: 0, ny: 0 });
        a[0] = nx;
        a[1] = ny;
        seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        acc = 0;
      }
      acc += seg;
    }
  }
  const N = S.length;
  for (let i = 0; i < N; i++) {
    const a = S[(i - 1 + N) % N];
    const b = S[(i + 1) % N];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    S[i].tx = (b.x - a.x) / l;
    S[i].ty = (b.y - a.y) / l;
    S[i].nx = -S[i].ty;
    S[i].ny = S[i].tx;
  }
  const aiSpd = new Float32Array(N);
  {
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.atan2(S[i].ty, S[i].tx);
      const b = Math.atan2(S[(i + 18) % N].ty, S[(i + 18) % N].tx);
      raw[i] = 4.0 - clamp(Math.abs(wrapAngle(b - a)) / 1.25, 0, 1) * 2.2;
    }
    for (let i = 0; i < N; i++) {
      let m = 9;
      for (let k = 0; k < 26; k++) m = Math.min(m, raw[(i + k) % N]);
      aiSpd[i] = m;
    }
  }

  // the road widens in corners: how sharply it turns ahead, spread out smoothly
  const hw = new Float32Array(N);
  {
    const turn = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.atan2(S[i].ty, S[i].tx);
      const b = Math.atan2(S[(i + 18) % N].ty, S[(i + 18) % N].tx);
      turn[i] = clamp(Math.abs(wrapAngle(b - a)) / 1.0, 0, 1);
    }
    const peak = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let k = -14; k <= 22; k++) m = Math.max(m, turn[(i + k + N) % N]);
      peak[i] = m;
    }
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -12; k <= 12; k++) sum += peak[(i + k + N) % N];
      hw[i] = HALF + CORNER_EXTRA * (sum / 25);
    }
    hw[0] = HALF;
  }

  const cv = document.createElement('canvas');
  cv.width = WW;
  cv.height = WH;
  const w = cv.getContext('2d', { willReadFrequently: true })!;
  const surf = new Uint8Array(WW * WH);
  w.fillStyle = 'rgb(60,138,58)';
  w.fillRect(0, 0, WW, WH);
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
  const img = w.getImageData(0, 0, WW, WH);
  const d = img.data;
  const refs = [
    [60, 138, 58, 0],
    [216, 50, 42, 2],
    [236, 236, 236, 3],
    [85, 87, 101, 1],
  ];
  for (let p = 0, i = 0; p < WW * WH; p++, i += 4) {
    let best = 0;
    let bd = 1e9;
    for (let k = 0; k < 4; k++) {
      const r = refs[k];
      const e = (d[i] - r[0]) ** 2 + (d[i + 1] - r[1]) ** 2 + (d[i + 2] - r[2]) ** 2;
      if (e < bd) {
        bd = e;
        best = k;
      }
    }
    const x = p % WW;
    const y = (p / WW) | 0;
    const cls = refs[best][3];
    let c: number[];
    if (cls === 0) {
      const band = Math.floor((x + y * 0.4) / 22) % 2;
      c = band ? [58, 132, 54] : [66, 146, 60];
      const r = Math.random();
      if (r < 0.06) c = [48, 116, 46];
      else if (r < 0.09) c = [84, 160, 70];
      surf[p] = 0;
    } else if (cls === 1) {
      c = [84, 86, 98];
      const r = Math.random();
      if (r < 0.09) c = [74, 76, 88];
      else if (r < 0.12) c = [98, 100, 112];
      surf[p] = 1;
    } else if (cls === 2) {
      c = [216, 50, 42];
      surf[p] = 2;
    } else {
      c = [236, 236, 236];
      surf[p] = 2;
    }
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  }
  const set = (x: number, y: number, c: number[], s?: number) => {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= WW || y >= WH) return;
    const i = (y * WW + x) * 4;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    if (s !== undefined) surf[y * WW + x] = s;
  };
  const s0 = S[0];
  for (let u = -HALF; u <= HALF; u += 0.5)
    for (let v = -4; v < 4; v += 0.5) {
      const col = (Math.floor((u + HALF) / 3) + Math.floor((v + 4) / 3)) % 2 ? [245, 245, 245] : [20, 20, 24];
      set(s0.x + s0.nx * u + s0.tx * v, s0.y + s0.ny * u + s0.ty * v, col, 1);
    }
  for (let g = 0; g < 4; g++) {
    const back = 22 + g * 18;
    const lat = g % 2 ? 12 : -12;
    const cx = s0.x - s0.tx * back + s0.nx * lat;
    const cy = s0.y - s0.ty * back + s0.ny * lat;
    for (let u = -6; u <= 6; u += 0.5) set(cx + s0.nx * u - s0.tx * 7, cy + s0.ny * u - s0.ty * 7, [230, 230, 230]);
    for (let v = -7; v <= -3; v += 0.5) {
      set(cx + s0.nx * -6 + s0.tx * v, cy + s0.ny * -6 + s0.ty * v, [230, 230, 230]);
      set(cx + s0.nx * 6 + s0.tx * v, cy + s0.ny * 6 + s0.ty * v, [230, 230, 230]);
    }
  }
  // grandstand
  const gx = s0.x + s0.nx * -(HALF + 24);
  const gy = s0.y;
  const crowd = [
    [228, 53, 43],
    [255, 210, 63],
    [60, 110, 220],
    [242, 240, 234],
  ];
  for (let y = -56; y < 56; y++)
    for (let x = -10; x < 10; x++) {
      let c = x < -6 ? [120, 124, 140] : (y + 56) % 4 < 2 ? [176, 180, 196] : [150, 154, 170];
      if (x >= -6 && Math.random() < 0.35) c = crowd[Math.floor(Math.random() * 4)];
      set(gx + x, gy + y, c, 3);
    }
  for (let y = -56; y < 56; y++) set(gx + 10, gy + y, [30, 30, 36], 3);
  // trees
  const trees: Tree[] = [];
  const isClear = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy += 3)
      for (let dx = -r; dx <= r; dx += 3) {
        const X = (x + dx) | 0;
        const Y = (y + dy) | 0;
        if (X < 4 || Y < 4 || X >= WW - 4 || Y >= WH - 4) return false;
        if (surf[Y * WW + X] !== 0) return false;
      }
    return true;
  };
  let tries = 0;
  while (trees.length < 70 && tries++ < 4000) {
    const x = rnd(10, WW - 10);
    const y = rnd(10, WH - 10);
    const r = rnd(5, 8) | 0;
    if (!isClear(x, y, r + 16)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r + 6)) continue;
    trees.push({ x, y, r });
  }
  for (const t of trees) {
    for (let dy = -t.r; dy <= t.r; dy++) for (let dx = -t.r; dx <= t.r; dx++) if (Math.hypot(dx, dy) <= t.r) set(t.x + dx + 3, t.y + dy + 3, [34, 86, 34]);
    for (let dy = -t.r; dy <= t.r; dy++)
      for (let dx = -t.r; dx <= t.r; dx++) {
        const dd = Math.hypot(dx, dy) + Math.random() * 0.8;
        if (dd > t.r) continue;
        const c = dd > t.r - 1.2 ? [22, 64, 30] : dx + dy < -t.r * 0.5 ? [96, 176, 72] : dx + dy > t.r * 0.4 ? [38, 100, 42] : [52, 128, 52];
        set(t.x + dx, t.y + dy, c, 3);
      }
  }
  // lake
  const lx = 1000;
  const ly = 640;
  for (let dy = -70; dy <= 70; dy++)
    for (let dx = -110; dx <= 110; dx++) {
      const e = (dx / 105) ** 2 + (dy / 62) ** 2 + Math.sin(dx * 0.07) * 0.05;
      const X = (lx + dx) | 0;
      const Y = (ly + dy) | 0;
      if (e > 1 || surf[Y * WW + X] !== 0) continue;
      let near = false;
      for (const o of [
        [8, 0],
        [-8, 0],
        [0, 8],
        [0, -8],
      ]) {
        const v = surf[(Y + o[1]) * WW + X + o[0]];
        if (v === 1 || v === 2) near = true;
      }
      if (near) continue;
      const c = e > 0.88 ? [214, 196, 140] : (dx + dy * 3 + ((dy * 7) % 5)) % 17 === 0 ? [140, 200, 240] : [48, 110, 190];
      set(X, Y, c, e > 0.88 ? 0 : 4);
    }

  const mini = document.createElement('canvas');
  mini.width = 70;
  mini.height = 50;
  {
    const m = mini.getContext('2d')!;
    m.fillStyle = 'rgba(0,0,0,.55)';
    m.fillRect(0, 0, 70, 50);
    m.fillStyle = '#d8d8e0';
    for (const s of S) m.fillRect(((s.x / WW) * 66 + 2) | 0, ((s.y / WH) * 46 + 2) | 0, 1, 1);
  }

  const CAR = ['..tt.....tt...', '.dwwwwwwwwwwd.', 'rwwgdddddggwwl', 'rwwgdsdsdggwww', 'rwwgdsdsdggwww', 'rwwgdddddggwwl', '.dwwwwwwwwwwd.', '..tt.....tt...'];
  const makeFrames = (body: string, darkc: string, stripe: string) => {
    const pal: Record<string, string> = { t: '#101014', d: darkc, w: body, g: '#9fd8ff', s: stripe, r: '#ff4a3a', l: '#fff6b0' };
    const frames: HTMLCanvasElement[] = [];
    const shadows: HTMLCanvasElement[] = [];
    for (let k = 0; k < ROT; k++) {
      const th = (k / ROT) * TAU;
      const co = Math.cos(th);
      const si = Math.sin(th);
      const f = document.createElement('canvas');
      f.width = f.height = 18;
      const fc = f.getContext('2d')!;
      const sh = document.createElement('canvas');
      sh.width = sh.height = 18;
      const sc = sh.getContext('2d')!;
      sc.fillStyle = '#000';
      for (let oy = 0; oy < 18; oy++)
        for (let ox = 0; ox < 18; ox++) {
          const x = ox + 0.5 - 9;
          const y = oy + 0.5 - 9;
          const sx = x * co + y * si + 7;
          const sy = -x * si + y * co + 4;
          if (sx < 0 || sy < 0 || sx >= 14 || sy >= 8) continue;
          const ch = CAR[sy | 0][sx | 0];
          if (ch === '.') continue;
          fc.fillStyle = pal[ch];
          fc.fillRect(ox, oy, 1, 1);
          sc.fillRect(ox, oy, 1, 1);
        }
      frames.push(f);
      shadows.push(sh);
    }
    return { frames, shadows };
  };
  const looks = [
    { col: '#e4352b', ...makeFrames('#e4352b', '#8e1a14', '#ffd23f') },
    { col: '#3a78e8', ...makeFrames('#3a78e8', '#1c3e8a', '#f2f0ea') },
    { col: '#f2c230', ...makeFrames('#f2c230', '#8f6f10', '#17181f') },
    { col: '#3cbf5a', ...makeFrames('#3cbf5a', '#1d7032', '#f2f0ea') },
  ];

  return { S, N, aiSpd, hw, base: img, surf, trees, mini, looks };
}

/* ------------------------------------------------------------------ */

interface Car {
  look: number;
  ai: boolean;
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  vf: number;
  vr: number;
  steer: number;
  slide: boolean;
  idx: number;
  lap: number;
  done: boolean;
  skill: number;
  lane: number;
  laneT: number;
  grass: boolean;
  glob: number;
}
interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  kind: 'smoke' | 'dirt' | 'leaf';
}
interface DriveInput {
  steer: number;
  gas: boolean;
  brake: boolean;
  hand: boolean;
}

export function createGame(api: GameApi): GameInstance {
  const { ctx, input, audio } = api;
  ctx.imageSmoothingEnabled = false;
  const Wd = (WORLD ??= buildWorld());
  const { S, N, aiSpd, hw, surf, trees, mini, looks } = Wd;

  const world = document.createElement('canvas');
  world.width = WW;
  world.height = WH;
  const wctx = world.getContext('2d')!;
  wctx.putImageData(Wd.base, 0, 0);

  const surfAt = (x: number, y: number) => {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= WW || y >= WH) return 0;
    return surf[y * WW + x];
  };
  const nearestIdx = (x: number, y: number, from: number, back = 20, fwd = 50) => {
    let bi = from;
    let bd = 1e18;
    for (let k = -back; k <= fwd; k++) {
      const i = (((from + k) % N) + N) % N;
      const s = S[i];
      const dd = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (dd < bd) {
        bd = dd;
        bi = i;
      }
    }
    return bi;
  };
  const globalIdx = (x: number, y: number) => {
    let bi = 0;
    let bd = 1e18;
    for (let i = 0; i < N; i++) {
      const dd = (S[i].x - x) ** 2 + (S[i].y - y) ** 2;
      if (dd < bd) {
        bd = dd;
        bi = i;
      }
    }
    return bi;
  };

  // engine sound
  const eng = (() => {
    const c = audio.ctx;
    const out = audio.out;
    if (!c || !out) return null;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const o2 = c.createOscillator();
    o2.type = 'square';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const eg = c.createGain();
    eg.gain.value = 0;
    o.connect(lp);
    o2.connect(lp);
    lp.connect(eg).connect(out);
    o.start();
    o2.start();
    const nb = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = c.createBufferSource();
    ns.buffer = nb;
    ns.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 4;
    const sg = c.createGain();
    sg.gain.value = 0;
    ns.connect(bp).connect(sg).connect(out);
    ns.start();
    return { c, o, o2, eg, sg, ns };
  })();
  api.onCleanup(() => {
    if (!eng) return;
    try {
      eng.o.stop();
      eng.o2.stop();
      eng.ns.stop();
      eng.eg.disconnect();
      eng.sg.disconnect();
    } catch {
      /* already stopped */
    }
  });
  const thump = () => {
    audio.tone(70, 0.18, 'sine', 0.25);
    audio.tone(140, 0.08, 'square', 0.05);
  };

  // race state
  const s0 = S[0];
  const a0 = Math.atan2(s0.ty, s0.tx);
  const cars: Car[] = [1, 2, 3, 0].map((look, g) => {
    const back = 22 + g * 18 + 3;
    const lat = g % 2 ? 12 : -12;
    const x = s0.x - s0.tx * back + s0.nx * lat;
    const y = s0.y - s0.ty * back + s0.ny * lat;
    return {
      look,
      ai: look !== 0,
      x,
      y,
      a: a0,
      vx: 0,
      vy: 0,
      vf: 0,
      vr: 0,
      steer: 0,
      slide: false,
      idx: globalIdx(x, y),
      lap: 0,
      done: false,
      skill: [0, 0.9, 0.95, 0.92][look],
      lane: rnd(-10, 10),
      laneT: 0,
      grass: false,
      glob: 0,
    };
  });
  const player = cars.find((c) => !c.ai)!;
  const finishers: Car[] = [];
  let parts: Part[] = [];
  let state: 'race' | 'done' = 'race';
  let raceT = 0;
  let doneT = 0;
  let finalRaw = 0;
  let camX = player.x;
  let camY = player.y;
  let driftTotal = 0;
  let chain = 0;
  let chainT = 0;
  let popup: { n: string; l: string; t: number; miss?: boolean } | null = null;
  let banner: { a: string; b: string; t: number } | null = { a: 'GO!', b: '', t: 50 };

  const progress = (c: Car) => (c.done ? 1e9 - finishers.indexOf(c) : c.lap * N + c.idx);
  const position = () => [...cars].sort((a, b) => progress(b) - progress(a)).indexOf(player) + 1;
  let lastHud = '';
  function status() {
    const items = [
      { label: 'LAP', value: `${clamp(player.lap, 1, LAPS)}/${LAPS}` },
      { label: 'POS', value: `${position()}/4` },
      { label: 'DRIFT', value: driftTotal },
    ];
    const key = JSON.stringify(items);
    if (key !== lastHud) {
      lastHud = key;
      api.setStatus(items);
    }
  }

  function loseChain() {
    if (chain > 30) {
      popup = { n: String(Math.round(chain)), l: 'LOST', t: 60, miss: true };
      audio.tone(160, 0.25, 'sawtooth', 0.05);
    }
    chain = 0;
    chainT = 0;
  }

  function drive(c: Car, inp: DriveInput, dt: number) {
    const fx = Math.cos(c.a);
    const fy = Math.sin(c.a);
    const rx = -fy;
    const ry = fx;
    let vf = c.vx * fx + c.vy * fy;
    let vr = c.vx * rx + c.vy * ry;
    const sf = surfAt(c.x, c.y);
    const grass = sf === 0 || sf === 4;
    c.grass = grass;
    c.steer += (inp.steer - c.steer) * Math.min(1, 0.28 * dt);
    const sp = Math.abs(vf);
    let turn = (c.steer * 0.056 * Math.min(1, sp / 1.1) * (vf >= 0 ? 1 : -1)) / (1 + sp * 0.07);
    if (c.slide) turn *= 1.18;
    if (inp.hand) turn *= 1.55;
    c.a += turn * dt;
    const maxF = grass ? 2.3 : 4.35;
    if (inp.gas && vf < maxF) vf += 0.072 * dt * (1 - (0.55 * Math.max(0, vf)) / maxF);
    if (inp.brake) {
      if (vf > 0.2) vf -= 0.13 * dt;
      else if (vf > -1.6) vf -= 0.05 * dt;
    }
    vf *= Math.pow(grass ? 0.972 : 0.994, dt);
    if (!inp.gas && !inp.brake) vf *= Math.pow(0.99, dt);
    if (inp.hand) vf *= Math.pow(0.986, dt);
    if (vf > maxF) vf -= (vf - maxF) * 0.05 * dt;
    const slip = Math.abs(vr);
    if (!c.slide && (slip > 0.85 || (inp.hand && sp > 1.4))) c.slide = true;
    if (c.slide && slip < 0.28 && !inp.hand) c.slide = false;
    let grip = c.slide ? (inp.gas ? 0.952 : 0.935) : 0.79;
    if (inp.hand) grip = 0.976;
    if (grass) grip = c.slide ? 0.92 : 0.84;
    const vr2 = vr * Math.pow(grip, dt);
    if (vf > 0) vf += Math.abs(vr - vr2) * (inp.gas ? 0.42 : 0.25);
    vr = vr2;
    if (c.slide && !inp.hand && vf > 0.6) {
      const va = Math.atan2(fy * vf + ry * vr, fx * vf + rx * vr);
      c.a += wrapAngle(va - c.a) * 0.022 * dt;
    }
    c.vx = fx * vf + rx * vr;
    c.vy = fy * vf + ry * vr;
    c.vf = vf;
    c.vr = vr;
    move(c, dt);
  }

  function aiDrive(c: Car, dt: number) {
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
    const fx = Math.cos(c.a);
    const fy = Math.sin(c.a);
    const rx = -fy;
    const ry = fx;
    let vf = c.vx * fx + c.vy * fy;
    let vr = c.vx * rx + c.vy * ry;
    const sf = surfAt(c.x, c.y);
    const grass = sf === 0 || sf === 4;
    c.grass = grass;
    let tgt = (c.ai ? c.skill : 0.85) * aiSpd[c.idx] * (grass ? 0.6 : 1);
    if (c.ai && state === 'race') {
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
    move(c, dt);
  }

  function move(c: Car, dt: number) {
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    if (surfAt(c.x, c.y) === 3) {
      c.x -= c.vx * dt * 1.5;
      c.y -= c.vy * dt * 1.5;
      c.vx *= -0.3;
      c.vy *= -0.3;
      if (!c.ai) {
        thump();
        loseChain();
      }
    }
    if (c.x < 8 || c.x > WW - 8) {
      c.vx *= -0.4;
      c.x = clamp(c.x, 8, WW - 8);
    }
    if (c.y < 8 || c.y > WH - 8) {
      c.vy *= -0.4;
      c.y = clamp(c.y, 8, WH - 8);
    }
    for (const t of trees) {
      const dx = c.x - t.x;
      const dy = c.y - t.y;
      const d = Math.hypot(dx, dy);
      const m = t.r + 5;
      if (d < m && d > 0) {
        const nx = dx / d;
        const ny = dy / d;
        const vn = c.vx * nx + c.vy * ny;
        c.x = t.x + nx * m;
        c.y = t.y + ny * m;
        if (vn < 0) {
          c.vx -= 1.5 * vn * nx;
          c.vy -= 1.5 * vn * ny;
          c.vx *= 0.6;
          c.vy *= 0.6;
          if (!c.ai) {
            thump();
            loseChain();
          }
          for (let i = 0; i < 8; i++)
            parts.push({ x: t.x + rnd(-t.r, t.r), y: t.y + rnd(-t.r, t.r), vx: rnd(-0.6, 0.6), vy: rnd(-0.6, 0.6), life: 30, max: 30, kind: 'leaf' });
        }
      }
    }
  }

  function track(c: Car) {
    const prev = c.idx;
    c.glob += 1;
    let ni = nearestIdx(c.x, c.y, prev);
    if (c.glob % 30 === 0) {
      const g = globalIdx(c.x, c.y);
      const fw = (((g - prev) % N) + N) % N;
      if (fw < N / 4 || fw > N - 25) ni = g;
    }
    const step = (((ni - prev) % N) + N) % N;
    if (step > 0 && step < N / 2 && ni < prev) crossed(c, 1);
    else if (step >= N / 2 && ni > prev) crossed(c, -1);
    c.idx = ni;
  }

  // Water or straying too far from the road sends the player back to the last road position, standing still.
  let safeIdx = player.idx;
  function recover() {
    const sf = surfAt(player.x, player.y);
    if (sf === 1 || sf === 2) {
      safeIdx = player.idx;
      return;
    }
    const gi = globalIdx(player.x, player.y);
    const g = S[gi];
    const far = Math.hypot(player.x - g.x, player.y - g.y) > hw[gi] + OFFROAD;
    if (sf !== 4 && !far) return;
    const s = S[safeIdx];
    player.x = s.x;
    player.y = s.y;
    player.a = Math.atan2(s.ty, s.tx);
    player.vx = player.vy = player.vf = player.vr = 0;
    player.steer = 0;
    player.slide = false;
    player.idx = safeIdx;
    loseChain();
    banner = { a: sf === 4 ? 'SPLASH!' : 'OFF TRACK', b: '', t: 40 };
    audio.noise(0.3, 0.08);
    for (let i = 0; i < 14; i++)
      parts.push({ x: player.x, y: player.y, vx: rnd(-1, 1), vy: rnd(-1, 1), life: 25, max: 25, kind: 'dirt' });
  }

  function crossed(c: Car, dir: number) {
    if (dir < 0) {
      c.lap--;
      return;
    }
    c.lap++;
    if (c.done) return;
    if (c.lap > LAPS) {
      c.done = true;
      finishers.push(c);
      if (!c.ai) finish();
    } else if (!c.ai && c.lap === LAPS) {
      banner = { a: 'FINAL LAP', b: '', t: 80 };
      audio.tone(784, 0.1, 'square', 0.04);
    }
  }

  function finish() {
    if (chain >= 25) {
      driftTotal += Math.round(chain);
      chain = 0;
    }
    state = 'done';
    doneT = 150;
    player.ai = true;
    const bonus = driftTotal / 1000;
    const final = Math.max(1, raceT - bonus);
    finalRaw = Math.round(final * 100);
    const place = finishers.indexOf(player) + 1;
    banner = { a: place === 1 ? 'VICTORY!' : `FINISHED ${['1ST', '2ND', '3RD', '4TH'][place - 1]}`, b: `${formatTime(raceT)} - ${bonus.toFixed(2)} S DRIFT`, t: 999 };
    api.setScore(finalRaw);
    status();
    [523, 659, 784].forEach((f, i) => audio.tone(f, i === 2 ? 0.3 : 0.15, 'square', 0.05, 0, i * 0.15));
  }

  function scoreDrift(dt: number) {
    if (state !== 'race') return;
    const sp = Math.hypot(player.vx, player.vy);
    const ang = Math.abs(Math.atan2(player.vr, Math.max(0.1, player.vf)));
    if (player.slide && player.vf > 1.3 && ang > 0.18) {
      if (player.grass) {
        loseChain();
        return;
      }
      chain += ang * sp * dt * 1.6;
      chainT = 20;
      popup = { n: String(Math.round(chain)), l: ang > 0.75 ? 'WILD DRIFT' : ang > 0.45 ? 'NICE DRIFT' : 'DRIFT', t: 30 };
    } else if (chain > 0 && (chainT -= dt) <= 0) {
      if (chain >= 25) {
        const v = Math.round(chain);
        driftTotal += v;
        popup = { n: '+' + v, l: 'BANKED', t: 60 };
        audio.tone(660, 0.07, 'square', 0.04);
        audio.tone(990, 0.1, 'square', 0.04, 0, 0.06);
      }
      chain = 0;
    }
  }

  function effects(c: Car, dt: number) {
    const fx = Math.cos(c.a);
    const fy = Math.sin(c.a);
    const rx = -fy;
    const ry = fx;
    const sp = Math.hypot(c.vx, c.vy);
    const sliding = c.slide && sp > 1;
    for (const side of [-3, 3]) {
      const wx = c.x - fx * 4 + rx * side;
      const wy = c.y - fy * 4 + ry * side;
      if (sliding && !c.grass) {
        wctx.fillStyle = 'rgba(30,30,36,.45)';
        wctx.fillRect(wx | 0, wy | 0, 1, 1);
        if (Math.random() < 0.35 * dt) parts.push({ x: wx, y: wy, vx: -c.vx * 0.15 + rnd(-0.2, 0.2), vy: -c.vy * 0.15 + rnd(-0.2, 0.2), life: 40, max: 40, kind: 'smoke' });
      }
      if (c.grass && sp > 1 && Math.random() < 0.4 * dt)
        parts.push({ x: wx, y: wy, vx: -c.vx * 0.3 + rnd(-0.4, 0.4), vy: -c.vy * 0.3 + rnd(-0.4, 0.4), life: 22, max: 22, kind: 'dirt' });
    }
  }

  function collideCars() {
    for (let i = 0; i < cars.length; i++)
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < 11) {
          const nx = dx / d;
          const ny = dy / d;
          const o = (11 - d) / 2;
          a.x -= nx * o;
          a.y -= ny * o;
          b.x += nx * o;
          b.y += ny * o;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            const imp = -rv * 0.8;
            a.vx -= nx * imp * 0.5;
            a.vy -= ny * imp * 0.5;
            b.vx += nx * imp * 0.5;
            b.vy += ny * imp * 0.5;
            if ((a === player || b === player) && imp > 0.6 && state === 'race') {
              thump();
              loseChain();
            }
          }
        }
      }
  }

  function update(sec: number) {
    const dt = Math.min(3, sec * 60);
    if (state === 'race') raceT += sec;
    else if ((doneT -= dt) <= 0) api.end(finalRaw);
    if (banner && banner.t < 900 && (banner.t -= dt) <= 0) banner = null;
    if (popup && (popup.t -= dt) <= 0 && chain === 0) popup = null;

    for (const c of cars) {
      if (c.ai) aiDrive(c, dt);
      else
        drive(
          c,
          {
            steer: input.axisX(),
            gas: input.down('up'),
            brake: input.down('down'),
            hand: input.down('a') || input.down('b'),
          },
          dt,
        );
      track(c);
      if (!c.ai && state === 'race') recover();
      effects(c, dt);
    }
    collideCars();
    scoreDrift(dt);
    for (const q of parts) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.95;
      q.vy *= 0.95;
      q.life -= dt;
    }
    parts = parts.filter((q) => q.life > 0);
    if (parts.length > 500) parts.splice(0, parts.length - 500);

    const tx = player.x + player.vx * 16;
    const ty = player.y + player.vy * 16;
    camX += (tx - camX) * Math.min(1, 0.1 * dt);
    camY += (ty - camY) * Math.min(1, 0.1 * dt);
    camX = clamp(camX, SW / 2, WW - SW / 2);
    camY = clamp(camY, SH / 2, WH - SH / 2);

    if (eng) {
      const sp = Math.abs(player.vf);
      const gear = sp < 1.4 ? sp / 1.4 : sp < 2.6 ? (sp - 1.4) / 1.2 : sp < 3.6 ? (sp - 2.6) / 1 : (sp - 3.6) / 0.8;
      const f = 55 + gear * 70 + sp * 12;
      const t = eng.c.currentTime;
      eng.o.frequency.setTargetAtTime(f, t, 0.05);
      eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      eng.eg.gain.setTargetAtTime(api.isPaused() ? 0 : 0.045, t, 0.1);
      eng.sg.gain.setTargetAtTime(player.slide && !player.grass && state === 'race' ? Math.min(0.07, Math.abs(player.vr) * 0.025) : 0, t, 0.04);
    }
    if (state === 'race') api.setScore(Math.round(raceT * 100));
    status();
  }

  function draw() {
    const ox = Math.round(camX - SW / 2);
    const oy = Math.round(camY - SH / 2);
    ctx.drawImage(world, ox, oy, SW, SH, 0, 0, SW, SH);
    for (const q of parts) {
      const a = q.life / q.max;
      const x = Math.round(q.x - ox);
      const y = Math.round(q.y - oy);
      if (q.kind === 'smoke') {
        const r = a > 0.6 ? 1 : a > 0.3 ? 2 : 3;
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = a > 0.5 ? '#e8e8ee' : '#b8bac6';
        ctx.fillRect(x - (r >> 1), y - (r >> 1), r, r);
      } else if (q.kind === 'dirt') {
        ctx.globalAlpha = 1;
        ctx.fillStyle = Math.random() < 0.5 ? '#6b4a2a' : '#4a8a34';
        ctx.fillRect(x, y, 1, 1);
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#2e7a30';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    for (const c of cars) {
      const fr = ((Math.round((c.a / TAU) * ROT) % ROT) + ROT) % ROT;
      const L = looks[c.look];
      const x = Math.round(c.x - ox) - 9;
      const y = Math.round(c.y - oy) - 9;
      ctx.globalAlpha = 0.35;
      ctx.drawImage(L.shadows[fr], x + 2, y + 2);
      ctx.globalAlpha = 1;
      ctx.drawImage(L.frames[fr], x, y);
    }
    {
      const x = Math.round(player.x - ox);
      const y = Math.round(player.y - oy) - 12;
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y + 1, 1, 1);
    }
    ctx.drawImage(mini, SW - 74, 4);
    for (const c of cars) {
      ctx.fillStyle = looks[c.look].col;
      const s = c.ai && c !== player ? 2 : 3;
      ctx.fillRect(SW - 74 + (((c.x / WW) * 66 + 1) | 0), 4 + (((c.y / WH) * 46 + 1) | 0), s, s);
    }
    drawText(ctx, formatTime(raceT), 6, 6, '#ffffff', { scale: 2, shadow: '#000' });
    if (popup) {
      drawText(ctx, popup.n, SW / 2, 22, popup.miss ? '#e4352b' : '#ffd23f', { align: 'center', scale: 3, shadow: '#000' });
      drawText(ctx, popup.l, SW / 2, 40, '#f2f0ea', { align: 'center', shadow: '#000' });
    }
    if (banner) {
      drawText(ctx, banner.a, SW / 2, 80, '#ffd23f', { align: 'center', scale: 3, shadow: '#000' });
      if (banner.b) drawText(ctx, banner.b, SW / 2, 102, '#f2f0ea', { align: 'center', shadow: '#000' });
    }
  }

  status();
  api.loop(update, draw);

  return {
    timeUp: () => (state === 'done' ? finalRaw : 15000),
  };
}
