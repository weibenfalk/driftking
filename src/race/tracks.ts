import { mulberry32 } from '../engine/util';
import { generateCenterline, lakeSpot } from './trackgen';
import type { GenOpts } from './trackgen';
import { forgetWorld } from './track';
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
    ground: [[34, 102, 51], [51, 136, 51], [68, 153, 68], [119, 187, 85]],
    detail: 'meadow',
    verge: [[119, 102, 68], [170, 153, 102]],
    road: { base: [85, 85, 102], dark: [68, 68, 85], light: [119, 119, 136], line: [221, 221, 221], center: [255, 221, 51], marks: true },
    curb: [[221, 51, 34], [238, 238, 238]],
    props: {
      tree: { ramp: [[17, 68, 34], [34, 102, 34], [68, 153, 51], [136, 204, 85]], rim: [8, 34, 17] },
      bush: { ramp: [[34, 102, 34], [51, 136, 51], [102, 170, 68], [170, 221, 102]], rim: [17, 68, 34] },
      rock: { ramp: [[85, 85, 102], [119, 119, 136], [153, 153, 170], [204, 204, 221]], rim: [34, 34, 51] },
    },
    water: { deep: [34, 85, 187], mid: [51, 136, 221], glint: [170, 221, 255], shore: [204, 187, 136] },
    roofs: [],
  },
  ground: 'grass',
  roadGrip: 1,
  props: { count: 70, mix: [['tree', 6], ['bush', 3], ['rock', 1]] },
  laps: 2,
  halfWidth: 30,
  cornerExtra: 18,
  lake: true,
};

const DESERT: Env = {
  label: 'DESERT',
  theme: {
    ground: [[187, 153, 85], [204, 170, 102], [221, 187, 119], [238, 204, 136]],
    detail: 'sand',
    verge: [[153, 119, 68], [187, 153, 102]],
    road: { base: [102, 102, 119], dark: [85, 85, 102], light: [136, 136, 153], line: [238, 238, 221], center: [255, 204, 51], marks: true },
    curb: [[204, 68, 34], [238, 221, 187]],
    props: {
      cactus: { ramp: [[17, 68, 34], [34, 119, 51], [85, 170, 68], [153, 221, 102]], rim: [8, 34, 17] },
      rock: { ramp: [[102, 68, 51], [153, 102, 68], [187, 136, 85], [221, 170, 119]], rim: [51, 34, 17] },
      bush: { ramp: [[102, 102, 34], [136, 136, 51], [170, 170, 68], [204, 204, 102]], rim: [68, 68, 17] },
    },
    water: { deep: [34, 136, 153], mid: [68, 187, 187], glint: [187, 238, 238], shore: [238, 221, 170] },
    roofs: [],
  },
  ground: 'sand',
  roadGrip: 0.95,
  props: { count: 55, mix: [['cactus', 5], ['rock', 4], ['bush', 2]] },
  laps: 3,
  halfWidth: 28,
  cornerExtra: 20,
  lake: true,
};

const FOREST: Env = {
  label: 'FOREST',
  theme: {
    ground: [[17, 51, 34], [34, 85, 51], [51, 102, 51], [85, 136, 68]],
    detail: 'forest',
    verge: [[85, 51, 34], [136, 102, 68]],
    road: { base: [153, 119, 68], dark: [119, 85, 51], light: [187, 153, 102], line: [187, 153, 102], center: [187, 153, 102], marks: false },
    curb: [[102, 68, 34], [170, 136, 85]],
    props: {
      pine: { ramp: [[8, 34, 26], [17, 68, 34], [34, 102, 51], [85, 153, 85]], rim: [0, 17, 17] },
      tree: { ramp: [[17, 51, 17], [34, 85, 34], [68, 136, 51], [119, 187, 85]], rim: [8, 34, 8] },
      bush: { ramp: [[34, 85, 34], [51, 119, 51], [85, 153, 68], [136, 187, 85]], rim: [17, 51, 17] },
      rock: { ramp: [[51, 68, 51], [85, 102, 85], [119, 136, 102], [153, 170, 136]], rim: [17, 34, 17] },
    },
    water: { deep: [34, 68, 102], mid: [51, 102, 136], glint: [136, 187, 204], shore: [119, 102, 68] },
    roofs: [],
  },
  ground: 'mud',
  roadGrip: 0.78,
  props: { count: 170, mix: [['pine', 6], ['tree', 4], ['bush', 2], ['rock', 1]] },
  laps: 3,
  halfWidth: 26,
  cornerExtra: 18,
  lake: true,
};

