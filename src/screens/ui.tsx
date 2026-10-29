import { MEDAL_NAMES } from '../game/career';
import type { Medal } from '../game/save';
import type { Track } from '../race/track';

export function MedalChip({ medal, size = 14 }: { medal: Medal; size?: number }) {
  return <span className={`medal m${medal}`} style={{ width: size, height: size }} title={MEDAL_NAMES[medal]} aria-label={MEDAL_NAMES[medal]} />;
}

export function TrackRow({
  track,
  medal,
  value,
  sub,
  earned,
  left,
  locked,
  onPick,
}: {
  track: Track;
  /** Omit to hide the medal chip. */
  medal?: Medal;
  /** Best result, already formatted (a time or a score). */
  value?: string;
  sub?: string;
  /** Money earned here so far, and what is still on offer. */
  earned?: number;
  left?: number;
  locked?: boolean;
  onPick: () => void;
}) {
  return (
    <button className="row" disabled={locked} onClick={onPick}>
      {medal === undefined ? <span /> : <MedalChip medal={medal} />}
      <span className="row-name">
        {track.name}
        <small>{sub ?? `${track.env} · ${track.laps} LAPS`}</small>
      </span>
      <span className="row-money">
        {left !== undefined && <b title="Still to earn">{left > 0 ? `UP TO $${left}` : 'ALL EARNED'}</b>}
        {earned !== undefined && <small title="Earned so far">EARNED ${earned}</small>}
      </span>
      <span className="row-time">{value ?? '--'}</span>
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
