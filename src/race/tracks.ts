import { mulberry32 } from '../engine/util';
import { generateCenterline, lakeSpot } from './trackgen';
import type { GenOpts } from './trackgen';
import { forgetWorld, trackWidths } from './track';
import type { Ground, Props, Sample, Theme, Track } from './track';

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
  props: { count: 1500, dense: true, mix: [['pine', 6], ['tree', 4], ['bush', 3], ['rock', 1]] },
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

const TROPICAL: Env = {
  label: 'TROPICAL',
  theme: {
    // jungle greens that fade into sandy clearings
    ground: [[17, 102, 68], [34, 136, 85], [68, 170, 85], [238, 221, 153]],
    detail: 'tropical',
    verge: [[119, 102, 51], [221, 204, 136]],
    road: { base: [102, 102, 116], dark: [85, 85, 102], light: [153, 153, 170], line: [238, 238, 238], center: [255, 221, 51], marks: true },
    curb: [[34, 187, 170], [255, 255, 255]],
    props: {
      palm: { ramp: [[17, 85, 34], [34, 136, 51], [68, 187, 68], [170, 238, 102]], rim: [8, 51, 17] },
      tree: { ramp: [[17, 68, 34], [34, 119, 51], [51, 170, 68], [119, 221, 85]], rim: [8, 34, 17] },
      bush: { ramp: [[34, 119, 51], [51, 153, 68], [102, 204, 85], [170, 238, 119]], rim: [17, 68, 34] },
      rock: { ramp: [[51, 51, 60], [85, 85, 100], [119, 119, 136], [170, 170, 187]], rim: [17, 17, 26] },
    },
    water: { deep: [17, 119, 170], mid: [34, 187, 204], glint: [204, 255, 255], shore: [238, 221, 153] },
    roofs: [],
  },
  ground: 'sand', // beach and undergrowth
  roadGrip: 0.95,
  props: { count: 700, dense: true, mix: [['palm', 7], ['tree', 3], ['bush', 4], ['rock', 1]] },
  laps: 3,
  halfWidth: 30,
  cornerExtra: 18,
  lake: true,
};

const MOON: Env = {
  label: 'MOON',
  theme: {
    ground: [[51, 51, 64], [85, 85, 102], [119, 119, 136], [153, 153, 170]],
    detail: 'moon',
    verge: [[34, 34, 51], [102, 102, 119]],
    // a track of packed dust, not tarmac: no markings, a rubble edge in two greys instead of kerbs
    road: { base: [64, 62, 76], dark: [44, 42, 56], light: [104, 102, 118], line: [104, 102, 118], center: [104, 102, 118], marks: false },
    curb: [[96, 94, 110], [128, 126, 142]],
    props: {
      rock: { ramp: [[51, 51, 68], [85, 85, 102], [136, 136, 153], [204, 204, 221]], rim: [17, 17, 34] },
      crater: { ramp: [[34, 34, 51], [68, 68, 85], [119, 119, 136], [187, 187, 204]], rim: [136, 136, 153] },
    },
    water: { deep: [17, 17, 51], mid: [34, 34, 85], glint: [136, 136, 204], shore: [102, 102, 119] },
    roofs: [[221, 221, 238], [170, 170, 187], [238, 204, 102], [136, 153, 187]],
  },
  ground: 'dust',
  roadGrip: 0.82, // low gravity and loose dust: long slides
  props: { count: 150, mix: [['rock', 6], ['crater', 6], ['building', 1]] },
  laps: 3,
  halfWidth: 32,
  cornerExtra: 20,
  lake: false,
};

const ENVS = { meadow: MEADOW, desert: DESERT, forest: FOREST, snow: SNOW, city: CITY, tropical: TROPICAL, moon: MOON };
export type EnvId = keyof typeof ENVS;
export const ENV_IDS = Object.keys(ENVS) as EnvId[];
export const envGround = (id: EnvId) => ENVS[id].theme.ground[1];
export const envRoad = (id: EnvId) => ENVS[id].theme.road.base;
export const envLabel = (id: EnvId) => ENVS[id].label;
export const envRoadHalf = (id: EnvId) => ENVS[id].halfWidth + ENVS[id].cornerExtra;

/** Half road width at every sample of a custom track in this environment: `wide` px on every side, plus per-point extras. */
export const envWidths = (id: EnvId, wide: number, pointExtra: number[], S: Sample[], cp: [number, number][]) =>
  trackWidths({ halfWidth: ENVS[id].halfWidth + wide, cornerExtra: ENVS[id].cornerExtra, pointExtra }, S, cp);

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

