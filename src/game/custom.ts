import { CUSTOM_H, CUSTOM_W, ENV_IDS, MAX_LEVEL, BUMP_STEP, WIDTH_STEP, envRoadHalf, envWidths } from '../race/tracks';
import type { CustomTrack } from '../race/tracks';
import type { Sample } from '../race/track';
import { checkTrack, generateCenterline } from '../race/trackgen';

const KEY = 'driftking.custom.v1';
export const MAX_CUSTOM = 12;

/** Reads the saved custom tracks, dropping any that are malformed. */
export function loadCustom(): CustomTrack[] {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(d)) return [];
    return d
      .map(tidy)
      .filter(
        (c): c is CustomTrack =>
          typeof c?.id === 'string' &&
          c.id.startsWith('custom-') &&
          typeof c.name === 'string' &&
          ENV_IDS.includes(c.env) &&
          Array.isArray(c.cp) &&
          c.cp.length >= 6 &&
          c.cp.length <= 40 &&
          c.cp.every((p: unknown) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= CUSTOM_W && p[1] >= 0 && p[1] <= CUSTOM_H),
      )
      .slice(0, MAX_CUSTOM);
  } catch {
    return [];
  }
}

export function writeCustom(list: CustomTrack[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
}

/** Keeps only a valid road width level and wider-spot list on a stored track. */
function tidy(c: CustomTrack): CustomTrack {
  if (!c || !Array.isArray(c.cp)) return c;
  const lvl = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_LEVEL;
  const out = { ...c };
  if (!lvl(c.wd)) delete out.wd;
  if (!Array.isArray(c.bump) || c.bump.length !== c.cp.length || !c.bump.every(lvl)) delete out.bump;
  if (c.br !== true) delete out.br;
  return out;
}

/** Generator and validity-check settings for custom tracks. The editor does not demand a minimum number of corners. */
export const optsFor = (c: Pick<CustomTrack, 'env' | 'wd' | 'bump' | 'br'>) => {
  const wide = (c.wd ?? 0) * WIDTH_STEP;
  const pointExtra = (c.bump ?? []).map((b) => b * BUMP_STEP);
  return {
    width: CUSTOM_W,
    height: CUSTOM_H,
    roadHalf: envRoadHalf(c.env) + wide + Math.max(0, ...pointExtra),
    minCorners: 0,
    bridges: c.br === true,
    hwOf: (S: Sample[], cp: [number, number][]) => envWidths(c.env, wide, pointExtra, S, cp),
  };
};

/**
 * Makes control point `k` the start/finish: the loop is rotated so it becomes point 0, and the start straight is laid
 * out again around it along the way the track already runs (the four start points keep one line, as the editor needs).
 */
export function withStart(c: CustomTrack, k: number): CustomTrack {
  const n = c.cp.length;
  const rot = <T,>(a: T[]) => [...a.slice(k), ...a.slice(0, k)];
  const cp = rot(c.cp).map((p) => [...p] as [number, number]);
  const bump = c.bump ? rot(c.bump) : undefined;
  const [x0, y0] = cp[0];
  const dx = cp[1][0] - cp[n - 1][0];
  const dy = cp[1][1] - cp[n - 1][1];
  const l = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / l, dy / l];
  // longest start straight first; shorter ones when the long one would run off the map or into other road
  let best = cp;
  for (const [a, b, c2] of [[200, 140, 270], [170, 125, 230], [140, 110, 200], [115, 100, 170]]) {
    const trial = cp.map((p) => [...p] as [number, number]);
    const place = (i: number, dir: number, min: number) => {
      trial[i] = [Math.round(x0 + ux * min * dir), Math.round(y0 + uy * min * dir)];
    };
    place(1, 1, a);
    place(n - 1, -1, b);
    place(n - 2, -1, c2);
    if (bump) for (const i of [0, 1, n - 2, n - 1]) bump[i] = 0;
    if (checkTrack(trial, optsFor({ env: c.env, wd: c.wd, bump, br: c.br })) === null) {
      best = trial;
      break;
    }
    if (best === cp) best = trial; // nothing fits: the longest one, and the editor will say what is wrong
  }
  cp.splice(0, n, ...best);
  const out: CustomTrack = { ...c, cp };
  if (bump) out.bump = bump;
  return out;
}

/** A track as a short text code that can be pasted to a friend: name, environment and the control points. */
export function exportTrack(c: CustomTrack): string {
  const json = JSON.stringify({ v: 2, n: c.name, e: c.env, p: c.cp.flat().map(Math.round), w: c.wd ?? 0, q: c.bump, b: c.br ? 1 : 0 });
  return 'DK1-' + btoa(json);
}

/** Reads a code from `exportTrack`; null when it is malformed or the layout is not a valid track. */
export function importTrack(code: string): CustomTrack | null {
  try {
    const raw = code.trim();
    if (!raw.startsWith('DK1-')) return null;
    const d = JSON.parse(atob(raw.slice(4)));
    if ((d?.v !== 1 && d?.v !== 2) || !ENV_IDS.includes(d.e) || !Array.isArray(d.p) || d.p.length % 2 || d.p.length < 12 || d.p.length > 80) return null;
    if (!d.p.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) return null;
    const cp: [number, number][] = [];
    for (let i = 0; i < d.p.length; i += 2) cp.push([d.p[i], d.p[i + 1]]);
    if (cp.some(([x, y]) => x < 0 || x > CUSTOM_W || y < 0 || y > CUSTOM_H)) return null;
    const t = tidy({ id: '', name: '', env: d.e, cp, wd: d.w, bump: d.q, br: d.b === 1 });
    if (checkTrack(cp, optsFor(t)) !== null) return null;
    const name = String(d.n ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 14).trim();
    return { ...t, name };
  } catch {
    return null;
  }
}

/** A fresh, valid layout from a random seed (the generator never returns an invalid one). */
export function newDraft(): CustomTrack {
  const env = ENV_IDS[Math.floor(Math.random() * ENV_IDS.length)];
  const cp = generateCenterline(Math.floor(Math.random() * 1e6) + 1, { ...optsFor({ env }), twist: 0.7 });
  return { id: '', name: '', env, cp };
}
