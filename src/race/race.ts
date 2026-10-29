import type { GameApi, GameInstance } from '../engine/types';
import { clamp, formatTime, rnd } from '../engine/util';
import { AI_PACE, FIELD, aiDrive } from './ai';
import { DNF_AFTER, Interp, PoseHistory, SNAP_EVERY, applyMotion, packCar } from '../net/duel';
import type { InputMsg, SnapMsg } from '../net/duel';
import type { Link, Msg } from '../net/link';
import { carFrame, checkBoost, collideCars, createDuel, createGrid, drive, updateDraft } from './car';
import type { Car, CarStats, DriveInput, Env } from './car';
import { LapRecorder, ghostAt, ghostTimeline } from './ghost';
import { ReplayRecorder } from './replay';
import type { ReplayData } from './replay';
import { weatherGrip } from './conditions';
import type { Conditions } from './conditions';
import type { GhostData } from './ghost';
import { SH, SW, createRenderer } from './render';
import type { Banner, Part, Popup } from './render';
import { ASPHALT, CURB, HAZ_OIL, HAZ_PUDDLE, WATER, getWorld, globalIdx, nearestIdx, surfAt } from './track';
import type { Track } from './track';

const OFFROAD = 55; // grass beyond the curb before the player is reset

/** What the player did, handed to the UI when they cross the line. */
export interface RaceResult {
  /** Final score in 1/100 s: race time minus the drift bonus. */
  raw: number;
  /** Race time without the bonus, in seconds. */
  time: number;
  place: number;
  drift: number;
  bestLap: number | null;
  /** Everyone's path through the race, for the replay (not in time attack). */
  replay?: ReplayData;
}

/** A clean time attack lap, handed to the UI to be saved. */
export interface LapReport {
  /** Lap time in 1/100 s. */
  lap: number;
  /** Drift points banked during the lap. */
  drift: number;
  ghost: GhostData;
}

export interface GameOptions {
  /** Multiplier on the AI's pace (the difficulty setting). */
  paceScale?: number;
  /** Weather and time of day (visual only). Defaults to clear daylight. */
  conditions?: Conditions;
  /** The player's car: sprite look and physics multipliers. Defaults to the stock car. */
  car?: { look: number; stats: CarStats };
  onResult?: (r: RaceResult) => void;
  /**
   * Time attack: the player drives alone and laps never end. Laps are timed from the start line, the saved best
   * lap plays as a ghost, and only laps without a reset (off track, water) or reversing count.
   */
  attack?: {
    best: { lap: number; ghost: GhostData; drift: number } | null;
    /** Stores the lap; returns the medal it earned and the money paid, for the banner. */
    onLap: (r: LapReport) => { medal: number; earned: number } | void;
  };
  /**
   * Drift challenge: the player drives alone for `limit` seconds and the score is the drift points banked.
   * No laps, no finish line; the run ends when the clock does.
   */
  drift?: { limit: number; /** Bronze, silver, gold scores, for the HUD's next-target line. */ targets: number[] };
  /**
   * Online duel against a friend: two human cars, no AI. The host runs the race and steps both cars; the guest
   * predicts its own car and is corrected by the host's snapshots (see net/duel.ts). Both drive the stock car.
   */
  online?: {
    link: Link;
    /** Which race this is on the link (rematches bump it), so stray messages from the last one are ignored. */
    rid: number;
    /** Sprite look of the host's car and of the guest's. */
    looks: [number, number];
  };
}

const ordinal = (n: number) => `${n}${['TH', 'ST', 'ND', 'RD'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`.toUpperCase();