/** A hand-drawn track whose road crosses itself: at each crossing the stretch driven later goes over on a bridge. */
function bridged(id: string, name: string, env: EnvId, cp: [number, number][]): Track {
  const o: GenOpts = { width: 1700, height: 1100, roadHalf: envRoadHalf(env) };
  return { ...fromEnv(id, name, env, 1700, 1100, cp, lakeSpot(cp, 5, o)), bridges: true };
}

/** A big lopsided eight across the dunes. */
const OASIS_CP: [number, number][] = [
  [1196, 886], [1333, 857], [1341, 610], [1363, 445], [1354, 279], [1233, 222], [1108, 331], [1000, 458], [895, 587], [787, 713], [667, 829],
  [518, 896], [413, 782], [365, 623], [339, 459], [343, 293], [463, 232], [590, 339], [702, 462], [811, 588], [1000, 928], [1088, 909],
];

/** A trefoil knot: three bridges in one lap. */
const KNOT_CP: [number, number][] = [
  [603, 850], [472, 800], [530, 620], [635, 526], [770, 481], [912, 481], [1047, 527], [1156, 617], [1201, 749], [1127, 863], [987, 873],
  [861, 809], [766, 704], [709, 573], [697, 432], [741, 298], [856, 220], [982, 274], [1034, 404], [1023, 546], [965, 675], [790, 921], [706, 889],
];

/** A big oval with a loop inside it: the way in goes under the way out. */
const LOOP_CP: [number, number][] = [
  [386, 608], [363, 409], [484, 380], [588, 304], [706, 253], [832, 224], [960, 218], [1087, 237], [1205, 288], [1287, 385], [1270, 508],
  [1170, 586], [1044, 608], [943, 543], [1027, 457], [1154, 449], [1269, 502], [1314, 618], [1257, 731], [1154, 808], [1035, 855], [908, 879],
  [779, 880], [653, 858], [417, 876], [402, 747],
];

/** Another trefoil, lying on its side between the towers. */
const FLYOVER_CP: [number, number][] = [
  [1110, 827], [1022, 936], [908, 841], [834, 757], [793, 652], [782, 540], [802, 428], [853, 328], [934, 250], [1042, 224], [1134, 282],
  [1156, 391], [1120, 498], [1050, 586], [957, 651], [851, 689], [739, 696], [631, 664], [554, 584], [559, 475], [642, 402], [753, 380],
  [864, 396], [966, 444], [1053, 517], [1236, 672], [1180, 742],
];

/** Two lagoons joined by a bridge crossing: a wide eight round the island. */
const TWIN_CP: [number, number][] = [
  [1139, 848], [1293, 920], [1361, 770], [1395, 636], [1399, 497], [1373, 361], [1290, 254], [1157, 270], [1045, 352],
  [945, 448], [850, 550], [755, 652], [655, 748], [543, 830], [410, 846], [327, 739], [301, 603], [305, 464],
  [339, 330], [429, 228], [561, 252], [668, 340], [761, 443], [850, 550], [931, 750], [1026, 795],
];

/** A knot of road round a volcano: three bridges a lap. */
const VOLCANO_CP: [number, number][] = [
  [547, 645], [467, 495], [615, 446], [725, 409], [842, 412], [953, 448], [1051, 511], [1128, 600], [1169, 709],
  [1151, 823], [1058, 887], [945, 863], [858, 786], [802, 684], [777, 570], [783, 453], [822, 343], [895, 253],
  [1003, 211], [1105, 260], [1141, 369], [1118, 483], [1057, 583], [971, 662], [867, 715], [656, 848], [606, 755],
];

/** An oval with a loop of its own inside it, round a crater. */
const LUNAR_CP: [number, number][] = [
  [521, 696], [472, 533], [538, 480], [593, 384], [670, 305], [765, 247], [871, 219], [980, 231], [1066, 298],
  [1089, 404], [1047, 505], [958, 568], [855, 547], [849, 442], [923, 363], [1029, 335], [1130, 373], [1185, 467],
  [1182, 576], [1139, 678], [1070, 763], [981, 829], [878, 870], [769, 882], [587, 916], [557, 816],
];

/** A lopsided eight across the lunar sea. */
const MARE_CP: [number, number][] = [
  [507, 282], [368, 297], [362, 483], [349, 623], [356, 763], [418, 883], [540, 829], [631, 723], [715, 610],
  [798, 497], [885, 387], [982, 285], [1104, 219], [1225, 261], [1288, 386], [1330, 520], [1351, 658], [1316, 789],
  [1186, 761], [1074, 676], [969, 583], [864, 490], [706, 260], [616, 270],
];

