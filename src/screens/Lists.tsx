import { CUPS, UNLOCK_POINTS, cupPoints, cupTracks, cupUnlocked } from '../game/career';
import type { Mode } from '../game/economy';
import type { Save } from '../game/save';
import type { Track } from '../race/track';
import { allTracks } from '../race/tracks';
import { rowFor } from './rows';
import type { Group } from './rows';
import TrackList from './TrackList';

const isDaily = (t: Track) => t.id.startsWith('daily-');
const groupOf = (t: Track) => (isDaily(t) ? 'DAILY' : t.id.startsWith('custom-') ? 'CUSTOM' : t.env);
const TITLES: Record<Mode, string> = { race: 'FREE RACE', attack: 'TIME ATTACK', drift: 'DRIFT CHALLENGE' };

/** The career: four cups, each opened by points in the one before. */
export function Career({ save, onPick, onBack }: { save: Save; onPick: (t: Track) => void; onBack: () => void }) {
  const groups: Group[] = CUPS.map((cup, i) => {
    const open = cupUnlocked(save, i);
    return {
      title: cup.name,
      note: open ? `${cupPoints(save, cup)}/12 POINTS` : `LOCKED: ${UNLOCK_POINTS} POINTS IN ${CUPS[i - 1].name}`,
      rows: cupTracks(cup).map((t) => rowFor('race', save, t, !open)),
    };
  });
  return <TrackList title="CAREER" groups={groups} onPick={(r) => onPick(r.track)} onBack={onBack} />;
}

/** Every track grouped by environment, for free race, time attack or the drift challenge. */
export function FreeRace({ mode, save, onPick, onBack }: { mode: Mode; save: Save; onPick: (t: Track) => void; onBack: () => void }) {
  const tracks = allTracks();
  const names = [...new Set(tracks.map(groupOf))];
  const groups: Group[] = names.map((n) => ({
    title: n,
    rows: tracks.filter((t) => groupOf(t) === n).map((t) => rowFor(mode, save, t)),
  }));
  return <TrackList title={TITLES[mode]} groups={groups} onPick={(r) => onPick(r.track)} onBack={onBack} />;
}
