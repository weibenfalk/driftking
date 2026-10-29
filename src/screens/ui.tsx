import { MEDAL_NAMES } from '../game/career';
import { fmt } from '../game/format';
import type { Medal } from '../game/save';
import type { Track } from '../race/track';
import type { Best } from '../game/save';

export function MedalChip({ medal, size = 14 }: { medal: Medal; size?: number }) {
  return <span className={`medal m${medal}`} style={{ width: size, height: size }} title={MEDAL_NAMES[medal]} aria-label={MEDAL_NAMES[medal]} />;
}

export function TrackRow({ track, best, locked, onPick }: { track: Track; best?: Best; locked?: boolean; onPick: () => void }) {
  return (
    <button className="row" disabled={locked} onClick={onPick}>
      <MedalChip medal={best?.medal ?? 0} />
      <span className="row-name">{track.name}</span>
      <span className="row-env">
        {track.env} · {track.laps} LAPS
      </span>
      <span className="row-time">{best ? fmt(best.time) : '--:--.--'}</span>
    </button>
  );
}

export function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="head">
      <button onClick={onBack}>&lt; BACK</button>
      <h1>{title}</h1>
    </header>
  );
}
