import { useEffect, useRef, useState } from 'react';
import { startRace } from '../engine/host';
import { DRIFT_LIMIT, MEDAL_NAMES, driftTargets, targets } from '../game/career';
import type { Mode, Payout } from '../game/economy';
import type { Session } from '../net/session';
import { fmt } from '../game/format';
import type { Attack, Medal } from '../game/save';
import type { CarStats } from '../race/car';
import type { Conditions } from '../race/conditions';
import { createGame } from '../race/race';
import { createReplay } from '../race/replay';
import type { LapReport, RaceResult } from '../race/race';
import type { Track } from '../race/track';
import Crt from '../ui/Crt';
import TouchPad from '../ui/TouchPad';
import { wantsTouchPad } from '../ui/touch';
import { nav } from '../ui/nav';
import { C, H, W, bevel, button, medalChip, text } from '../ui/kit';

export interface Outcome extends RaceResult {
  medal: Medal;
  isBest: boolean;
  payout: Payout;
  /** Next track in the career, if this race was part of it. */
  next: Track | null;
  /** An online duel: no medals or prizes, and a rematch instead of a retry. */
  online?: boolean;
}

interface Props {
  track: Track;
  /** `race` against the field, `attack` for time attack with a ghost, `drift` for the drift challenge. */
  mode: Mode;
  /** The player's car. */
  car: { look: number; stats: CarStats };
  /** Weather and time of day. */
  conditions: Conditions;
  /** Multiplier on the AI's pace (difficulty). */
  paceScale: number;
  /** An online duel against a friend; the connection stays open across rematches. */
  online?: Session;
  /** Time attack instead of a race: no field, no finish, a ghost of the saved best lap. */
  attack?: { best: Attack | null; onLap: (track: Track, r: LapReport) => { medal: number; earned: number } };
  /** Called once when the player finishes: stores the result and says what it earned. */
  onRecord: (track: Track, r: RaceResult) => { medal: Medal; isBest: boolean; payout: Payout; next: Track | null };
  onNext: (t: Track) => void;
  onExit: () => void;
}

