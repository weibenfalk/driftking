import { useEffect, useRef, useState } from 'react';
import { startRace } from '../engine/host';
import { DRIFT_LIMIT, MEDAL_NAMES, driftTargets, targets } from '../game/career';
import type { Mode, Payout } from '../game/economy';
import { fmt } from '../game/format';
import type { Attack, Medal } from '../game/save';
import type { CarStats } from '../race/car';
import { createGame } from '../race/race';
import type { LapReport, RaceResult } from '../race/race';
import type { Track } from '../race/track';
import { nav } from '../ui/nav';
import { C, H, W, bevel, button, medalChip, text } from '../ui/kit';

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
  /** The player's car. */
  car: { look: number; stats: CarStats };
  /** Time attack instead of a race: no field, no finish, a ghost of the saved best lap. */
  attack?: { best: Attack | null; onLap: (track: Track, r: LapReport) => { medal: number; earned: number } };
  /** Called once when the player finishes: stores the result and says what it earned. */
  onRecord: (track: Track, r: RaceResult) => { medal: Medal; isBest: boolean; payout: Payout; next: Track | null };
  onNext: (t: Track) => void;
  onExit: () => void;
}

const ordinal = (n: number) => `${n}${['TH', 'ST', 'ND', 'RD'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;

/** The result panel, drawn over the frozen last frame of the race. */
function drawResult(ctx: CanvasRenderingContext2D, o: Outcome, mode: Mode, track: Track, labels: string[], sel: number) {
  const isDrift = mode === 'drift';
  const x = 40;
  const y = 22;
  const w = W - 80;
  ctx.fillStyle = 'rgba(0,0,17,.55)';
  ctx.fillRect(0, 0, W, H);
  bevel(ctx, x, y, w, 156, C.navy2);
  bevel(ctx, x + 3, y + 3, w - 6, 12, C.navy1, true);
  text(ctx, isDrift ? 'TIME UP' : o.place === 1 ? 'VICTORY' : `FINISHED ${ordinal(o.place)}`, W / 2, y + 6, C.gold, { align: 'center' });
  text(ctx, isDrift ? `${o.raw} PTS` : fmt(o.raw), W / 2, y + 22, C.ink, { align: 'center', scale: 3 });
  medalChip(ctx, o.medal, W / 2 - 38, y + 46);
  text(ctx, MEDAL_NAMES[o.medal], W / 2 - 28, y + 47, C.ink);
  if (o.isBest) text(ctx, 'NEW BEST', W / 2 + 16, y + 47, C.green);
  if (!isDrift) {
    text(ctx, `TIME ${fmt(o.time * 100)}   DRIFT ${o.drift}${o.bestLap !== null ? `   BEST LAP ${fmt(o.bestLap * 100)}` : ''}`, W / 2, y + 58, C.dim, { align: 'center' });
  }
  const t = targets(track);
  const d = driftTargets(track);
  const goals = isDrift ? [d.gold, d.silver, d.bronze].map(String) : [t.gold, t.silver, t.bronze].map(fmt);
  [3, 2, 1].forEach((m, i) => {
    const gx = x + 34 + i * 62;
    medalChip(ctx, m, gx, y + 71);
    text(ctx, goals[i], gx + 10, y + 72, C.ink);
  });
  bevel(ctx, x + 12, y + 86, w - 24, 26, C.navy1, true);
  text(ctx, `+$${o.payout.total}`, W / 2, y + 90, C.green, { align: 'center', scale: 2 });
  text(
    ctx,
    isDrift ? `MEDAL $${o.payout.medal}` : `PLACE $${o.payout.place}  MEDAL $${o.payout.medal}  DRIFT $${o.payout.drift}`,
    W / 2,
    y + 104,
    C.dim,
    { align: 'center' },
  );
  const bw = 66;
  const gap = 6;
  const total = labels.length * bw + (labels.length - 1) * gap;
  labels.forEach((l, i) => button(ctx, l, W / 2 - total / 2 + i * (bw + gap), y + 124, bw, 13, i === sel));
  text(ctx, 'LEFT RIGHT CHOOSE   ENTER GO', W / 2, y + 143, C.dim, { align: 'center' });
}

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

  // dev shortcut: ?demo=result shows the result panel after a second, to look at it without finishing a race
  useEffect(() => {
    const demo = new URLSearchParams(location.search).get('demo');
    if (demo !== 'result') return;
    const id = window.setTimeout(
      () => setOutcome({ raw: 4687, time: 49.2, place: 2, drift: 640, bestLap: 24.3, medal: 2, isBest: true, payout: { place: 280, medal: 150, drift: 32, total: 462 }, next: track }),
      1000,
    );
    return () => window.clearTimeout(id);
  }, [track]);

  // Esc leaves a race at any time
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // the result panel: freeze the last frame and draw the panel over it
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !outcome) return;
    const labels = ['RETRY', ...(outcome.next ? ['NEXT TRACK'] : []), 'MENU'];
    const act = (i: number) => {
      const l = labels[i];
      if (l === 'RETRY') setRun((n) => n + 1);
      else if (l === 'NEXT TRACK') onNext(outcome.next!);
      else exit.current();
    };
    const frozen = ctx.getImageData(0, 0, W, H);
    let sel = 0;
    let raf = 0;
    const frame = () => {
      ctx.putImageData(frozen, 0, 0);
      drawResult(ctx, outcome, mode, track, labels, sel);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onKey = (e: KeyboardEvent) => {
      const n = nav(e);
      if (n === 'left') sel = (sel + labels.length - 1) % labels.length;
      else if (n === 'right') sel = (sel + 1) % labels.length;
      else if (n === 'ok') act(sel);
      if (n) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, [outcome, mode, track, onNext]);

  return (
    <main className="stage">
      <canvas ref={canvasRef} width={320} height={200} />
    </main>
  );
}