const SNOW: Env = {
  label: 'SNOW',
  theme: {
    ground: [[170, 187, 221], [204, 221, 238], [231, 238, 255], [255, 255, 255]],
    detail: 'snow',
    verge: [[136, 153, 187], [187, 204, 221]],
    road: { base: [102, 102, 119], dark: [85, 85, 102], light: [153, 153, 170], line: [238, 238, 238], center: [255, 204, 51], marks: true },
    curb: [[221, 51, 34], [238, 238, 255]],
    props: {
      pine: { ramp: [[17, 68, 51], [34, 102, 68], [187, 221, 221], [255, 255, 255]], rim: [8, 34, 34] },
      rock: { ramp: [[85, 102, 136], [119, 136, 170], [170, 187, 204], [238, 238, 255]], rim: [34, 51, 85] },
      bush: { ramp: [[51, 102, 85], [85, 136, 102], [187, 221, 204], [255, 255, 255]], rim: [17, 51, 51] },
    },
    water: { deep: [102, 153, 204], mid: [153, 204, 238], glint: [238, 255, 255], shore: [238, 244, 255] },
    roofs: [],
  },
  ground: 'snow',
  roadGrip: 0.58,
  props: { count: 100, mix: [['pine', 8], ['rock', 2], ['bush', 2]] },
  laps: 3,
  halfWidth: 32,
  cornerExtra: 20,
  lake: true,
};

const CITY: Env = {
  label: 'CITY',
  theme: {
    ground: [[85, 85, 102], [102, 102, 119], [119, 119, 136], [136, 136, 153]],
    detail: 'city',
    verge: [[51, 51, 68], [85, 85, 102]],
    road: { base: [51, 51, 68], dark: [34, 34, 51], light: [85, 85, 102], line: [221, 221, 221], center: [255, 221, 51], marks: true },
    curb: [[238, 204, 34], [34, 34, 51]],
    props: {
      tree: { ramp: [[17, 68, 34], [34, 102, 51], [68, 153, 68], [136, 204, 102]], rim: [8, 34, 17] },
      bush: { ramp: [[34, 102, 51], [51, 136, 68], [102, 170, 85], [170, 221, 119]], rim: [17, 68, 34] },
      rock: { ramp: [[68, 68, 85], [102, 102, 119], [136, 136, 153], [187, 187, 204]], rim: [34, 34, 51] },
    },
    water: { deep: [34, 68, 136], mid: [51, 102, 187], glint: [136, 187, 255], shore: [153, 153, 170] },
    roofs: [[170, 68, 51], [68, 102, 170], [204, 170, 85], [85, 153, 119], [153, 153, 170], [204, 119, 85], [136, 85, 153]],
  },
  ground: 'sand', // gravel and kerbs: slow like sand
  roadGrip: 1,
  props: { count: 70, mix: [['building', 9], ['tree', 2], ['bush', 1]] },
  laps: 3,
  halfWidth: 30,
  cornerExtra: 18,
  lake: true,
};

const ENVS = { meadow: MEADOW, desert: DESERT, forest: FOREST, snow: SNOW, city: CITY };
export type EnvId = keyof typeof ENVS;
export const ENV_IDS = Object.keys(ENVS) as EnvId[];
export const envGround = (id: EnvId) => ENVS[id].theme.ground[1];
export const envRoad = (id: EnvId) => ENVS[id].theme.road.base;
export const envLabel = (id: EnvId) => ENVS[id].label;
export const envRoadHalf = (id: EnvId) => ENVS[id].halfWidth + ENVS[id].cornerExtra;

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
  generated('skyline', 'SKYLINE', 'city', 83),
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

let daily: Track | null = null;

/** Custom tracks from the editor: id, name, environment and control points. */
export interface CustomTrack {
  id: string;
  name: string;
  env: EnvId;
  cp: [number, number][];
}

/** World size of custom tracks (the same as generated ones). */
export const CUSTOM_W = 1700;
export const CUSTOM_H = 1100;

export const isCustom = (t: { id: string }) => t.id.startsWith('custom-');

export function customToTrack(c: CustomTrack): Track {
  const o: GenOpts = { width: CUSTOM_W, height: CUSTOM_H, roadHalf: envRoadHalf(c.env) };
  return fromEnv(c.id, c.name, c.env, CUSTOM_W, CUSTOM_H, c.cp, lakeSpot(c.cp, 7, o));
}

let custom: Track[] = [];

/** Replaces the set of custom tracks the lists show. */
export function setCustomTracks(list: CustomTrack[]) {
  for (const t of custom) forgetWorld(t.id);
  custom = list.map(customToTrack);
}

/** Every track including today's daily one and the custom ones. */
export function allTracks(): Track[] {
  return [...TRACKS, (daily ??= dailyTrack()), ...custom];
}

export function findTrack(id: string): Track | undefined {
  return allTracks().find((t) => t.id === id);
}
