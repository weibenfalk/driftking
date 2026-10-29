import { generateCenterline, lakeSpot, mulberry32 } from './trackgen';
import type { GenOpts } from './trackgen';
import type { Ground, Props, Theme, Track } from './track';

/* ------------------------------------------------------------------ */
/* Environments: how a place looks and how it drives                   */
/* ------------------------------------------------------------------ */

interface Env {
  label: string;
  theme: Theme;
  ground: Ground;
  roadGrip: number;
  props: Props;
  laps: number;
  halfWidth: number;
  cornerExtra: number;
  lake: boolean;
}

const MEADOW: Env = {
  label: 'MEADOW',
  theme: {
    grass: { a: [66, 146, 60], b: [58, 132, 54], dark: [48, 116, 46], light: [84, 160, 70] },
    road: { base: [84, 86, 98], dark: [74, 76, 88], light: [98, 100, 112] },
    curb: [[216, 50, 42], [236, 236, 236]],
    prop: { shadow: [34, 86, 34], rim: [22, 64, 30], light: [96, 176, 72], dark: [38, 100, 42], mid: [52, 128, 52] },
    water: { deep: [48, 110, 190], glint: [140, 200, 240], shore: [214, 196, 140] },
    roofs: [],
  },
  ground: 'grass',
  roadGrip: 1,
  props: { kind: 'round', count: 70, min: 5, max: 8 },
  laps: 2,
  halfWidth: 30,
  cornerExtra: 18,
  lake: true,
};

const DESERT: Env = {
  label: 'DESERT',
  theme: {
    grass: { a: [222, 188, 120], b: [212, 176, 108], dark: [190, 154, 92], light: [236, 206, 142] },
    road: { base: [92, 88, 96], dark: [80, 76, 86], light: [112, 106, 114] },
    curb: [[200, 70, 40], [240, 226, 196]],
    prop: { shadow: [150, 116, 70], rim: [58, 84, 40], light: [132, 168, 80], dark: [70, 100, 48], mid: [96, 134, 62] },
    water: { deep: [44, 132, 150], glint: [150, 220, 220], shore: [236, 214, 160] },
    roofs: [],
  },
  ground: 'sand',
  roadGrip: 0.95,
  props: { kind: 'round', count: 45, min: 3, max: 5 },
  laps: 3,
  halfWidth: 28,
  cornerExtra: 20,
  lake: true,
};

const FOREST: Env = {
  label: 'FOREST',
  theme: {
    grass: { a: [44, 100, 48], b: [38, 90, 42], dark: [28, 72, 34], light: [60, 120, 58] },
    road: { base: [150, 110, 72], dark: [132, 94, 60], light: [172, 132, 90] },
    curb: [[104, 66, 38], [170, 130, 92]],
    prop: { shadow: [18, 48, 24], rim: [14, 44, 22], light: [58, 126, 62], dark: [24, 66, 32], mid: [34, 90, 42] },
    water: { deep: [36, 84, 112], glint: [110, 170, 190], shore: [120, 100, 70] },
    roofs: [],
  },
  ground: 'mud',
  roadGrip: 0.78,
  props: { kind: 'round', count: 150, min: 6, max: 10 },
  laps: 3,
  halfWidth: 26,
  cornerExtra: 18,
  lake: true,
};

const SNOW: Env = {
  label: 'SNOW',
  theme: {
    grass: { a: [232, 240, 248], b: [220, 232, 244], dark: [196, 212, 230], light: [250, 252, 255] },
    road: { base: [108, 112, 128], dark: [96, 100, 116], light: [160, 166, 182] },
    curb: [[220, 60, 50], [244, 246, 250]],
    prop: { shadow: [170, 188, 210], rim: [18, 60, 44], light: [236, 244, 250], dark: [22, 74, 54], mid: [32, 100, 70] },
    water: { deep: [130, 186, 224], glint: [226, 244, 255], shore: [240, 246, 252] },
    roofs: [],
  },
  ground: 'snow',
  roadGrip: 0.58,
  props: { kind: 'round', count: 90, min: 5, max: 9 },
  laps: 3,
  halfWidth: 32,
  cornerExtra: 20,
  lake: true,
};