const ordinal = (n: number) => `${n}${['TH', 'ST', 'ND', 'RD'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;

/** Where result button `i` of `n` sits (the panel is at x 40, y 22). */
function buttonRect(n: number, i: number) {
  const w = 52;
  const gap = 4;
  const total = n * w + (n - 1) * gap;
  return { x: Math.round(W / 2 - total / 2 + i * (w + gap)), y: 22 + 126, w, h: 13 };
}

/** The result panel of an online duel. */
function drawDuel(ctx: CanvasRenderingContext2D, o: Outcome, labels: string[], sel: number, note: string) {
  const x = 40;
  const y = 22;
  const w = W - 80;
  ctx.fillStyle = 'rgba(0,0,17,.55)';
  ctx.fillRect(0, 0, W, H);
  bevel(ctx, x, y, w, 156, C.navy2);
  bevel(ctx, x + 3, y + 3, w - 6, 12, C.navy1, true);
  const lost = o.place === 0;
  text(ctx, lost ? 'CONNECTION LOST' : o.place === 1 ? 'VICTORY' : `FINISHED ${ordinal(o.place)}`, W / 2, y + 6, lost ? C.red : C.gold, { align: 'center' });
  if (!lost) {
    text(ctx, fmt(o.raw), W / 2, y + 28, C.ink, { align: 'center', scale: 3 });
    text(ctx, o.bestLap !== null ? `BEST LAP ${fmt(o.bestLap * 100)}` : '', W / 2, y + 56, C.dim, { align: 'center', small: true });
  }
  bevel(ctx, x + 12, y + 74, w - 24, 34, C.navy1, true);
  text(ctx, 'ONLINE DUEL', W / 2, y + 82, C.cyan, { align: 'center' });
  text(ctx, 'NO PRIZE MONEY, NO RECORDS', W / 2, y + 94, C.dim, { align: 'center', small: true });
  text(ctx, note, W / 2, y + 116, note.startsWith('OPPONENT') ? C.red : C.green, { align: 'center', small: true });
  labels.forEach((l, i) => {
    const r = buttonRect(labels.length, i);
    button(ctx, l, r.x, r.y, r.w, r.h, i === sel);
  });
  text(ctx, 'LEFT RIGHT CHOOSE   ENTER GO   OR CLICK', W / 2, y + 144, C.dim, { align: 'center', small: true });
}

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
  medalChip(ctx, o.medal, W / 2 - 40, y + 47);
  text(ctx, MEDAL_NAMES[o.medal], W / 2 - 28, y + 46, C.ink);
  if (o.isBest) text(ctx, 'NEW BEST', W / 2 + 36, y + 46, C.green);
  if (!isDrift) {
    text(ctx, `TIME ${fmt(o.time * 100)}  DRIFT ${o.drift}${o.bestLap !== null ? `  BEST LAP ${fmt(o.bestLap * 100)}` : ''}`, W / 2, y + 60, C.dim, { align: 'center', small: true });
  }
  const t = targets(track);
  const d = driftTargets(track);
  const goals = isDrift ? [d.gold, d.silver, d.bronze].map(String) : [t.gold, t.silver, t.bronze].map(fmt);
  [3, 2, 1].forEach((m, i) => {
    const gx = x + 34 + i * 62;
    medalChip(ctx, m, gx, y + 72);
    text(ctx, goals[i], gx + 10, y + 71, C.ink);
  });
  bevel(ctx, x + 12, y + 84, w - 24, 34, C.navy1, true);
  if (o.payout.total === 0) {
    text(ctx, 'NO PRIZE MONEY', W / 2, y + 90, C.dim, { align: 'center' });
    text(ctx, 'ONLY THE CAREER PAYS', W / 2, y + 104, C.dim, { align: 'center', small: true });
  } else {
    text(ctx, `+$${o.payout.total}`, W / 2, y + 88, C.green, { align: 'center', scale: 2 });
    text(
      ctx,
      isDrift ? `MEDAL $${o.payout.medal}` : `PLACE $${o.payout.place}  MEDAL $${o.payout.medal}  DRIFT $${o.payout.drift}`,
      W / 2,
      y + 106,
      C.dim,
      { align: 'center', small: true },
    );
  }
  labels.forEach((l, i) => {
    const r = buttonRect(labels.length, i);
    button(ctx, l, r.x, r.y, r.w, r.h, i === sel);
  });
  text(ctx, 'LEFT RIGHT CHOOSE   ENTER GO   OR CLICK', W / 2, y + 144, C.dim, { align: 'center', small: true });
}

export default function RaceScreen({ track, mode, attack, car, conditions, paceScale, online, onRecord, onNext, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [replaying, setReplaying] = useState(false);
  const replayingRef = useRef(false);
  replayingRef.current = replaying;
  const frozen = useRef<{ for: Outcome; img: ImageData } | null>(null);
  const record = useRef(onRecord);
  record.current = onRecord;
  const exit = useRef(onExit);
  exit.current = onExit;
  const carRef = useRef(car);
  carRef.current = car;
  const condRef = useRef(conditions);
  condRef.current = conditions;
  const paceRef = useRef(paceScale);
  paceRef.current = paceScale;
  const attackRef = useRef(attack);
  attackRef.current = attack;
  // rematch: both players have to ask, then both restart the race on the same connection
  const [wantRematch, setWantRematch] = useState(false);
  const [peerRematch, setPeerRematch] = useState(false);
  const [peerGone, setPeerGone] = useState(false);

  useEffect(() => {
    if (!online) return;
    const off = online.link.onMessage((m) => m.t === 'rematch' && setPeerRematch(true));
    const offClose = online.link.onClose(() => setPeerGone(true));
    return () => {
      off();
      offClose();
    };
  }, [online]);

  useEffect(() => {
    if (!wantRematch || !peerRematch) return;
    setWantRematch(false);
    setPeerRematch(false);
    setRun((n) => n + 1);
  }, [wantRematch, peerRematch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setOutcome(null);
    setReplaying(false);
    setWantRematch(false);
    frozen.current = null;
    let detail: RaceResult | undefined;
    const race = startRace(
      canvas,
      (api) => {
        const a = attackRef.current;
        return createGame(api, track, {
          car: carRef.current,
          conditions: condRef.current,
          paceScale: paceRef.current,
          drift: mode === 'drift' ? { limit: DRIFT_LIMIT, targets: Object.values(driftTargets(track)) } : undefined,
          onResult: (r) => (detail = r),
          online: online && { link: online.link, rid: run, looks: online.looks },
          // read the ref again per lap: the save changes after every lap and a stale closure would overwrite it
          attack: a && { best: a.best, onLap: (r) => attackRef.current?.onLap(track, r) },
        });
      },
      (raw) => {
        const d = detail ?? { raw, time: raw / 100, place: 0, drift: 0, bestLap: null };
        setOutcome({ ...d, ...record.current(track, d), online: !!online });
      },
    );
    return () => race.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (e.key !== 'Escape') return;
      if (replayingRef.current) setReplaying(false);
      else exit.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // the result panel: freeze the last frame and draw the panel over it; from there a replay can be played
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !outcome) return;
    if (frozen.current?.for !== outcome) frozen.current = { for: outcome, img: ctx.getImageData(0, 0, W, H) };
    const img = frozen.current.img;
    const at = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };

    if (replaying && outcome.replay) {
      const rp = createReplay(ctx, track, outcome.replay, condRef.current);
      const start = performance.now();
      let raf = 0;
      const frame = (now: number) => {
        if (rp.draw((now - start) / 1000)) setReplaying(false);
        else raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      const onKey = (e: KeyboardEvent) => {
        const n = nav(e);
        if (n === 'right' || n === 'left') rp.next((performance.now() - start) / 1000);
        else if (n === 'ok') setReplaying(false);
        if (n) e.preventDefault();
      };
      const onClick = () => rp.next((performance.now() - start) / 1000);
      window.addEventListener('keydown', onKey);
      canvas.addEventListener('click', onClick);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
        canvas.removeEventListener('click', onClick);
      };
    }

    const duelOver = outcome.online && (peerGone || outcome.place === 0);
    const labels = outcome.online
      ? [...(duelOver || wantRematch ? [] : ['REMATCH']), 'MENU']
      : ['RETRY', ...(outcome.replay ? ['REPLAY'] : []), ...(outcome.next ? ['NEXT'] : []), 'MENU'];
    const note = duelOver ? 'OPPONENT HAS LEFT' : wantRematch ? 'WAITING FOR THE OTHER PLAYER...' : peerRematch ? 'OPPONENT WANTS A REMATCH' : '';
    const act = (i: number) => {
      const l = labels[i];
      if (l === 'REMATCH') {
        online?.link.send({ t: 'rematch' });
        setWantRematch(true);
      } else if (l === 'RETRY') setRun((n) => n + 1);
      else if (l === 'REPLAY') setReplaying(true);
      else if (l === 'NEXT') onNext(outcome.next!);
      else exit.current();
    };
    const hit = (e: MouseEvent) => {
      const p = at(e);
      return labels.findIndex((_, i) => {
        const r = buttonRect(labels.length, i);
        return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
      });
    };
    let sel = 0;
    let raf = 0;
    const frame = () => {
      ctx.putImageData(img, 0, 0);
      if (outcome.online) drawDuel(ctx, outcome, labels, sel, note);
      else drawResult(ctx, outcome, mode, track, labels, sel);
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
    const onMove = (e: MouseEvent) => {
      const i = hit(e);
      if (i >= 0) sel = i;
    };
    const onClick = (e: MouseEvent) => {
      const i = hit(e);
      if (i >= 0) act(i);
    };
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
    };
  }, [outcome, replaying, mode, track, onNext, online, wantRematch, peerRematch, peerGone]);

  return (
    <Crt>
      <canvas ref={canvasRef} width={320} height={200} />
      {!outcome && wantsTouchPad() && <TouchPad onMenu={() => exit.current()} />}
    </Crt>
  );
}
