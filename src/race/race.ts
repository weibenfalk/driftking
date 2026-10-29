import type { GameApi, GameInstance } from '../engine/types';
import { clamp, formatTime, rnd } from '../engine/util';
import { aiDrive } from './ai';
import { collideCars, createGrid, drive } from './car';
import type { Car, Env } from './car';
import { SH, SW, createRenderer } from './render';
import type { Banner, Part, Popup } from './render';
import { ASPHALT, CURB, WATER, getWorld, globalIdx, nearestIdx, surfAt } from './track';
import type { Track } from './track';

const OFFROAD = 55; // grass beyond the curb before the player is reset

export function createGame(api: GameApi, track: Track): GameInstance {
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
  const cars = createGrid(world);
  const player = cars.find((c) => !c.ai)!;
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
        parts.push({ x: t.x + rnd(-t.r, t.r), y: t.y + rnd(-t.r, t.r), vx: rnd(-0.6, 0.6), vy: rnd(-0.6, 0.6), life: 30, max: 30, kind: 'leaf' });
    },
  };

  const progress = (c: Car) => (c.done ? 1e9 - finishers.indexOf(c) : c.lap * N + c.idx);
  const position = () => [...cars].sort((a, b) => progress(b) - progress(a)).indexOf(player) + 1;
  let lastHud = '';
  function status() {
    const items = [
      { label: 'LAP', value: `${clamp(player.lap, 1, LAPS)}/${LAPS}` },
      { label: 'POS', value: `${position()}/4` },
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
      return;
    }
    c.lap++;
    if (c.done) return;
    if (c.lap > LAPS) {
      c.done = true;
      finishers.push(c);
      if (!c.ai) finish();
    } else if (!c.ai && c.lap === LAPS) {
      banner = { a: 'FINAL LAP', b: '', t: 80 };
      audio.tone(784, 0.1, 'square', 0.04);
    }
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
    banner = { a: place === 1 ? 'VICTORY!' : `FINISHED ${['1ST', '2ND', '3RD', '4TH'][place - 1]}`, b: `${formatTime(raceT)} - ${bonus.toFixed(2)} S DRIFT`, t: 999 };
    api.setScore(finalRaw);
    status();
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
      chain += ang * sp * dt * 1.6;
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

    for (const c of cars) {
      if (c.ai) aiDrive(c, dt, env, { player, racing: state === 'race' });
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

  const draw = () => renderer.draw({ cars, player, parts, camX, camY, raceT, popup, banner });

  status();
  api.loop(update, draw);

  return {
    timeUp: () => (state === 'done' ? finalRaw : 15000),
  };
}
