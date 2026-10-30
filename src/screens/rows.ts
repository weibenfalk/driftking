import { driftTargets, lapTargets, targets } from '../game/career';
import { potential } from '../game/economy';
import type { Mode } from '../game/economy';
import { fmt } from '../game/format';
import type { Medal, Save } from '../game/save';
import type { Track } from '../race/track';
import { isCustom } from '../race/tracks';

/** One selectable line in a track list. */
export interface Row {
  track: Track;
  medal: Medal;
  /** Best result so far, already formatted, or null when there is none. */
  value: string | null;
  /** Extra line shown in the detail box. */
  sub: string;
  /** What gold, silver and bronze take in this mode, already formatted. */
  goals: [string, string, string];
  earned: number;
  /** Money still on offer here. */
  left: number;
  locked: boolean;
  /** Does this list pay prize money? Only the career does. */
  pays: boolean;
}

export interface Group {
  title: string;
  note?: string;
  rows: Row[];
}

/**
 * Everything a list needs to show about a track in a mode: best, medal, and money earned / still to earn. Prize money
 * is only paid in the career (`career`), and never on custom tracks.
 */
export function rowFor(mode: Mode, save: Save, t: Track, locked = false, career = false): Row {
  const r = baseRow(mode, save, t, locked);
  return career && !isCustom(t) ? { ...r, pays: true } : { ...r, left: 0, pays: false };
}

const goalsOf = (t: { gold: number; silver: number; bronze: number }, f: (n: number) => string): [string, string, string] => [f(t.gold), f(t.silver), f(t.bronze)];

function baseRow(mode: Mode, save: Save, t: Track, locked: boolean): Row {
  const earned = save.earned[`${mode}:${t.id}`] ?? 0;
  if (mode === 'attack') {
    const a = save.attack[t.id];
    return { track: t, medal: a?.medal ?? 0, value: a ? fmt(a.lap) : null, sub: `GOLD LAP ${fmt(lapTargets(t).gold)}`, goals: goalsOf(lapTargets(t), fmt), earned, left: potential('attack', a?.medal ?? 0, !!a), locked, pays: false };
  }
  if (mode === 'drift') {
    const d = save.driftMode[t.id];
    return { track: t, medal: d?.medal ?? 0, value: d ? String(d.score) : null, sub: `GOLD ${driftTargets(t).gold} POINTS IN 90 S`, goals: [driftTargets(t).gold, driftTargets(t).silver, driftTargets(t).bronze].map(String) as [string, string, string], earned, left: potential('drift', d?.medal ?? 0, !!d), locked, pays: false };
  }
  const b = save.best[t.id];
  return { track: t, medal: b?.medal ?? 0, value: b ? fmt(b.time) : null, sub: `${t.laps} LAPS`, goals: goalsOf(targets(t), fmt), earned, left: potential('race', b?.medal ?? 0, !!b), locked, pays: false };
}
