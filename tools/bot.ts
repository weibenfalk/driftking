/*
 * Test-driver bot on the real car physics (no canvas needed). Used to calibrate AI pace and medal targets:
 *   npx esbuild tools/bot.ts --bundle --platform=node --outfile=/tmp/bot.cjs && node /tmp/bot.cjs lap-bot|limit-bot
 * `m` multiplies the AI's corner-speed profile; the bot leaves the road above m of about 1.6 on dry tarmac.
 */
import { sampleCenterline, aiSpeeds, roadWidths, nearestIdx, turnAhead, parTime, ASPHALT, GRASS } from '../src/race/track';
import { TRACKS } from '../src/race/tracks';
import { createGrid, drive, UNIT_STATS } from '../src/race/car';
import { autoConditions, weatherGrip } from '../src/race/conditions';
import { wrapAngle, clamp } from '../src/engine/util';

export function makeWorld(id: string) {
  const track = TRACKS.find((t) => t.id === id)!;
  const { S, N } = sampleCenterline(track.cp);
  const hw = roadWidths(S, track.halfWidth, track.cornerExtra);
  const w = track.width, h = track.height;
  const surf = new Uint8Array(w * h).fill(GRASS);
  for (let i = 0; i < N; i++) { const r = hw[i] + 5; const r2 = r * r; for (let dy = -Math.ceil(r); dy <= r; dy++) for (let dx = -Math.ceil(r); dx <= r; dx++) { if (dx * dx + dy * dy > r2) continue; const X = Math.round(S[i].x + dx), Y = Math.round(S[i].y + dy); if (X >= 0 && Y >= 0 && X < w && Y < h) surf[Y * w + X] = ASPHALT; } }
  const world: any = { track, w, h, S, N, aiSpd: aiSpeeds(S), hw, surf, hazard: new Uint8Array(w * h), trees: [], boosts: [] };
  return world;
}

/** A competent-driver bot: pure pursuit steering and a speed limit taken from the corner profile times `m`. */
export function runBot(world: any, m: number, laps = 3, stats = UNIT_STATS) {
  const { S, N, aiSpd } = world;
  const env: any = { world, bump() {}, treeHit() {}, grip: weatherGrip(world.track, autoConditions(world.track).weather) }; // the track's own weather, as in the game
  const c = createGrid(world, [], 0, stats)[0];
  c.ai = false;
  let frames = 0, grassFrames = 0, lapStart = 0; const lapTimes: number[] = []; let lap = 0; c.idx = nearestIdx(world, c.x, c.y, 0, 0, N);
  c.idx = (() => { let bi = 0, bd = 1e18; for (let i = 0; i < N; i++) { const d = (S[i].x - c.x) ** 2 + (S[i].y - c.y) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; })();
  while (lapTimes.length < laps && frames < 60 * 600) {
    const sp = Math.hypot(c.vx, c.vy);
    const look = 9 + Math.round(sp * 4.5);
    const s = S[(c.idx + look) % N];
    const err = wrapAngle(Math.atan2(s.y - c.y, s.x - c.x) - c.a);
    // speed limit: tightest corner within the braking distance ahead
    let lim = 9; for (let k = 0; k < 40; k++) lim = Math.min(lim, aiSpd[(c.idx + k) % N] * (1 + k * 0.0)); lim *= m;
    const vt = Math.max(1.2, lim);
    drive(c, { steer: clamp(err * 3.2, -1, 1), gas: c.vf < vt, brake: c.vf > vt + 0.25, hand: false }, 1, env);
    const prev = c.idx; const ni = nearestIdx(world, c.x, c.y, prev);
    const step = (((ni - prev) % N) + N) % N;
    if (step > 0 && step < N / 2 && ni < prev) { lap++; if (lap >= 2) { lapTimes.push((frames - lapStart) / 60); } lapStart = frames; }
    c.idx = ni; frames++; if (c.grass) grassFrames++;
  }
  return { lapTimes, grass: grassFrames / frames, avgLap: lapTimes.reduce((a, b) => a + b, 0) / Math.max(1, lapTimes.length) };
}

if (process.argv[2] === 'lap-bot') {
  for (const id of ['meadow', 'lakeside', 'canyon', 'ice-pass', 'downtown']) {
    const w = makeWorld(id); const par = parTime(w.track) / w.track.laps;
    const row = [1.0, 1.1, 1.2, 1.3, 1.4].map((m) => { const r = runBot(w, m, 2); return `m${m}: ${r.avgLap.toFixed(1)}s g${(r.grass * 100).toFixed(0)}%`; });
    console.log(id.padEnd(10), 'par/lap', par.toFixed(1), '|', row.join('  '));
  }
}
if (process.argv[2] === 'limit-bot') {
  for (const id of ['meadow', 'lakeside', 'hills', 'dunes', 'canyon', 'pine-ridge', 'mud-creek', 'ice-pass', 'frostbite', 'downtown', 'skyline']) {
    const w = makeWorld(id);
    const row = [1.3, 1.45, 1.6, 1.75, 1.9].map((m) => { const r = runBot(w, m, 2); return `${m}: ${r.avgLap.toFixed(1)}s/${(r.grass * 100).toFixed(0)}%`; });
    console.log(id.padEnd(11), row.join('   '));
  }
}
