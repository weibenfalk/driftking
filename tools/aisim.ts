/* The AI field on the real physics with grass off the road: `node aisim.cjs run` prints lap times and off-road time per driver at three paces. */
import { nearestIdx, globalIdx } from '../src/race/track';
import { createGrid, collideCars, updateDraft } from '../src/race/car';
import { aiDrive, FIELD } from '../src/race/ai';
import { makeWorld, runBot } from './bot';

export function aiField(world: any, pace: number, seconds = 100) {
  const { N } = world;
  const cars = createGrid(world, FIELD);
  const env: any = { world, bump() {}, treeHit() {} };
  const player = cars.find((c) => !c.ai)!; player.ai = true; player.persona = null; // coasting dummy
  const stat = new Map<string, { laps: number; start: number; grass: number; f: number }>();
  for (const c of cars) { c.idx = globalIdx(world, c.x, c.y); }
  const lapT = new Map<string, number[]>(); const lastLapF = new Map<string, number>();
  for (let f = 0; f < seconds * 60; f++) {
    updateDraft(cars, 1);
    for (const c of cars) {
      c.boost = Math.max(0, c.boost - 1);
      aiDrive(c, 1, env, { player, racing: true, cars, pace });
      const prev = c.idx; let ni = nearestIdx(world, c.x, c.y, prev);
      if (f % 30 === 0) { const g = globalIdx(world, c.x, c.y); const fw = (((g - prev) % N) + N) % N; if (fw < N / 4 || fw > N - 25) ni = g; }
      const step = (((ni - prev) % N) + N) % N;
      const name = c.persona?.name ?? 'dummy';
      if (step > 0 && step < N / 2 && ni < prev) { c.lap++; if (c.persona) { const l = lapT.get(name) ?? []; const last = lastLapF.get(name); if (last !== undefined) l.push((f - last) / 60); lapT.set(name, l); lastLapF.set(name, f); } }
      else if (step >= N / 2 && ni > prev) c.lap--;
      c.idx = ni;
      if (c.persona) { const s = stat.get(name) ?? { laps: 0, start: 0, grass: 0, f: 0 }; s.f++; if (c.grass) s.grass++; stat.set(name, s); }
    }
    collideCars(cars, () => {});
  }
  return [...stat.entries()].map(([n, s]) => ({ n, grass: s.grass / s.f, lap: (lapT.get(n) ?? []).slice(1).reduce((a, b, _, arr) => a + b / arr.length, 0) }));
}

if (process.argv[2] === 'run') {
  for (const id of ['meadow', 'lakeside', 'canyon', 'pine-ridge', 'ice-pass', 'downtown']) {
    const w = makeWorld(id);
    const bot = (m: number) => runBot(w, m, 2).avgLap.toFixed(1);
    console.log(`${id}  (bot m1.25 ${bot(1.25)}s  m1.4 ${bot(1.4)}s  m1.55 ${bot(1.55)}s)`);
    for (const pace of [1.3, 1.42, 1.55]) {
      const r = aiField(w, pace);
      console.log(`   pace ${pace}:`, r.map((x) => `${x.n} ${x.lap.toFixed(1)}s/${(x.grass * 100).toFixed(0)}%`).join('  '));
    }
  }
}