export function createGame(api: GameApi, track: Track, opts: GameOptions = {}): GameInstance {
  const { onResult, attack, online } = opts;
  const role = online?.link.role;
  const guest = role === 'guest';
  const driftMode = opts.drift;
  const { input, audio } = api;
  const world = getWorld(track);
  const { S, N, hw } = world;
  const LAPS = track.laps;
  const renderer = createRenderer(api.ctx, world);

  // engine sound: two looped 4-bit sample voices (like Paula channels) pitched by playbackRate, plus tyre noise
  const eng = (() => {
    const c = audio.ctx;
    const out = audio.out;
    if (!c || !out) return null;
    const CYCLE = 32;
    const BASE = 8000 / CYCLE; // pitch of the sample at playbackRate 1
    const voice = (shape: (i: number) => number) => {
      const buf = c.createBuffer(1, CYCLE, 8000);
      const d = buf.getChannelData(0);
      for (let i = 0; i < CYCLE; i++) d[i] = Math.round(shape(i) * 7.5) / 7.5; // 4-bit steps
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      return src;
    };
    const o = voice((i) => (i / CYCLE) * 1.6 - 0.8 + (i % 16 < 5 ? 0.25 : 0)); // buzzy saw
    const o2 = voice((i) => (i < 11 ? 0.7 : -0.7)); // narrow pulse
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3300; // the A500's output filter
    const eg = c.createGain();
    eg.gain.value = 0;
    o.connect(lp);
    o2.connect(lp);
    lp.connect(eg).connect(out);
    o.start();
    o2.start();
    const nb = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = c.createBufferSource();
    ns.buffer = nb;
    ns.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 4;
    const sg = c.createGain();
    sg.gain.value = 0;
    ns.connect(bp).connect(sg).connect(out);
    ns.start();
    return { c, o, o2, eg, sg, ns, BASE };
  })();
  api.onCleanup(() => {
    if (!eng) return;
    try {
      eng.o.stop();
      eng.o2.stop();
      eng.ns.stop();
      eng.eg.disconnect();
      eng.sg.disconnect();
    } catch {
      /* already stopped */
    }
  });
  let shake = 0;
  const thump = () => {
    audio.tone(70, 0.18, 'sine', 0.25);
    audio.tone(140, 0.08, 'square', 0.05);
  };
  /** A hit on the player's car: sparks, a jolt of the camera, the thump. */
  const crash = (power: number) => {
    thump();
    shake = Math.max(shake, Math.min(4, 1.5 + power * 2));
    for (let i = 0; i < 6 + power * 6; i++)
      parts.push({ x: player.x + rnd(-4, 4), y: player.y + rnd(-4, 4), vx: rnd(-1.6, 1.6), vy: rnd(-1.6, 1.6), life: 14, max: 14, kind: 'spark' });
  };

  // race state
  const grid = online ? createDuel(world, online.looks) : createGrid(world, FIELD, opts.car?.look, opts.car?.stats);
  const cars = attack || driftMode ? grid.filter((c) => !c.ai) : grid;
  const player = online ? cars[guest ? 1 : 0] : cars.find((c) => !c.ai)!;
  const remote = online ? cars[guest ? 0 : 1] : null;
  /** The car the person at this keyboard drives (until it has finished and coasts). */
  const human = (c: Car) => c === player && !c.ai;
  // dev shortcut: ?at=<centre-line sample> starts the player part-way round, for looking at the scenery
  const at = Number(new URLSearchParams(location.search).get('at'));
  if (at > 0 && at < N && !online) {
    const s = S[at];
    player.x = s.x;
    player.y = s.y;
    player.a = Math.atan2(s.ty, s.tx);
    player.idx = at;
    player.lap = 1;
  }
  const rec = new ReplayRecorder(cars, player, !!driftMode);
  let mineDone = false; // the player has crossed the line (the race goes on for the other player in a duel)
  const finishers: Car[] = [];
  let parts: Part[] = [];
  let state: 'race' | 'done' = 'race';
  let raceT = 0;
  let doneT = 0;
  let finalRaw = 0;
  let camX = player.x;
  let camY = player.y;
  let driftTotal = 0;
  let chain = 0;
  let chainT = 0;
  let lapStart = 0;
  let lapTime = 0;
  let bestLap: number | null = attack?.best ? attack.best.lap / 100 : null;
  // time attack
  let best = attack?.best ?? null;
  let ghostData: GhostData | null = best?.ghost ?? null;
  let timeline = ghostData ? ghostTimeline(world, ghostData) : null;
  let recorder = new LapRecorder();
  let lapDriftStart = 0;
  let lastHazard = 0;
  let lapValid = true;
  const wetGrip = weatherGrip(track, (opts.conditions ?? { weather: 'clear' }).weather);
  const DRIFT_SCALE = Math.pow(track.roadGrip * wetGrip, 1.5); // sliding is easy on slippery roads, so it pays less
  let popup: Popup | null = null;
  let banner: Banner | null = null;
  // start sequence: lamps light one by one (frames), then green and release
  const COUNT = 140;
  let countT = 0;
  let lamps = 0;
  let goShow = 0;
  let flagT = -1;
  let lastSec = -1;
  // online duel
  let firstHomeT = 0; // race clock when the first car crossed the line
  let peerReady = !online || guest; // host: the guest's game is up
  let peerGone = false;
  let gotSnap = false;
  let seq = 0; // guest: number of the next input tick
  let ack = 0; // host: last guest input tick stepped
  let lastSnapAt = 0;
  let goSeen = false;
  let hostPos = 1;
  const inbox: InputMsg[] = [];
  const interp = new Interp();
  const hist = new PoseHistory();
  let netErr = 0; // guest: how far the host said our car was from where we had it, in px (for tests)

  const env: Env = {
    world,
    grip: wetGrip,
    bump: (c) => {
      if (!human(c)) return;
      crash(1);
      loseChain();
    },
    treeHit: (t) => {
      for (let i = 0; i < 16; i++)
        parts.push({ x: t.x + rnd(-t.r, t.r), y: t.y + rnd(-t.r, t.r), vx: rnd(-0.6, 0.6), vy: rnd(-0.6, 0.6), life: 30, max: 30, kind: t.kind === 'tire' ? 'dirt' : 'leaf' });
    },
  };

  const progress = (c: Car) => (c.done ? 1e9 - finishers.indexOf(c) : c.lap * N + c.idx);
  const placeOf = (c: Car) => [...cars].sort((a, b) => progress(b) - progress(a)).indexOf(c) + 1;
  const position = () => (guest ? hostPos : placeOf(player)); // a guest is told its place by the host
  let lastHud = '';
  function status() {
    const items = [
      { label: 'LAP', value: `${clamp(player.lap, 1, LAPS)}/${LAPS}` },
      { label: 'POS', value: `${position()}/${cars.length}` },
      { label: 'DRIFT', value: driftTotal },
    ];
    const key = JSON.stringify(items);
    if (key !== lastHud) {
      lastHud = key;
      api.setStatus(items);
    }
  }

  function loseChain() {
    if (chain > 30) {
      popup = { n: String(Math.round(chain)), l: 'LOST', t: 60, miss: true };
      audio.tone(160, 0.25, 'sawtooth', 0.05);
    }
    chain = 0;
    chainT = 0;
  }

  /** Follow the car along the centre line and count lap crossings. */
  function trackProgress(c: Car) {
    const prev = c.idx;
    c.glob += 1;
    let ni = nearestIdx(world, c.x, c.y, prev);
    if (c.glob % 30 === 0) {
      const g = globalIdx(world, c.x, c.y);
      const fw = (((g - prev) % N) + N) % N;
      if (fw < N / 4 || fw > N - 25) ni = g;
    }
    const step = (((ni - prev) % N) + N) % N;
    if (!guest) {
      // (a guest takes its laps from the host's snapshots)
      if (step > 0 && step < N / 2 && ni < prev) crossed(c, 1);
      else if (step >= N / 2 && ni > prev) crossed(c, -1);
    }
    c.idx = ni;
  }

  // Water or straying too far from the road sends a car back to its last road position, standing still.
  const safeIdx = new Map<Car, number>();
  function recover(c: Car) {
    const sf = surfAt(world, c.x, c.y);
    if (sf === ASPHALT || sf === CURB) {
      safeIdx.set(c, c.idx);
      return;
    }
    const gi = globalIdx(world, c.x, c.y);
    const g = S[gi];
    const far = Math.hypot(c.x - g.x, c.y - g.y) > hw[gi] + OFFROAD;
    if (sf !== WATER && !far) return;
    const s = S[safeIdx.get(c) ?? c.idx];
    c.x = s.x;
    c.y = s.y;
    c.a = Math.atan2(s.ty, s.tx);
    c.vx = c.vy = c.vf = c.vr = 0;
    c.steer = 0;
    c.slide = false;
    c.idx = safeIdx.get(c) ?? c.idx;
    if (human(c)) {
      lapValid = false;
      loseChain();
      // a reset costs two seconds in a race or drift challenge (time attack already voids the lap; a duel is decided by
      // who crosses first, and the trip back is penalty enough)
      if (!attack && !online) raceT += 2;
      banner = { a: sf === WATER ? 'SPLASH!' : 'OFF TRACK', b: attack || online ? '' : '+2 SECONDS', t: 40 };
      audio.noise(0.3, 0.08);
    }
    for (let i = 0; i < 14; i++) parts.push({ x: c.x, y: c.y, vx: rnd(-1, 1), vy: rnd(-1, 1), life: 25, max: 25, kind: 'dirt' });
  }

  function crossed(c: Car, dir: number) {
    if (dir < 0) {
      c.lap--;
      if (attack && human(c)) lapValid = false;
      return;
    }
    c.lap++;
    if (driftMode) return; // laps mean nothing in a drift challenge
    if (attack && human(c)) {
      attackLap();
      return;
    }
    if (human(c)) newLap(c);
    if (c.done) return;
    if (c.lap > LAPS) {
      c.done = true;
      finishers.push(c);
      if (online && finishers.length === 1) firstHomeT = raceT;
      if (human(c)) finish();
      else if (c === remote) remoteHome();
    } else if (human(c)) lapBanner(c);
  }

  /** The player started a lap: time the one that just ended. */
  function newLap(c: Car) {
    if (c.lap >= 2) {
      lapTime = raceT - lapStart;
      if (bestLap === null || lapTime < bestLap) bestLap = lapTime;
    }
    lapStart = raceT; // laps are timed from the line, not from the grid
  }

  function lapBanner(c: Car) {
    if (c.lap >= 2 && c.lap < LAPS) {
      banner = { a: `LAP ${c.lap - 1}`, b: formatTime(lapTime), t: 70 };
    } else if (c.lap === LAPS) {
      banner = { a: 'FINAL LAP', b: `LAP ${c.lap - 1} ${formatTime(lapTime)}`, t: 80 };
      audio.tone(784, 0.1, 'square', 0.04);
    }
  }

  /** Host: the guest's car crossed the line (or ran out of time). It coasts from here, and the guest is told its place. */
  function remoteHome() {
    remote!.ai = true;
    online!.link.send({ t: 'fin', rid: online!.rid, place: finishers.indexOf(remote!) + 1, time: raceT });
  }

  /** Player crossed the line in time attack: close the lap that just ended (if there was one) and start the next. */
  function attackLap() {
    if (player.lap >= 2) {
      const t = raceT - lapStart;
      if (!lapValid) {
        banner = { a: 'INVALID LAP', b: formatTime(t), t: 70 };
      } else {
        const lap = Math.round(t * 100);
        const drift = driftTotal - lapDriftStart;
        const newLap = !best || lap < best.lap;
        const newDrift = !best || drift > best.drift;
        const ghost = recorder.finish(player.x, player.y, player.a);
        const paid = attack!.onLap({ lap, drift, ghost });
        const gap = best ? (lap - best.lap) / 100 : 0;
        best = { lap: newLap ? lap : best!.lap, ghost: newLap ? ghost : best!.ghost, drift: newDrift ? drift : best!.drift };
        if (newLap) {
          ghostData = ghost;
          timeline = ghostTimeline(world, ghost);
          bestLap = t;
        }
        const money = paid && paid.earned > 0 ? `  +$${paid.earned}` : '';
        banner = newLap
          ? { a: 'NEW BEST LAP', b: formatTime(t) + money, t: 90 }
          : { a: `LAP ${player.lap - 1}`, b: `${formatTime(t)}  +${gap.toFixed(2)}${money}`, t: 70 };
        if (newLap) [523, 659, 784].forEach((f, i) => audio.tone(f, 0.12, 'square', 0.04, 0, i * 0.1));
        else if (newDrift) audio.tone(660, 0.1, 'square', 0.04);
      }
    }
    lapStart = raceT;
    lapDriftStart = driftTotal;
    lapValid = true;
    recorder = new LapRecorder();
  }

  /** The player crossed the line. A guest is told its place and time by the host. */
  function finish(told?: { place: number; time: number }) {
    if (chain >= 25) {
      driftTotal += Math.round(chain);
      chain = 0;
    }
    mineDone = true;
    flagT = 0;
    player.ai = true;
    if (told) raceT = told.time;
    // in a duel the race goes on until the other player is home too, and only the finishing order counts
    if (!online) {
      state = 'done';
      doneT = 150;
    }
    const bonus = online ? 0 : driftTotal / 1000;
    const final = Math.max(1, raceT - bonus);
    finalRaw = Math.round(final * 100);
    const place = told ? told.place : finishers.indexOf(player) + 1;
    onResult?.({ raw: finalRaw, time: raceT, place, drift: driftTotal, bestLap, replay: online ? undefined : rec.data() });
    banner = online
      ? { a: place === 1 ? 'VICTORY!' : `FINISHED ${ordinal(place)}`, b: `${formatTime(raceT)}`, t: 999 }
      : { a: place === 1 ? 'VICTORY!' : `FINISHED ${ordinal(place)}`, b: `${formatTime(raceT)} - ${bonus.toFixed(2)} S DRIFT`, t: 999 };
    api.setScore(finalRaw);
    status();
    [523, 659, 784].forEach((f, i) => audio.tone(f, i === 2 ? 0.3 : 0.15, 'square', 0.05, 0, i * 0.15));
  }

  /** The clock ran out in a drift challenge: bank what's pending and report the score. */
  function finishDrift() {
    if (chain >= 25) {
      driftTotal += Math.round(chain);
      chain = 0;
    }
    state = 'done';
    doneT = 150;
    player.ai = true;
    finalRaw = driftTotal;
    onResult?.({ raw: finalRaw, time: raceT, place: 1, drift: driftTotal, bestLap: null, replay: rec.data() });
    banner = { a: 'TIME UP!', b: `${driftTotal} DRIFT POINTS`, t: 999 };
    api.setScore(finalRaw);
    [523, 659, 784].forEach((f, i) => audio.tone(f, i === 2 ? 0.3 : 0.15, 'square', 0.05, 0, i * 0.15));
  }

  function scoreDrift(dt: number) {
    if (state !== 'race' || mineDone) return;
    const sp = Math.hypot(player.vx, player.vy);
    const ang = Math.abs(Math.atan2(player.vr, Math.max(0.1, player.vf)));
    if (player.slide && player.vf > 1.3 && ang > 0.18) {
      if (player.grass) {
        loseChain();
        return;
      }
      chain += ang * sp * dt * 1.6 * DRIFT_SCALE;
      chainT = 20;
      popup = { n: String(Math.round(chain)), l: ang > 0.75 ? 'WILD DRIFT' : ang > 0.45 ? 'NICE DRIFT' : 'DRIFT', t: 30 };
    } else if (chain > 0 && (chainT -= dt) <= 0) {
      if (chain >= 25) {
        const v = Math.round(chain);
        driftTotal += v;
        popup = { n: '+' + v, l: 'BANKED', t: 60 };
        audio.tone(660, 0.07, 'square', 0.04);
        audio.tone(990, 0.1, 'square', 0.04, 0, 0.06);
      }
      chain = 0;
    }
  }

  /** Tyre marks, smoke and dirt behind the rear wheels. */
  function effects(c: Car, dt: number) {
    const fx = Math.cos(c.a);
    const fy = Math.sin(c.a);
    const rx = -fy;
    const ry = fx;
    const sp = Math.hypot(c.vx, c.vy);
    const sliding = c.slide && sp > 1;
    for (const side of [-3, 3]) {
      const wx = c.x - fx * 4 + rx * side;
      const wy = c.y - fy * 4 + ry * side;
      if (c.hazard === HAZ_PUDDLE && sp > 1.2 && Math.random() < 0.6 * dt)
        parts.push({ x: wx, y: wy, vx: -c.vx * 0.2 + rnd(-0.5, 0.5), vy: -c.vy * 0.2 + rnd(-0.5, 0.5), life: 18, max: 18, kind: 'splash' });
      if (sliding && !c.grass) {
        renderer.skid(wx, wy);
        if (Math.random() < 0.35 * dt) parts.push({ x: wx, y: wy, vx: -c.vx * 0.15 + rnd(-0.2, 0.2), vy: -c.vy * 0.15 + rnd(-0.2, 0.2), life: 40, max: 40, kind: 'smoke' });
      }
      if (c.grass && sp > 1 && Math.random() < 0.4 * dt)
        parts.push({ x: wx, y: wy, vx: -c.vx * 0.3 + rnd(-0.4, 0.4), vy: -c.vy * 0.3 + rnd(-0.4, 0.4), life: 22, max: 22, kind: 'dirt' });
    }
  }

  function engineSound(rev?: number) {
    if (!eng) return;
    const sp = rev ?? Math.abs(player.vf);
    const gear = sp < 1.4 ? sp / 1.4 : sp < 2.6 ? (sp - 1.4) / 1.2 : sp < 3.6 ? (sp - 2.6) / 1 : (sp - 3.6) / 0.8;
    const f = 55 + gear * 70 + sp * 12;
    const t = eng.c.currentTime;
    eng.o.playbackRate.setTargetAtTime(f / eng.BASE, t, 0.05);
    eng.o2.playbackRate.setTargetAtTime((f * 0.5) / eng.BASE, t, 0.05);
    eng.eg.gain.setTargetAtTime(api.isPaused() ? 0 : 0.045, t, 0.1);
    eng.sg.gain.setTargetAtTime(player.slide && !player.grass && state === 'race' ? Math.min(0.07, Math.abs(player.vr) * 0.025) : 0, t, 0.04);
  }

  const ownInput = (): DriveInput => ({ steer: input.axisX(), gas: input.down('up'), brake: input.down('down'), hand: input.down('a') || input.down('b') });

  /** One car for one tick: drive it, then lap tracking, boost strips, hazards, off-track recovery and tyre marks. */
  function stepCar(c: Car, inp: DriveInput | null, dt: number) {
    c.boost = Math.max(0, c.boost - dt);
    if (c.ai) aiDrive(c, dt, env, { player, racing: state === 'race', cars, pace: AI_PACE * (opts.paceScale ?? 1) });
    else drive(c, inp!, dt, env);
    trackProgress(c);
    if (checkBoost(c, world) && human(c)) {
      popup = { n: 'BOOST!', l: 'FULL POWER', t: 30 };
      audio.tone(880, 0.12, 'square', 0.04);
      audio.tone(1320, 0.12, 'square', 0.04, 0, 0.08);
    }
    if (human(c) && c.hazard !== lastHazard) {
      if (c.hazard === HAZ_OIL) popup = { n: 'OIL!', l: 'NO GRIP', t: 40, miss: true };
      else if (c.hazard === HAZ_PUDDLE) popup = { n: 'WET!', l: 'LESS GRIP', t: 30, miss: true };
      lastHazard = c.hazard;
    }
    if (!c.ai && state === 'race') recover(c);
    effects(c, dt);
  }

  /* ---- online duel ---- */

  function onNet(m: Msg) {
    if (!online || m.rid !== online.rid) return;
    if (!guest) {
      if (m.t === 'ready') {
        if (!peerReady) banner = null;
        peerReady = true;
      } else if (m.t === 'in' && inbox.length < 600) inbox.push(m as InputMsg);
    } else if (m.t === 'snap') onSnap(m as SnapMsg);
    else if (m.t === 'fin' && !mineDone) finish({ place: m.place, time: m.time });
  }

  /** Guest: the host's word on where everything is. */
  function onSnap(m: SnapMsg) {
    gotSnap = true;
    hostPos = m.pos;
    const wasHome = remote!.done;
    interp.push(m.cars[0], performance.now());
    applyMotion(remote!, m.cars[0]);
    if (remote!.done && !wasHome && !mineDone) banner = { a: 'OPPONENT HOME', b: `FINISH IN ${DNF_AFTER} S`, t: 90 };
    const g = m.cars[1];
    if (!mineDone) netErr = Math.max(hist.correct(m.k, g, player), 0);
    if (g[11] !== player.lap) {
      const up = g[11] > player.lap;
      player.lap = g[11];
      if (up && !mineDone && state === 'race') {
        newLap(player);
        if (player.lap <= LAPS) lapBanner(player);
      }
    }
    if (m.go) {
      goSeen = true;
      if (countT < COUNT) countT = COUNT;
    } else countT = Math.max(countT, Math.min(m.ct, COUNT - 1));
    if (m.go && state === 'race') raceT = Math.abs(m.rt - raceT) > 0.25 ? m.rt : raceT + (m.rt - raceT) * 0.1;
  }

  /** Host: tell the guest where everything is, about 30 times a second. */
  function sendSnap() {
    const now = performance.now();
    if (!online || guest || !peerReady || peerGone || now - lastSnapAt < SNAP_EVERY * 1000) return;
    lastSnapAt = now;
    const snap: SnapMsg = { t: 'snap', rid: online.rid, k: ack, rt: raceT, ct: countT, go: countT >= COUNT ? 1 : 0, pos: placeOf(remote!), cars: [packCar(player), packCar(remote!)] };
    online.link.sendFast(snap);
  }

  function peerLeft() {
    peerGone = true;
    peerReady = true;
    if (guest) {
      // the host runs the race, so there is nothing left to drive
      if (state === 'race') {
        state = 'done';
        doneT = 120;
        if (!mineDone) {
          mineDone = true;
          player.ai = true;
          finalRaw = 0;
          onResult?.({ raw: 0, time: raceT, place: 0, drift: 0, bestLap });
          banner = { a: 'CONNECTION LOST', b: '', t: 999 };
        }
      }
    } else {
      remote!.ai = true; // it coasts to a stop
      if (!mineDone) banner = { a: 'OPPONENT LEFT', b: '', t: 120 };
    }
  }

  if (online) {
    const offMsg = online.link.onMessage(onNet);
    const offClose = online.link.onClose(peerLeft);
    let ping = 0;
    if (guest) {
      // tell the host this game is up; repeat until its snapshots arrive, in case the first call was lost
      const hello = () => online.link.send({ t: 'ready', rid: online.rid });
      hello();
      ping = window.setInterval(() => !gotSnap && hello(), 400);
    }
    api.onCleanup(() => {
      offMsg();
      offClose();
      clearInterval(ping);
    });
  }

  function update(sec: number) {
    const dt = Math.min(3, sec * 60);
    shake *= Math.pow(0.88, dt);
    if (flagT >= 0) flagT += dt;
    if (goShow > 0) goShow -= dt;
    if (!peerReady) {
      // a host waits on the grid until the guest's game is up
      banner = { a: 'WAITING', b: 'FOR OPPONENT', t: 999 };
      engineSound(0);
      status();
      return;
    }
    if (countT < COUNT) {
      // everybody waits on the grid; holding gas revs the engine
      countT += dt;
      if (guest && !goSeen) countT = Math.min(countT, COUNT - 1); // the host says when the lights go green
      const n = countT >= COUNT ? 4 : countT < 20 ? 0 : countT < 55 ? 1 : countT < 90 ? 2 : 3;
      if (n !== lamps) {
        lamps = n;
        if (n === 4) {
          audio.tone(880, 0.4, 'square', 0.06);
          banner = { a: 'GO!', b: '', t: 50 };
          goShow = 40;
        } else if (n > 0) audio.tone(440, 0.12, 'square', 0.05);
      }
      engineSound(input.down('up') ? 1.6 : 0);
      status();
      sendSnap();
      return;
    }
    if (state === 'race') raceT += sec;
    else if ((doneT -= dt) <= 0) api.end(finalRaw);
    if (banner && banner.t < 900 && (banner.t -= dt) <= 0) banner = null;
    if (popup && (popup.t -= dt) <= 0 && chain === 0) popup = null;

    updateDraft(cars, dt);
    if (driftMode && state === 'race') {
      const left = Math.ceil(driftMode.limit - raceT);
      if (left !== lastSec) {
        lastSec = left;
        if (left <= 10 && left > 0) audio.tone(left <= 3 ? 1320 : 990, 0.06, 'square', 0.04);
      }
    }
    if (driftMode && state === 'race' && raceT >= driftMode.limit) finishDrift();
    if (!online) {
      for (const c of cars) stepCar(c, c.ai ? null : ownInput(), dt);
    } else if (guest) {
      // predict our own car and tell the host what we did; the other car is wherever the host last said, a moment ago
      if (!player.ai) {
        const inp = ownInput();
        seq++;
        online.link.send({ t: 'in', rid: online.rid, k: seq, dt, s: inp.steer, g: inp.gas ? 1 : 0, b: inp.brake ? 1 : 0, h: inp.hand ? 1 : 0 } satisfies InputMsg);
        stepCar(player, inp, dt);
        hist.push(seq, player);
      } else stepCar(player, null, dt);
      if (interp.ready) {
        interp.place(remote!, performance.now());
        carFrame(remote!, world);
        effects(remote!, dt);
      }
    } else {
      // host: our car with our controls, the guest's car one tick per input it sent
      stepCar(player, player.ai ? null : ownInput(), dt);
      if (remote!.ai) {
        inbox.length = 0;
        stepCar(remote!, null, dt);
      } else
        for (const m of inbox.splice(0, 120)) {
          stepCar(remote!, { steer: m.s, gas: !!m.g, brake: !!m.b, hand: !!m.h }, m.dt);
          ack = m.k;
        }
    }
    // a duel ends when both players are home, or the loser had its time, or the other one is gone
    if (online && state === 'race' && mineDone && (remote!.done || peerGone)) {
      state = 'done';
      doneT = 120;
    }
    if (online && !guest && !peerGone && state === 'race' && finishers.length === 1 && raceT - firstHomeT > DNF_AFTER) {
      if (!remote!.done) {
        remote!.done = true;
        finishers.push(remote!);
        remoteHome();
      } else if (!mineDone) {
        player.done = true;
        finishers.push(player);
        finish();
      }
    }
    collideCars(cars, (a, b, imp) => {
      if ((a === player || b === player) && imp > 0.6 && state === 'race') {
        crash(Math.min(1.5, imp));
        loseChain();
      }
    });
    scoreDrift(dt);
    if (!attack && !online) rec.tick(raceT + (flagT > 0 ? flagT / 60 : 0));
    if (attack && player.lap >= 1) recorder.tick(raceT - lapStart, player.x, player.y, player.a);
    for (const q of parts) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.95;
      q.vy *= 0.95;
      q.life -= dt;
    }
    parts = parts.filter((q) => q.life > 0);
    if (parts.length > 500) parts.splice(0, parts.length - 500);

    const tx = player.x + clamp(player.vx * 20, -110, 110);
    const ty = player.y + clamp(player.vy * 20, -64, 64);
    camX += (tx - camX) * Math.min(1, 0.1 * dt);
    camY += (ty - camY) * Math.min(1, 0.1 * dt);
    camX = clamp(camX, SW / 2, world.w - SW / 2);
    camY = clamp(camY, SH / 2, world.h - SH / 2);

    engineSound();
    if (state === 'race') api.setScore(Math.round(raceT * 100));
    status();
    sendSnap();
  }

  const TOP_SPEED = 4.6; // px/frame, a little above what the car reaches on asphalt
  const draw = () => {
    const sp = Math.hypot(player.vx, player.vy);
    const running = !!attack && player.lap >= 1;
    const lapT = running ? raceT - lapStart : 0;
    const gap = running && timeline ? lapT - timeline[player.idx] : NaN;
    renderer.draw({
      ghost: running && ghostData ? ghostAt(ghostData, lapT) : null,
      cars,
      player,
      parts,
      cond: opts.conditions ?? { weather: 'clear', time: 'day' },
      camX,
      camY,
      shake,
      lights: countT < COUNT || goShow > 0 ? lamps : undefined,
      flag: flagT >= 0 ? flagT : undefined,
      raceT,
      popup,
      banner,
      hud: {
        lap: attack ? player.lap : clamp(player.lap, 1, LAPS),
        laps: LAPS,
        pos: attack ? 1 : position(),
        total: cars.length,
        kmh: Math.round(sp * 40),
        speedFrac: clamp(sp / (TOP_SPEED * player.stats.top), 0, 1),
        drift: driftTotal,
        chain,
        bestLap,
        draft: player.draft,
        boost: player.boost > 0,
        driftLeft: driftMode ? Math.max(0, driftMode.limit - raceT) : undefined,
        driftNext: driftMode ? (driftMode.targets.find((t) => t > driftTotal) ?? null) : undefined,
        attack: attack
          ? { lapT, delta: Number.isNaN(gap) ? null : gap, valid: lapValid, lapDrift: driftTotal - lapDriftStart, bestDrift: best?.drift ?? null }
          : undefined,
      },
    });
  };

  status();
  api.loop(update, draw);

  return {
    timeUp: () => (state === 'done' ? finalRaw : 15000),
    inspect: () => ({ cars, player, remote, raceT, state, mineDone, netErr, finishers: finishers.map((c) => cars.indexOf(c)) }),
  };
}
