/*
 * Compares the medal targets with what the test bot can do on every career track: for each bronze/silver/gold m
 * (corner-speed multiplier, 1.2/1.4/1.55 as in career.ts) it prints the bot's lap against the lap target.
 *   npx esbuild tools/medalcheck.ts --bundle --platform=node --outfile=/tmp/mc.cjs && node /tmp/mc.cjs
 */
import { CUPS, lapTargets } from '../src/game/career';
import { makeWorld, runBot } from './bot';

for (const cup of CUPS)
  for (const id of cup.trackIds) {
    const w = makeWorld(id);
    const t = lapTargets(w.track);
    const row = ([['B', 1.2, t.bronze], ['S', 1.4, t.silver], ['G', 1.55, t.gold]] as const).map(([n, m, tg]) => {
      const r = runBot(w, m, 2);
      return `${n} bot ${r.avgLap.toFixed(1)} vs ${(tg / 100).toFixed(1)} (${((r.avgLap / (tg / 100)) * 100).toFixed(0)}%) g${(r.grass * 100).toFixed(0)}%`;
    });
    console.log(id.padEnd(11), row.join(' | '));
  }
