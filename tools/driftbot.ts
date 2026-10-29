/* A handbrake-drifting bot, scored like the game's drift challenge: used to set the drift targets. */
import { makeWorld } from './bot';
import { nearestIdx } from '../src/race/track';
import { createGrid, drive, UNIT_STATS } from '../src/race/car';
import { wrapAngle, clamp } from '../src/engine/util';

/** A drift bot: full throttle, handbrake in corners; scores like race.ts scoreDrift. */
function drift(world: any, seconds: number, hardness: number) {
  const { S, N } = world; const env: any = { world, bump() {}, treeHit() {} };
  const c = createGrid(world, [], 0, UNIT_STATS)[0]; c.ai = false;
  c.idx = (() => { let bi = 0, bd = 1e18; for (let i = 0; i < N; i++) { const d = (S[i].x - c.x) ** 2 + (S[i].y - c.y) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; })();
  const scale = Math.pow(world.track.roadGrip, 1.5);
  let chain = 0, chainT = 0, total = 0, grass = 0, frames = 0;
  for (let f = 0; f < seconds * 60; f++) {
    const sp = Math.hypot(c.vx, c.vy);
    const look = 8 + Math.round(sp * 4);
    const s = S[(c.idx + look) % N];
    const err = wrapAngle(Math.atan2(s.y - c.y, s.x - c.x) - c.a);
    const turning = Math.abs(err) > hardness && sp > 2.2 && !c.grass;
    drive(c, { steer: clamp(err * 3.4, -1, 1), gas: true, brake: false, hand: turning }, 1, env);
    c.idx = nearestIdx(world, c.x, c.y, c.idx);
    const ang = Math.abs(Math.atan2(c.vr, Math.max(0.1, c.vf)));
    if (c.slide && c.vf > 1.3 && ang > 0.18) { if (c.grass) { chain = 0; } else { chain += ang * sp * 1.6 * scale; chainT = 20; } }
    else if (chain > 0 && --chainT <= 0) { if (chain >= 25) total += Math.round(chain); chain = 0; }
    frames++; if (c.grass) grass++;
  }
  return { score: total, grass: grass / frames };
}
for (const id of ['meadow', 'lakeside', 'canyon', 'pine-ridge', 'ice-pass', 'downtown']) {
  const w = makeWorld(id);
  console.log(id.padEnd(10), [0.12, 0.2, 0.3].map((h) => { const r = drift(w, 90, h); return `hand@${h}: ${r.score} pts (${(r.grass * 100).toFixed(0)}% off)`; }).join('   '));
}