const CITY: Env = {
  label: 'CITY',
  theme: {
    grass: { a: [118, 120, 130], b: [110, 112, 122], dark: [96, 98, 108], light: [134, 136, 146] },
    road: { base: [52, 54, 64], dark: [44, 46, 56], light: [68, 70, 82] },
    curb: [[240, 200, 40], [30, 30, 38]],
    prop: { shadow: [70, 72, 84], rim: [40, 40, 50], light: [180, 184, 200], dark: [90, 92, 106], mid: [130, 134, 150] },
    water: { deep: [38, 66, 118], glint: [110, 150, 210], shore: [150, 150, 160] },
    roofs: [[168, 74, 62], [78, 108, 170], [196, 170, 90], [96, 140, 120], [150, 150, 166], [190, 110, 80]],
  },
  ground: 'sand', // gravel and kerbs: slow like sand
  roadGrip: 1,
  props: { kind: 'building', count: 60, min: 9, max: 20 },
  laps: 3,
  halfWidth: 30,
  cornerExtra: 18,
  lake: true,
};

const ENVS = { meadow: MEADOW, desert: DESERT, forest: FOREST, snow: SNOW, city: CITY };
type EnvId = keyof typeof ENVS;

/* ------------------------------------------------------------------ */
/* Tracks                                                              */
/* ------------------------------------------------------------------ */

function fromEnv(id: string, name: string, env: EnvId, width: number, height: number, cp: [number, number][], lake: Track['lake']): Track {
  const e = ENVS[env];
  return {
    id,
    name,
    env: e.label,
    width,
    height,
    cp,
    laps: e.laps,
    halfWidth: e.halfWidth,
    cornerExtra: e.cornerExtra,
    props: e.props,
    ground: e.ground,
    roadGrip: e.roadGrip,
    lake: e.lake ? lake : undefined,
    theme: e.theme,
  };
}

/** A track from a seed: same seed, same track, on every machine. */
export function generated(id: string, name: string, env: EnvId, seed: number, width = 1700, height = 1100): Track {
  const e = ENVS[env];
  const o: GenOpts = { width, height, roadHalf: e.halfWidth + e.cornerExtra, twist: 0.55 + mulberry32(seed)() * 0.4 };
  const cp = generateCenterline(seed, o);
  return fromEnv(id, name, env, width, height, cp, lakeSpot(cp, seed, o));
}

export const TRACKS: Track[] = [
  fromEnv(
    'meadow',
    'MEADOW LOOP',
    'meadow',
    1400,
    1000,
    [
      [200, 560], [200, 300], [300, 170], [480, 160], [560, 280], [520, 420], [640, 520], [820, 480], [900, 300], [1050, 180],
      [1220, 240], [1250, 420], [1120, 520], [1150, 680], [1240, 800], [1100, 880], [800, 860], [640, 760], [480, 860], [300, 880], [200, 800],
    ],
    { x: 1000, y: 640, rx: 105, ry: 62 },
  ),
  generated('lakeside', 'LAKESIDE', 'meadow', 11),
  generated('hills', 'ROLLING HILLS', 'meadow', 23),
  fromEnv(
    'dunes',
    'DUNE RUN',
    'desert',
    1600,
    1000,
    [
      [650, 130], [920, 130], [1200, 140], [1400, 260], [1480, 450], [1400, 640], [1220, 720], [1000, 640], [850, 520], [660, 540],
      [530, 620], [430, 740], [370, 860], [250, 930], [140, 830], [130, 600], [150, 400], [230, 250], [300, 150], [450, 130],
    ],
    { x: 1200, y: 870, rx: 110, ry: 55 },
  ),
  generated('canyon', 'CANYON', 'desert', 31),
  generated('mirage', 'MIRAGE', 'desert', 47),
  generated('pine-ridge', 'PINE RIDGE', 'forest', 5),
  generated('mud-creek', 'MUD CREEK', 'forest', 17),
  generated('deep-woods', 'DEEP WOODS', 'forest', 59),
  generated('ice-pass', 'ICE PASS', 'snow', 3),
  generated('frostbite', 'FROSTBITE', 'snow', 41),
  generated('whiteout', 'WHITEOUT', 'snow', 73),
  generated('downtown', 'DOWNTOWN', 'city', 13),
  generated('harbor', 'HARBOR', 'city', 29),
  generated('neon-alley', 'NEON ALLEY', 'city', 61),
];

/** Everyone gets the same track on the same (UTC) day. */
export function dailyTrack(date = new Date()): Track {
  const key = date.toISOString().slice(0, 10);
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const seed = (h >>> 0) % 100000;
  const envs = Object.keys(ENVS) as EnvId[];
  const env = envs[seed % envs.length];
  return generated(`daily-${key}`, `DAILY ${key}`, env, seed);
}
