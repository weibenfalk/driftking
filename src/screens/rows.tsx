import { driftTargets, lapTargets } from '../game/career';
import { potential } from '../game/economy';
import type { Mode } from '../game/economy';
import { fmt } from '../game/format';
import type { Save } from '../game/save';
import type { Track } from '../race/track';
import { TrackRow } from './ui';

/** One track row for the given mode, with best result, medal and money earned / still on offer. */
export function rowFor(mode: Mode, save: Save, t: Track, onPick: () => void, locked?: boolean) {
  const earned = save.earned[`${mode}:${t.id}`] ?? 0;
  if (mode === 'attack') {
    const a = save.attack[t.id];
    return (
      <TrackRow
        key={t.id}
        track={t}
        medal={a?.medal ?? 0}
        value={a ? fmt(a.lap) : undefined}
        sub={`GOLD LAP ${fmt(lapTargets(t).gold)}`}
        earned={earned}
        left={potential('attack', a?.medal ?? 0, !!a)}
        onPick={onPick}
      />
    );
  }
  if (mode === 'drift') {
    const d = save.driftMode[t.id];
    return (
      <TrackRow
        key={t.id}
        track={t}
        medal={d?.medal ?? 0}
        value={d ? String(d.score) : undefined}
        sub={`GOLD ${driftTargets(t).gold} POINTS`}
        earned={earned}
        left={potential('drift', d?.medal ?? 0, !!d)}
        onPick={onPick}
      />
    );
  }
  const b = save.best[t.id];
  return (
    <TrackRow
      key={t.id}
      track={t}
      medal={b?.medal ?? 0}
      value={b ? fmt(b.time) : undefined}
      earned={earned}
      left={potential('race', b?.medal ?? 0, !!b)}
      locked={locked}
      onPick={onPick}
    />
  );
}
