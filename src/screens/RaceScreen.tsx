import { useEffect, useRef, useState } from 'react';
import { startRace } from '../engine/host';
import { MEDAL_NAMES, targets } from '../game/career';
import type { Medal } from '../game/save';
import { createGame } from '../race/race';
import type { RaceResult } from '../race/race';
import type { Track } from '../race/track';
import { fmt } from '../game/format';
import { MedalChip } from './ui';

export interface Outcome extends RaceResult {
  medal: Medal;
  isBest: boolean;
  /** Next track in the career, if this race was part of it. */
  next: Track | null;
}

interface Props {
  track: Track;
  /** Called once when the player finishes: stores the result and says what it earned. */
  onRecord: (track: Track, raw: number) => { medal: Medal; isBest: boolean; next: Track | null };
  onNext: (t: Track) => void;
  onExit: () => void;
}

const ordinal = (n: number) => ['1ST', '2ND', '3RD', '4TH'][n - 1] ?? `${n}TH`;

export default function RaceScreen({ track, onRecord, onNext, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const record = useRef(onRecord);
  record.current = onRecord;
  const exit = useRef(onExit);
  exit.current = onExit;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setOutcome(null);
    let detail: RaceResult | undefined;
    const race = startRace(
      canvas,
      (api) => createGame(api, track, (r) => (detail = r)),
      (raw) => {
        const d = detail ?? { raw, time: raw / 100, place: 0, drift: 0, bestLap: null };
        setOutcome({ ...d, ...record.current(track, d.raw) });
      },
    );
    return () => race.stop();
  }, [run, track]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const t = targets(track);
  return (
    <main className="stage">
      <canvas ref={canvasRef} width={320} height={200} />
      {outcome && (
        <div className="result" role="dialog" aria-label="Race finished">
          <h1>{outcome.place === 1 ? 'VICTORY' : `FINISHED ${ordinal(outcome.place)}`}</h1>
          <p className="big">{fmt(outcome.raw)}</p>
          <p>
            <MedalChip medal={outcome.medal} size={18} /> {MEDAL_NAMES[outcome.medal]}
            {outcome.isBest && <b className="new"> NEW BEST!</b>}
          </p>
          <p className="small">
            TIME {fmt(outcome.time * 100)} · DRIFT {outcome.drift}
            {outcome.bestLap !== null && ` · BEST LAP ${fmt(outcome.bestLap * 100)}`}
          </p>
          <p className="small targets">
            <MedalChip medal={3} size={10} /> {fmt(t.gold)} <MedalChip medal={2} size={10} /> {fmt(t.silver)} <MedalChip medal={1} size={10} /> {fmt(t.bronze)}
          </p>
          <div className="buttons">
            <button autoFocus onClick={() => setRun((n) => n + 1)}>
              RETRY
            </button>
            {outcome.next && <button onClick={() => onNext(outcome.next!)}>NEXT: {outcome.next.name}</button>}
            <button onClick={onExit}>MENU</button>
          </div>
        </div>
      )}
    </main>
  );
}
