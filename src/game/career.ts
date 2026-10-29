import { parTime } from '../race/track';
import type { Track } from '../race/track';
import { findTrack } from '../race/tracks';
import type { Medal, Save } from './save';

export interface Cup {
  id: string;
  name: string;
  trackIds: string[];
}

export const CUPS: Cup[] = [
  { id: 'meadow', name: 'MEADOW CUP', trackIds: ['meadow', 'lakeside', 'hills', 'dunes'] },
  { id: 'dust', name: 'DUST CUP', trackIds: ['canyon', 'mirage', 'pine-ridge', 'mud-creek'] },
  { id: 'frost', name: 'FROST CUP', trackIds: ['deep-woods', 'ice-pass', 'frostbite', 'whiteout'] },
  { id: 'city', name: 'CITY CUP', trackIds: ['downtown', 'harbor', 'neon-alley', 'skyline'] },
];

export const MEDAL_NAMES = ['NO MEDAL', 'BRONZE', 'SILVER', 'GOLD'];

/** Points (bronze 1, silver 2, gold 3) needed in a cup to open the next one. Max per cup is 12. */
export const UNLOCK_POINTS = 5;

/*
 * Medal targets are multiples of the track's AI-pace time plus a standing-start allowance.
 * They have not been tuned against real laps yet: adjust these three numbers after playing.
 */
const START_ALLOWANCE = 2;
const FACTORS = { gold: 1.03, silver: 1.12, bronze: 1.25 };

const targetCache = new Map<string, { gold: number; silver: number; bronze: number }>();

/** Target scores in 1/100 s: beat the number to earn the medal. */
export function targets(track: Track) {
  let t = targetCache.get(track.id);
  if (!t) {
    const par = parTime(track);
    const at = (f: number) => Math.round((par * f + START_ALLOWANCE) * 100);
    targetCache.set(track.id, (t = { gold: at(FACTORS.gold), silver: at(FACTORS.silver), bronze: at(FACTORS.bronze) }));
  }
  return t;
}

export function medalFor(track: Track, raw: number): Medal {
  const t = targets(track);
  return raw <= t.gold ? 3 : raw <= t.silver ? 2 : raw <= t.bronze ? 1 : 0;
}

export function cupTracks(cup: Cup): Track[] {
  return cup.trackIds.map((id) => findTrack(id)).filter((t): t is Track => !!t);
}

export function cupPoints(save: Save, cup: Cup) {
  return cup.trackIds.reduce((sum, id) => sum + (save.best[id]?.medal ?? 0), 0);
}

export function cupUnlocked(save: Save, index: number) {
  return index === 0 || cupPoints(save, CUPS[index - 1]) >= UNLOCK_POINTS;
}

/** The track after `track` in the career, or null at the end of the last open cup. */
export function nextCareerTrack(save: Save, track: Track): Track | null {
  const ci = CUPS.findIndex((c) => c.trackIds.includes(track.id));
  if (ci < 0) return null;
  const ti = CUPS[ci].trackIds.indexOf(track.id);
  const nextId = CUPS[ci].trackIds[ti + 1] ?? (cupUnlocked(save, ci + 1) ? CUPS[ci + 1]?.trackIds[0] : undefined);
  return (nextId && findTrack(nextId)) || null;
}
