import { useEffect, useRef, useState } from 'react';
import { startRace } from '../engine/host';
import { DRIFT_LIMIT, MEDAL_NAMES, driftTargets, targets } from '../game/career';
import type { Mode, Payout } from '../game/economy';
import type { Attack, Medal } from '../game/save';
import { createGame } from '../race/race';
import type { LapReport, RaceResult } from '../race/race';
import type { CarStats } from '../race/car';
import type { Track } from '../race/track';
import { fmt } from '../game/format';
import { MedalChip } from './ui';

export interface Outcome extends RaceResult {
  medal: Medal;
  isBest: boolean;
  payout: Payout;
  /** Next track in the career, if this race was part of it. */
  next: Track | null;
}

interface Props {
  track: Track;
  /** `race` against the field, `attack` for time attack with a ghost, `drift` for the drift challenge. */
  mode: Mode;
  /** Time attack instead of a race: no field, no finish, a ghost of the saved best lap. */
  attack?: { best: Attack | null; onLap: (track: Track, r: LapReport) => { medal: number; earned: number } };
  /** The player's car. */
  car: { look: number; stats: CarStats };
  /** Called once when the player finishes: stores the result and says what it earned. */
  onRecord: (track: Track, r: RaceResult) => { medal: Medal; isBest: boolean; payout: Payout; next: Track | null };
  onNext: (t: Track) => void;
  onExit: () => void;
}

const ordinal = (n: number) => ['1ST', '2ND', '3RD', '4TH'][n - 1] ?? `${n}TH`;

export default function RaceScreen({ track, mode, attack, car, onRecord, onNext, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const record = useRef(onRecord);
  record.current = onRecord;
  const exit = useRef(onExit);
  exit.current = onExit;
  const carRef = useRef(car);
  carRef.current = car;
  const attackRef = useRef(attack);
  attackRef.current = attack;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setOutcome(null);
    let detail: RaceResult | undefined;
    const race = startRace(
      canvas,
      (api) => {
        const a = attackRef.current;
        return createGame(api, track, {
          car: carRef.current,
          drift: mode === 'drift' ? { limit: DRIFT_LIMIT, targets: Object.values(driftTargets(track)) } : undefined,
          onResult: (r) => (detail = r),
          // read the ref again per lap: the save changes after every lap and a stale closure would overwrite it
          attack: a && { best: a.best, onLap: (r) => attackRef.current?.onLap(track, r) },
        });
      },
      (raw) => {
        const d = detail ?? { raw, time: raw / 100, place: 0, drift: 0, bestLap: null };
        setOutcome({ ...d, ...record.current(track, d) });
      },
    );
    return () => race.stop();
  }, [run, track, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const t = targets(track);
  const dt = driftTargets(track);
  const isDrift = mode === 'drift';
  return (
    <main className="stage">
      <canvas ref={canvasRef} width={320} height={200} />
      {outcome && (
        <div className="result" role="dialog" aria-label="Race finished">
          <h1>{isDrift ? 'TIME UP' : outcome.place === 1 ? 'VICTORY' : `FINISHED ${ordinal(outcome.place)}`}</h1>
          <p className="big">{isDrift ? `${outcome.raw} PTS` : fmt(outcome.raw)}</p>
          <p>
            <MedalChip medal={outcome.medal} size={18} /> {MEDAL_NAMES[outcome.medal]}
            {outcome.isBest && <b className="new"> NEW BEST!</b>}
          </p>
          {!isDrift && (
            <p className="small">
              TIME {fmt(outcome.time * 100)} · DRIFT {outcome.drift}
              {outcome.bestLap !== null && ` · BEST LAP ${fmt(outcome.bestLap * 100)}`}
            </p>
          )}
          <p className="money">
            +$ {outcome.payout.total}{' '}
            <small>{isDrift ? `MEDAL ${outcome.payout.medal}` : `PLACE ${outcome.payout.place} · MEDAL ${outcome.payout.medal} · DRIFT ${outcome.payout.drift}`}</small>
          </p>
          <p className="small targets">
            <MedalChip medal={3} size={10} /> {isDrift ? dt.gold : fmt(t.gold)} <MedalChip medal={2} size={10} /> {isDrift ? dt.silver : fmt(t.silver)}{' '}
            <MedalChip medal={1} size={10} /> {isDrift ? dt.bronze : fmt(t.bronze)}
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
