import { CUSTOM_H, CUSTOM_W, ENV_IDS, envRoadHalf } from '../race/tracks';
import type { CustomTrack, EnvId } from '../race/tracks';
import { checkTrack, generateCenterline } from '../race/trackgen';

const KEY = 'driftking.custom.v1';
export const MAX_CUSTOM = 12;

/** Reads the saved custom tracks, dropping any that are malformed. */
export function loadCustom(): CustomTrack[] {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(d)) return [];
    return d
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

/** Generator and validity-check settings for custom tracks. The editor does not demand a minimum number of corners. */
export const optsFor = (env: EnvId) => ({ width: CUSTOM_W, height: CUSTOM_H, roadHalf: envRoadHalf(env), minCorners: 0 });

/** A track as a short text code that can be pasted to a friend: name, environment and the control points. */
export function exportTrack(c: CustomTrack): string {
  const json = JSON.stringify({ v: 1, n: c.name, e: c.env, p: c.cp.flat().map(Math.round) });
  return 'DK1-' + btoa(json);
}

/** Reads a code from `exportTrack`; null when it is malformed or the layout is not a valid track. */
export function importTrack(code: string): CustomTrack | null {
  try {
    const raw = code.trim();
    if (!raw.startsWith('DK1-')) return null;
    const d = JSON.parse(atob(raw.slice(4)));
    if (d?.v !== 1 || !ENV_IDS.includes(d.e) || !Array.isArray(d.p) || d.p.length % 2 || d.p.length < 12 || d.p.length > 80) return null;
    if (!d.p.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) return null;
    const cp: [number, number][] = [];
    for (let i = 0; i < d.p.length; i += 2) cp.push([d.p[i], d.p[i + 1]]);
    if (cp.some(([x, y]) => x < 0 || x > CUSTOM_W || y < 0 || y > CUSTOM_H)) return null;
    if (checkTrack(cp, optsFor(d.e)) !== null) return null;
    const name = String(d.n ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 14).trim();
    return { id: '', name, env: d.e, cp };
  } catch {
    return null;
  }
}

/** A fresh, valid layout from a random seed (the generator never returns an invalid one). */
export function newDraft(): CustomTrack {
  const env = ENV_IDS[Math.floor(Math.random() * ENV_IDS.length)];
  const cp = generateCenterline(Math.floor(Math.random() * 1e6) + 1, { ...optsFor(env), twist: 0.7 });
  return { id: '', name: '', env, cp };
}
