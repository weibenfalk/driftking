import { driftTargets, lapTargets } from '../game/career';
import { potential } from '../game/economy';
import type { Mode } from '../game/economy';
import { fmt } from '../game/format';
import type { Medal, Save } from '../game/save';
import type { Track } from '../race/track';

/** One selectable line in a track list. */
export interface Row {
  track: Track;
  medal: Medal;
  /** Best result so far, already formatted, or null when there is none. */
  value: string | null;
  /** Extra line shown in the detail box. */
  sub: string;
  earned: number;
  /** Money still on offer here. */
  left: number;
  locked: boolean;
}

export interface Group {
  title: string;
  note?: string;
  rows: Row[];
}

/** Everything a list needs to show about a track in a mode: best, medal, and money earned / still to earn. */
export function rowFor(mode: Mode, save: Save, t: Track, locked = false): Row {
  const earned = save.earned[`${mode}:${t.id}`] ?? 0;
  if (mode === 'attack') {
    const a = save.attack[t.id];
    return { track: t, medal: a?.medal ?? 0, value: a ? fmt(a.lap) : null, sub: `GOLD LAP ${fmt(lapTargets(t).gold)}`, earned, left: potential('attack', a?.medal ?? 0, !!a), locked };
  }
  if (mode === 'drift') {
    const d = save.driftMode[t.id];
    return { track: t, medal: d?.medal ?? 0, value: d ? String(d.score) : null, sub: `GOLD ${driftTargets(t).gold} POINTS IN 90 S`, earned, left: potential('drift', d?.medal ?? 0, !!d), locked };
  }
  const b = save.best[t.id];
  return { track: t, medal: b?.medal ?? 0, value: b ? fmt(b.time) : null, sub: `${t.laps} LAPS`, earned, left: potential('race', b?.medal ?? 0, !!b), locked };
}
