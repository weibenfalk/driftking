import { parTime, trackLength } from '../race/track';
import type { Track } from '../race/track';
import { findTrack } from '../race/tracks';
import type { Medal, Save } from './save';

export interface Cup {
  id: string;
  name: string;
  trackIds: string[];
}

export const CUPS: Cup[] = [
  { id: 'meadow', name: 'MEADOW CUP', trackIds: ['meadow', 'lakeside', 'orchard', 'hills', 'figure-eight'] },
  { id: 'desert', name: 'DESERT CUP', trackIds: ['dunes', 'canyon', 'mirage', 'sandstorm', 'oasis-eight'] },
  { id: 'forest', name: 'FOREST CUP', trackIds: ['pine-ridge', 'mud-creek', 'hollow', 'deep-woods', 'the-knot'] },
  { id: 'frost', name: 'FROST CUP', trackIds: ['ice-pass', 'frostbite', 'glacier', 'whiteout', 'loop-the-loop'] },
  { id: 'city', name: 'CITY CUP', trackIds: ['downtown', 'harbor', 'neon-alley', 'skyline', 'flyovers'] },
];

/**
 * How hard the rivals drive on a career track: the AI pace multiplier climbs steadily from the first track of the
 * first cup (0.92) to the last track of the last cup (1.11), so each track is a little tougher than the one before.
 * Tracks outside the career (free-race extras, custom, daily) get 1.
 */
export function careerPace(trackId: string): number {
  const all = CUPS.flatMap((c) => c.trackIds);
  const i = all.indexOf(trackId);
  return i < 0 ? 1 : 0.92 + (i / (all.length - 1)) * 0.19;
}

/** Prize money grows with the cup (1.0, 1.15, 1.3, 1.45, 1.6), so the harder cups pay for the better cars. Other tracks: 1. */
export function careerPrize(trackId: string): number {
  const i = CUPS.findIndex((c) => c.trackIds.includes(trackId));
  return i < 0 ? 1 : 1 + i * 0.15;
}

export const MEDAL_NAMES = ['NO MEDAL', 'BRONZE', 'SILVER', 'GOLD'];

/** Points (bronze 1, silver 2, gold 3) needed in a cup to open the next one. */
export const UNLOCK_POINTS = 6;

/** Most points a cup can give: gold on every track. */
export const CUP_MAX = 15;

/*
 * Medal targets are fractions of the track's baseline-profile time (`parTime`) plus a standing-start allowance,
 * fitted to a test-driver bot on the real physics: bronze is about what a careful driver does (1.2x the profile),
 * silver a good one (1.4x) and gold close to the bot's limit (1.55x).
 */
const START_ALLOWANCE = 2;
const FACTORS = { gold: 0.8, silver: 0.87, bronze: 0.97 }; // races: traffic costs a little, so these are looser than the lap factors
const LAP_FACTORS = { gold: 0.74, silver: 0.8, bronze: 0.9 }; // time attack, one clean lap

/**
 * Per-track correction on the par time, measured with `tools/medalcheck.ts`: the test bot's bronze and silver laps
 * against the targets. Without it the snow cup's medals were a good 12% easier than the meadow cup's, the city cup's
 * a little harder. 1 = the bot lands right on the target.
 */
const TUNE: Record<string, number> = {
  meadow: 1, lakeside: 1.06, hills: 1.04, dunes: 0.99,
  canyon: 1, mirage: 1.04, 'pine-ridge': 0.95, 'mud-creek': 0.935,
  'deep-woods': 0.94, 'ice-pass': 0.86, frostbite: 0.88, whiteout: 0.875,
  downtown: 1.035, harbor: 1.035, 'neon-alley': 1.045, skyline: 1.04,
  orchard: 1.03, 'figure-eight': 1, sandstorm: 1.02, 'oasis-eight': 1.02, hollow: 0.95,
  'the-knot': 0.9, glacier: 0.845, 'loop-the-loop': 0.845, flyovers: 1.01,
};
const tunedPar = (track: Track) => parTime(track) * (TUNE[track.id] ?? 1);

const targetCache = new Map<string, { gold: number; silver: number; bronze: number }>();

/** Target scores in 1/100 s: beat the number to earn the medal. */
export function targets(track: Track) {
  let t = targetCache.get(track.id);
  if (!t) {
    const par = tunedPar(track);
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

/** Seconds a drift challenge lasts. */
export const DRIFT_LIMIT = 90;

/*
 * Time attack medals: a clean flying lap against the AI-pace lap (par per lap) with the same kind of factors as
 * races, but no standing-start allowance.
 */
const lapCache = new Map<string, { gold: number; silver: number; bronze: number }>();

/** Target lap times in 1/100 s. */
export function lapTargets(track: Track) {
  let t = lapCache.get(track.id);
  if (!t) {
    const lap = tunedPar(track) / track.laps;
    const at = (f: number) => Math.round(lap * f * 100);
    lapCache.set(track.id, (t = { gold: at(LAP_FACTORS.gold), silver: at(LAP_FACTORS.silver), bronze: at(LAP_FACTORS.bronze) }));
  }
  return t;
}

export function lapMedal(track: Track, lapRaw: number): Medal {
  const t = lapTargets(track);
  return lapRaw <= t.gold ? 3 : lapRaw <= t.silver ? 2 : lapRaw <= t.bronze ? 1 : 0;
}

/*
 * Drift challenge targets scale with track length (more road, more corners in 90 s) and with road grip. Set from a
 * handbrake-drifting test bot; a human will differ, so these still want tuning by playing.
 */
const DRIFT_BASE = { bronze: 1500, silver: 3200, gold: 5200 };

/** Target drift scores. */
export function driftTargets(track: Track) {
  // slippery surfaces pay (and allow) far less drift: a test bot scored ~9000 on dry grass but ~1000 on snow
  const k = (trackLength(track) / 3500) * Math.pow(track.roadGrip, 3);
  const at = (n: number) => Math.round((n * k) / 50) * 50;
  return { bronze: at(DRIFT_BASE.bronze), silver: at(DRIFT_BASE.silver), gold: at(DRIFT_BASE.gold) };
}

export function driftMedal(track: Track, score: number): Medal {
  const t = driftTargets(track);
  return score >= t.gold ? 3 : score >= t.silver ? 2 : score >= t.bronze ? 1 : 0;
}