/** A figure eight with a start straight on the right; the editor's `8` key starts from it. */
export const EIGHT_CP: [number, number][] = [
  [1480, 520], [1480, 720], [1440, 850], [1300, 925], [1130, 905], [1010, 820], [930, 700], [880, 600], [800, 440], [700, 300],
  [550, 215], [390, 235], [260, 350], [220, 540], [260, 730], [380, 860], [550, 900], [680, 830], [740, 760], [830, 560],
  [930, 380], [1050, 250], [1200, 175], [1350, 175], [1480, 250], [1480, 380],
];

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
  bridged('figure-eight', 'FIGURE EIGHT', 'meadow', EIGHT_CP),
  generated('lakeside', 'LAKESIDE', 'meadow', 11),
  generated('hills', 'ROLLING HILLS', 'meadow', 23),
  generated('orchard', 'ORCHARD', 'meadow', 37),
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
  bridged('oasis-eight', 'OASIS EIGHT', 'desert', OASIS_CP),
  generated('sandstorm', 'SANDSTORM', 'desert', 71),
  generated('pine-ridge', 'PINE RIDGE', 'forest', 5),
  generated('mud-creek', 'MUD CREEK', 'forest', 17),
  generated('deep-woods', 'DEEP WOODS', 'forest', 59),
  bridged('the-knot', 'THE KNOT', 'forest', KNOT_CP),
  generated('hollow', 'HOLLOW', 'forest', 97),
  generated('ice-pass', 'ICE PASS', 'snow', 3),
  generated('frostbite', 'FROSTBITE', 'snow', 41),
  generated('whiteout', 'WHITEOUT', 'snow', 73),
  bridged('loop-the-loop', 'LOOP THE LOOP', 'snow', LOOP_CP),
  generated('glacier', 'GLACIER', 'snow', 19),
  generated('downtown', 'DOWNTOWN', 'city', 13),
  generated('harbor', 'HARBOR', 'city', 29),
  generated('neon-alley', 'NEON ALLEY', 'city', 61),
  generated('skyline', 'SKYLINE', 'city', 83),
  bridged('flyovers', 'FLYOVERS', 'city', FLYOVER_CP),
  generated('beach-run', 'BEACH RUN', 'tropical', 101),
  generated('lagoon', 'LAGOON', 'tropical', 103),
  generated('palm-bay', 'PALM BAY', 'tropical', 107),
  bridged('twin-lagoons', 'TWIN LAGOONS', 'tropical', TWIN_CP),
  bridged('volcano', 'VOLCANO', 'tropical', VOLCANO_CP),
  generated('crater-rim', 'CRATER RIM', 'moon', 109),
  generated('tranquility', 'TRANQUILITY', 'moon', 113),
  generated('dark-side', 'DARK SIDE', 'moon', 127),
  bridged('lunar-loop', 'LUNAR LOOP', 'moon', LUNAR_CP),
  bridged('mare-eight', 'MARE EIGHT', 'moon', MARE_CP),
];

/** Tracks with launch ramps besides the moon's (every moon track has them): a few in each environment. */
const RAMP_IDS = new Set(['hills', 'dunes', 'sandstorm', 'mud-creek', 'frostbite', 'harbor', 'neon-alley', 'beach-run', 'palm-bay']);
for (let i = 0; i < TRACKS.length; i++) if (RAMP_IDS.has(TRACKS[i].id)) TRACKS[i] = { ...TRACKS[i], ramps: true };

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
  /** Road width level 0..3 (each step adds `WIDTH_STEP` px to each side along the whole track). */
  wd?: number;
  /** Per control point, 0..3: a wider spot (each step adds `BUMP_STEP` px each side), e.g. for a corner to drift in. */
  bump?: number[];
  /** Bridges allowed: the road may cross itself, the later stretch going over. */
  br?: boolean;
}

export const WIDTH_STEP = 4;
export const BUMP_STEP = 6;
export const MAX_LEVEL = 3;

/** World size of custom tracks (the same as generated ones). */
export const CUSTOM_W = 1700;
export const CUSTOM_H = 1100;

export const isCustom = (t: { id: string }) => t.id.startsWith('custom-');

export function customToTrack(c: CustomTrack): Track {
  const wide = (c.wd ?? 0) * WIDTH_STEP;
  const pointExtra = c.cp.map((_, i) => (c.bump?.[i] ?? 0) * BUMP_STEP);
  const o: GenOpts = { width: CUSTOM_W, height: CUSTOM_H, roadHalf: envRoadHalf(c.env) + wide + Math.max(0, ...pointExtra) };
  const t = fromEnv(c.id, c.name, c.env, CUSTOM_W, CUSTOM_H, c.cp, lakeSpot(c.cp, 7, o));
  t.halfWidth += wide;
  if (pointExtra.some((e) => e > 0)) t.pointExtra = pointExtra;
  if (c.br) t.bridges = true;
  return t;
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
