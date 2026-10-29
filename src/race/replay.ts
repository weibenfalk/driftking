import { TAU, clamp } from '../engine/util';
import { FIELD } from './ai';
import { createGrid } from './car';
import type { Car } from './car';
import type { Conditions } from './conditions';
import { createRenderer, SH, SW } from './render';
import { getWorld, globalIdx } from './track';
import type { Track } from './track';

/** Every car's position through a race, sampled at `hz`: x, y, angle for each car per sample. */
export interface ReplayData {
  hz: number;
  /** Drift challenge replays hold only the player. */
  solo: boolean;
  /** Which car is the player's, and its sprite look. */
  player: number;
  look: number;
  /** Flat list: samples * cars * 3. */
  f: number[];
  cars: number;
}

export class ReplayRecorder {
  private f: number[] = [];
  private next = 0;
  private readonly hz = 20;
  private cars: Car[];
  private player: Car;
  private solo: boolean;
  constructor(cars: Car[], player: Car, solo: boolean) {
    this.cars = cars;
    this.player = player;
    this.solo = solo;
  }

  /** Call every update with the seconds since the start of the race. */
  tick(t: number) {
    if (t < this.next) return;
    this.next = t + 1 / this.hz;
    for (const c of this.cars) this.f.push(Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10, Math.round(c.a * 1000) / 1000);
  }

  data(): ReplayData {
    return { hz: this.hz, solo: this.solo, player: this.cars.indexOf(this.player), look: this.player.look, f: this.f, cars: this.cars.length };
  }
}

const CUT = 4.5; // seconds between camera cuts
const CAMS = 3;

/**
 * Plays a recorded race back on a canvas with cinema bars and cuts between a chase camera, a fixed trackside camera
 * and a camera that frames the player together with the nearest rival.
 */
export function createReplay(ctx: CanvasRenderingContext2D, track: Track, data: ReplayData, cond: Conditions) {
  const world = getWorld(track);
  const renderer = createRenderer(ctx, world);
  const grid = createGrid(world, FIELD, data.look);
  const cars = data.solo ? grid.filter((c) => !c.ai) : grid;
  const player = cars[data.player];
  const samples = Math.floor(data.f.length / (data.cars * 3));
  const duration = Math.max(0, (samples - 1) / data.hz);
  let camX = 0;
  let camY = 0;
  let cam = 0;
  let cutAt = 0;
  let fixed = { x: 0, y: 0 };
  let init = false;

  const pose = (t: number) => {
    const p = clamp(t * data.hz, 0, samples - 1);
    const i = Math.floor(p);
    const k = p - i;
    const j = Math.min(samples - 1, i + 1);
    cars.forEach((c, n) => {
      const a = (i * data.cars + n) * 3;
      const b = (j * data.cars + n) * 3;
      c.x = data.f[a] + (data.f[b] - data.f[a]) * k;
      c.y = data.f[a + 1] + (data.f[b + 1] - data.f[a + 1]) * k;
      let d = data.f[b + 2] - data.f[a + 2];
      d -= Math.round(d / TAU) * TAU;
      c.a = data.f[a + 2] + d * k;
      c.vx = (data.f[b] - data.f[a]) * data.hz / 60;
      c.vy = (data.f[b + 1] - data.f[a + 1]) * data.hz / 60;
    });
  };

  /** Switch camera; the trackside one parks itself ahead of the player on the road. */
  const cut = (t: number, to: number) => {
    cam = to % CAMS;
    cutAt = t;
    if (cam === 1) {
      const idx = globalIdx(world, player.x, player.y);
      const s = world.S[(idx + 38) % world.N];
      const side = (idx >> 3) & 1 ? 1 : -1;
      fixed = { x: s.x + s.nx * side * (world.hw[idx] + 22), y: s.y + s.ny * side * (world.hw[idx] + 22) };
    }
  };

  /** Draw the replay at time `t` seconds; returns true once the end has been reached. */
  function draw(t: number): boolean {
    pose(t);
    if (!init) {
      camX = player.x;
      camY = player.y;
      init = true;
    }
    if (t - cutAt > CUT) cut(t, cam + 1);
    let tx = player.x + clamp(player.vx * 20, -90, 90);
    let ty = player.y + clamp(player.vy * 20, -50, 50);
    if (cam === 1) {
      tx = fixed.x;
      ty = fixed.y;
      // the fixed camera lets the car go by, then moves on
      if (Math.hypot(player.x - fixed.x, player.y - fixed.y) > 150 && t - cutAt > 1.5) cut(t, 0);
    } else if (cam === 2) {
      let rival: Car | null = null;
      let best = 1e9;
      for (const c of cars) {
        const d = Math.hypot(c.x - player.x, c.y - player.y);
        if (c !== player && d < best) {
          best = d;
          rival = c;
        }
      }
      if (rival && best < 140) {
        tx = (player.x + rival.x) / 2;
        ty = (player.y + rival.y) / 2;
      }
    }
    const ease = cam === 1 ? 0.2 : 0.08;
    camX += (tx - camX) * ease;
    camY += (ty - camY) * ease;
    camX = clamp(camX, SW / 2, world.w - SW / 2);
    camY = clamp(camY, SH / 2, world.h - SH / 2);
    renderer.draw({
      cars,
      player,
      parts: [],
      camX,
      camY,
      raceT: t,
      popup: null,
      banner: null,
      cond,
      cinema: { t, cam },
      hud: { lap: 1, laps: track.laps, pos: 1, total: cars.length, kmh: 0, speedFrac: 0, drift: 0, chain: 0, bestLap: null, draft: 0, boost: false },
    });
    return t >= duration;
  }

  return { draw, duration, next: (t: number) => cut(t, cam + 1) };
}
