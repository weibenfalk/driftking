import type { GameApi, GameInstance } from '../engine/types';
import { clamp, formatTime, rnd } from '../engine/util';
import { FIELD, aiDrive } from './ai';
import { checkBoost, collideCars, createGrid, drive, updateDraft } from './car';
import type { Car, CarStats, Env } from './car';
import { LapRecorder, ghostAt, ghostTimeline } from './ghost';
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
}

const ordinal = (n: number) => `${n}${['TH', 'ST', 'ND', 'RD'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`.toUpperCase();

export function createGame(api: GameApi, track: Track, opts: GameOptions = {}): GameInstance {
  const { onResult, attack } = opts;
  const driftMode = opts.drift;
  const { input, audio } = api;
  const world = getWorld(track);
  const { S, N, hw } = world;
  const LAPS = track.laps;
  const renderer = createRenderer(api.ctx, world);

  // engine sound
  const eng = (() => {
    const c = audio.ctx;
    const out = audio.out;
    if (!c || !out) return null;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const o2 = c.createOscillator();
    o2.type = 'square';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
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
    return { c, o, o2, eg, sg, ns };
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
  const thump = () => {
    audio.tone(70, 0.18, 'sine', 0.25);
    audio.tone(140, 0.08, 'square', 0.05);
  };

  // race state
  const grid = createGrid(world, FIELD, opts.car?.look, opts.car?.stats);
  const cars = attack || driftMode ? grid.filter((c) => !c.ai) : grid;
  const player = cars.find((c) => !c.ai)!;
  // dev shortcut: ?at=<centre-line sample> starts the player part-way round, for looking at the scenery
  const at = Number(new URLSearchParams(location.search).get('at'));
  if (at > 0 && at < N) {
    const s = S[at];
    player.x = s.x;
    player.y = s.y;
    player.a = Math.atan2(s.ty, s.tx);
    player.idx = at;
    player.lap = 1;
  }
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
  const DRIFT_SCALE = Math.pow(track.roadGrip, 1.5); // sliding is easy on slippery roads, so it pays less
  let popup: Popup | null = null;
  let banner: Banner | null = { a: 'GO!', b: '', t: 50 };

  const env: Env = {
    world,
    bump: (c) => {
      if (c.ai) return;
      thump();
      loseChain();
    },
    treeHit: (t) => {
      for (let i = 0; i < 8; i++)
        parts.push({ x: t.x + rnd(-t.r, t.r), y: t.y + rnd(-t.r, t.r), vx: rnd(-0.6, 0.6), vy: rnd(-0.6, 0.6), life: 30, max: 30, kind: t.kind === 'tire' ? 'dirt' : 'leaf' });
    },
  };

  const progress = (c: Car) => (c.done ? 1e9 - finishers.indexOf(c) : c.lap * N + c.idx);
  const position = () => [...cars].sort((a, b) => progress(b) - progress(a)).indexOf(player) + 1;
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
    if (step > 0 && step < N / 2 && ni < prev) crossed(c, 1);
    else if (step >= N / 2 && ni > prev) crossed(c, -1);
    c.idx = ni;
  }

  // Water or straying too far from the road sends the player back to the last road position, standing still.
  let safeIdx = player.idx;
  function recover() {
    const sf = surfAt(world, player.x, player.y);
    if (sf === ASPHALT || sf === CURB) {
      safeIdx = player.idx;
      return;
    }
    const gi = globalIdx(world, player.x, player.y);
    const g = S[gi];
    const far = Math.hypot(player.x - g.x, player.y - g.y) > hw[gi] + OFFROAD;
    if (sf !== WATER && !far) return;
    lapValid = false;
    const s = S[safeIdx];
    player.x = s.x;
    player.y = s.y;
    player.a = Math.atan2(s.ty, s.tx);
    player.vx = player.vy = player.vf = player.vr = 0;
    player.steer = 0;
    player.slide = false;
    player.idx = safeIdx;
    loseChain();
    banner = { a: sf === WATER ? 'SPLASH!' : 'OFF TRACK', b: '', t: 40 };
    audio.noise(0.3, 0.08);
    for (let i = 0; i < 14; i++) parts.push({ x: player.x, y: player.y, vx: rnd(-1, 1), vy: rnd(-1, 1), life: 25, max: 25, kind: 'dirt' });
  }

  function crossed(c: Car, dir: number) {
    if (dir < 0) {
      c.lap--;
      if (attack && !c.ai) lapValid = false;
      return;
    }
    c.lap++;
    if (driftMode) return; // laps mean nothing in a drift challenge
    if (attack && !c.ai) {
      attackLap();
      return;
    }
    if (!c.ai) {
      if (c.lap >= 2) {
        lapTime = raceT - lapStart;
        if (bestLap === null || lapTime < bestLap) bestLap = lapTime;
      }
      lapStart = raceT; // laps are timed from the line, not from the grid
    }
    if (c.done) return;
    if (c.lap > LAPS) {
      c.done = true;
      finishers.push(c);
      if (!c.ai) finish();
    } else if (!c.ai && c.lap >= 2 && c.lap < LAPS) {
      banner = { a: `LAP ${c.lap - 1}`, b: formatTime(lapTime), t: 70 };
    } else if (!c.ai && c.lap === LAPS) {
      banner = { a: 'FINAL LAP', b: `LAP ${c.lap - 1} ${formatTime(lapTime)}`, t: 80 };
      audio.tone(784, 0.1, 'square', 0.04);
    }
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

  function finish() {
    if (chain >= 25) {
      driftTotal += Math.round(chain);
      chain = 0;
    }
    state = 'done';
    doneT = 150;
    player.ai = true;
    const bonus = driftTotal / 1000;
    const final = Math.max(1, raceT - bonus);
    finalRaw = Math.round(final * 100);
    const place = finishers.indexOf(player) + 1;
    onResult?.({ raw: finalRaw, time: raceT, place, drift: driftTotal, bestLap });
    banner = { a: place === 1 ? 'VICTORY!' : `FINISHED ${ordinal(place)}`, b: `${formatTime(raceT)} - ${bonus.toFixed(2)} S DRIFT`, t: 999 };
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
    onResult?.({ raw: finalRaw, time: raceT, place: 1, drift: driftTotal, bestLap: null });
    banner = { a: 'TIME UP!', b: `${driftTotal} DRIFT POINTS`, t: 999 };
    api.setScore(finalRaw);
    [523, 659, 784].forEach((f, i) => audio.tone(f, i === 2 ? 0.3 : 0.15, 'square', 0.05, 0, i * 0.15));
  }

  function scoreDrift(dt: number) {
    if (state !== 'race') return;
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

  function update(sec: number) {
    const dt = Math.min(3, sec * 60);
    if (state === 'race') raceT += sec;
    else if ((doneT -= dt) <= 0) api.end(finalRaw);
    if (banner && banner.t < 900 && (banner.t -= dt) <= 0) banner = null;
    if (popup && (popup.t -= dt) <= 0 && chain === 0) popup = null;

    updateDraft(cars, dt);
    if (driftMode && state === 'race' && raceT >= driftMode.limit) finishDrift();
    for (const c of cars) {
      c.boost = Math.max(0, c.boost - dt);
      if (c.ai) aiDrive(c, dt, env, { player, racing: state === 'race', cars });
      else
        drive(
          c,
          {
            steer: input.axisX(),
            gas: input.down('up'),
            brake: input.down('down'),
            hand: input.down('a') || input.down('b'),
          },
          dt,
          env,
        );
      trackProgress(c);
      if (checkBoost(c, world) && !c.ai) {
        popup = { n: 'BOOST!', l: 'FULL POWER', t: 30 };
        audio.tone(880, 0.12, 'square', 0.04);
        audio.tone(1320, 0.12, 'square', 0.04, 0, 0.08);
      }
      if (!c.ai && c.hazard !== lastHazard) {
        if (c.hazard === HAZ_OIL) popup = { n: 'OIL!', l: 'NO GRIP', t: 40, miss: true };
        else if (c.hazard === HAZ_PUDDLE) popup = { n: 'WET!', l: 'LESS GRIP', t: 30, miss: true };
        lastHazard = c.hazard;
      }
      if (!c.ai && state === 'race') recover();
      effects(c, dt);
    }
    collideCars(cars, (a, b, imp) => {
      if ((a === player || b === player) && imp > 0.6 && state === 'race') {
        thump();
        loseChain();
      }
    });
    scoreDrift(dt);
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

    const tx = player.x + player.vx * 16;
    const ty = player.y + player.vy * 16;
    camX += (tx - camX) * Math.min(1, 0.1 * dt);
    camY += (ty - camY) * Math.min(1, 0.1 * dt);
    camX = clamp(camX, SW / 2, world.w - SW / 2);
    camY = clamp(camY, SH / 2, world.h - SH / 2);

    if (eng) {
      const sp = Math.abs(player.vf);
      const gear = sp < 1.4 ? sp / 1.4 : sp < 2.6 ? (sp - 1.4) / 1.2 : sp < 3.6 ? (sp - 2.6) / 1 : (sp - 3.6) / 0.8;
      const f = 55 + gear * 70 + sp * 12;
      const t = eng.c.currentTime;
      eng.o.frequency.setTargetAtTime(f, t, 0.05);
      eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      eng.eg.gain.setTargetAtTime(api.isPaused() ? 0 : 0.045, t, 0.1);
      eng.sg.gain.setTargetAtTime(player.slide && !player.grass && state === 'race' ? Math.min(0.07, Math.abs(player.vr) * 0.025) : 0, t, 0.04);
    }
    if (state === 'race') api.setScore(Math.round(raceT * 100));
    status();
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
  };
}
