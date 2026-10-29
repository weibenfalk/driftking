import { drawText, textWidth } from '../engine/pixelfont';
import { TAU, formatTime } from '../engine/util';
import { GHOST_LOOK, ROT, SPRITE, getLooks } from './car';
import type { Car } from './car';
import type { Conditions } from './conditions';
import type { GhostPose } from './ghost';
import { WATER } from './surfaces';
import { Weather } from './weather';
import type { World } from './track';

export const SW = 320;
export const SH = 200;
/** Height of the HUD bar along the top. */
const BAR_H = 14;

export interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  kind: 'smoke' | 'dirt' | 'leaf' | 'splash';
}
export interface Popup {
  n: string;
  l: string;
  t: number;
  miss?: boolean;
}
export interface Banner {
  a: string;
  b: string;
  t: number;
}

/** Numbers the HUD shows. */
export interface Hud {
  lap: number;
  laps: number;
  pos: number;
  total: number;
  kmh: number;
  /** 0..1 of the top speed, for the gauge. */
  speedFrac: number;
  drift: number;
  chain: number;
  bestLap: number | null;
  /** Slipstream strength 0..1 and whether a boost is running. */
  draft: number;
  boost: boolean;
  /** Seconds left in a drift challenge. */
  driftLeft?: number;
  /** Next medal score to reach in a drift challenge, or null once gold is passed. */
  driftNext?: number | null;
  /** Present in time attack: lap clock, gap to the ghost (s, + is slower), and per-lap drift. */
  attack?: { lapT: number; delta: number | null; valid: boolean; lapDrift: number; bestDrift: number | null };
}

/** Everything a frame needs from the race. */
export interface View {
  cars: Car[];
  player: Car;
  parts: Part[];
  camX: number;
  camY: number;
  raceT: number;
  popup: Popup | null;
  banner: Banner | null;
  hud: Hud;
  /** Weather and time of day. */
  cond: Conditions;
  /** Where the ghost car is this frame (time attack). */
  ghost?: GhostPose | null;
}

/** Owns a private copy of the track bitmap (so skid marks can be painted on it) and draws frames. */
export function createRenderer(ctx: CanvasRenderingContext2D, world: World) {
  ctx.imageSmoothingEnabled = false;
  const looks = getLooks();
  const weather = new Weather();
  const canvas = document.createElement('canvas');
  canvas.width = world.w;
  canvas.height = world.h;
  const wctx = canvas.getContext('2d')!;
  wctx.putImageData(world.base, 0, 0);

  /** Leave a one-pixel tyre mark on the ground. */
  function skid(x: number, y: number) {
    wctx.fillStyle = 'rgba(30,30,36,.45)';
    wctx.fillRect(x | 0, y | 0, 1, 1);
  }

  /** Lake sparkle: a few glints that drift across the water in steps, like Amiga palette cycling. */
  function drawWater(ox: number, oy: number) {
    const wb = world.water;
    if (!wb || ox > wb.x1 || ox + SW < wb.x0 || oy > wb.y1 || oy + SH < wb.y0) return;
    const phase = Math.floor(performance.now() / 260);
    const g = world.track.theme.water.glint;
    ctx.fillStyle = `rgb(${g[0]},${g[1]},${g[2]})`;
    for (let y = Math.max(wb.y0, oy); y < Math.min(wb.y1, oy + SH); y++)
      for (let x = Math.max(wb.x0, ox); x < Math.min(wb.x1, ox + SW); x++) {
        if (world.surf[y * world.w + x] !== WATER) continue;
        const wave = Math.sin(x * 0.33 + y * 0.21 + phase * 1.1) + Math.sin(y * 0.47 - x * 0.12 - phase * 0.8);
        if (wave > 1.7) ctx.fillRect(x - ox, y - oy, 2, 1);
      }
  }

  /** The start gantry's bar, held above the road so cars drive under it. */
  function drawGantry(ox: number, oy: number) {
    const s0 = world.S[0];
    const edge = world.track.halfWidth + 9;
    const lift = 11;
    if (Math.hypot(s0.x - ox - SW / 2, s0.y - oy - SH / 2) > SW) return;
    for (const side of [-1, 1]) {
      const px = Math.round(s0.x + s0.nx * side * edge - ox);
      const py = Math.round(s0.y + s0.ny * side * edge - oy);
      ctx.fillStyle = '#334';
      ctx.fillRect(px - 1, py - lift, 3, lift);
      ctx.fillStyle = '#99a';
      ctx.fillRect(px - 1, py - lift, 1, lift);
    }
    for (let u = -edge; u <= edge; u++) {
      const x = Math.round(s0.x + s0.nx * u - ox);
      const y = Math.round(s0.y + s0.ny * u - oy) - lift;
      const dark = (Math.floor((u + edge) / 4) & 1) === 0;
      ctx.fillStyle = dark ? '#111' : '#fff';
      ctx.fillRect(x, y - 1, 1, 4);
      ctx.fillStyle = dark ? '#fff' : '#111';
      ctx.fillRect(x, y + 1, 1, 1);
    }
  }

  /** One slim bar along the top: clock and race info on the left, speed and drift on the right. */
  function drawHud(v: View) {
    const h = v.hud;
    const at = h.attack;
    const INK = '#ffffff';
    const GOLD = '#ffd23f';
    const GREEN = '#7ee0a0';
    const RED = '#ff6a5a';
    const DIM = '#aab0c8';
    const BAR = BAR_H;
    const sh = { shadow: '#000' };
    ctx.fillStyle = 'rgba(17,17,51,.85)';
    ctx.fillRect(0, 0, SW, BAR);
    ctx.fillStyle = '#aab';
    ctx.fillRect(0, 0, SW, 1);
    ctx.fillStyle = '#113';
    ctx.fillRect(0, BAR - 1, SW, 1);
    // speed gauge as a thin strip under the text, running along the whole bar
    const SEG = 40;
    const lit = Math.round(h.speedFrac * SEG);
    for (let i = 0; i < SEG; i++) {
      ctx.fillStyle = i >= lit ? '#2a2c40' : i < SEG * 0.55 ? '#3cbf5a' : i < SEG * 0.8 ? '#f2c230' : '#e4352b';
      ctx.fillRect(2 + i * 7.75, BAR - 3, 6, 2);
    }

    // right side first, so the left side knows how much room it has
    const ty = 3;
    const drift = String(at ? at.lapDrift : h.drift);
    let rx = SW - 4;
    drawText(ctx, drift, rx, ty, GOLD, { align: 'right', ...sh });
    rx -= textWidth(drift) + 3;
    drawText(ctx, at ? 'LAP DRIFT' : h.driftLeft !== undefined ? 'SCORE' : 'DRIFT', rx, ty + 2, DIM, { align: 'right', small: true, ...sh });
    rx -= textWidth(at ? 'LAP DRIFT' : h.driftLeft !== undefined ? 'SCORE' : 'DRIFT', 1, true) + 10;
    drawText(ctx, 'KMH', rx, ty + 2, DIM, { align: 'right', small: true, ...sh });
    rx -= textWidth('KMH', 1, true) + 3;
    drawText(ctx, String(h.kmh), rx, ty, INK, { align: 'right', ...sh });
    rx -= textWidth(String(h.kmh)) + 10;

    // left side, most important first; anything that would run into the right side is left out
    const items: [string, string][] = [];
    if (h.driftLeft !== undefined) {
      items.push([formatTime(h.driftLeft), h.driftLeft < 10 ? '#e4352b' : INK]);
      items.push([h.driftNext != null ? `NEXT ${h.driftNext}` : 'GOLD!', GREEN]);
    } else if (at) {
      items.push([formatTime(at.lapT), at.valid ? INK : '#e4352b']);
      items.push([h.lap < 1 ? 'OUT LAP' : at.valid ? `LAP ${h.lap}` : 'INVALID', at.valid ? GOLD : '#e4352b']);
      if (at.delta !== null) items.push([`${at.delta > 0 ? '+' : '-'}${Math.abs(at.delta).toFixed(2)}`, at.delta > 0 ? RED : GREEN]);
      if (h.bestLap !== null) items.push([`BEST ${formatTime(h.bestLap)}`, GREEN]);
    } else {
      items.push([formatTime(v.raceT), INK]);
      items.push([`LAP ${h.lap}/${h.laps}`, GOLD]);
      items.push([`POS ${h.pos}/${h.total}`, '#f2f0ea']);
      if (h.bestLap !== null) items.push([`BEST ${formatTime(h.bestLap)}`, GREEN]);
    }
    let lx = 4;
    for (const [text, color] of items) {
      const w = textWidth(text);
      if (lx + w > rx) continue;
      drawText(ctx, text, lx, ty, color, sh);
      lx += w + 9;
    }

    // loose notes under the bar
    if (h.boost) drawText(ctx, 'BOOST', 4, BAR + 3, '#5ae6ff', sh);
    else if (h.draft > 0.25) drawText(ctx, 'DRAFT', 4, BAR + 3, DIM, sh);
    if (h.chain > 0) drawText(ctx, `+${Math.round(h.chain)}`, SW - 78, BAR + 3, '#ff9a3a', { align: 'right', ...sh });
    if (at && at.bestDrift !== null) drawText(ctx, `BEST DRIFT ${at.bestDrift}`, 4, BAR + (h.boost || h.draft > 0.25 ? 13 : 3), GREEN, { small: true, ...sh });
  }

  function draw(v: View) {
    const { cars, player, parts, popup, banner } = v;
    const ox = Math.round(v.camX - SW / 2);
    const oy = Math.round(v.camY - SH / 2);
    ctx.drawImage(canvas, ox, oy, SW, SH, 0, 0, SW, SH);
    drawWater(ox, oy);
    for (const q of parts) {
      const a = q.life / q.max;
      const x = Math.round(q.x - ox);
      const y = Math.round(q.y - oy);
      if (q.kind === 'smoke') {
        const r = a > 0.6 ? 1 : a > 0.3 ? 2 : 3;
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = a > 0.5 ? '#e8e8ee' : '#b8bac6';
        ctx.fillRect(x - (r >> 1), y - (r >> 1), r, r);
      } else if (q.kind === 'splash') {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#b8dcf4';
        ctx.fillRect(x, y, 1, 1);
      } else if (q.kind === 'dirt') {
        ctx.globalAlpha = 1;
        ctx.fillStyle = Math.random() < 0.5 ? '#6b4a2a' : '#4a8a34';
        ctx.fillRect(x, y, 1, 1);
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#2e7a30';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    if (v.ghost) {
      const g = v.ghost;
      const fr = ((Math.round((g.a / TAU) * ROT) % ROT) + ROT) % ROT;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(looks[GHOST_LOOK].frames[fr], Math.round(g.x - ox) - SPRITE / 2, Math.round(g.y - oy) - SPRITE / 2);
      ctx.globalAlpha = 1;
    }
    for (const c of cars) {
      const fr = ((Math.round((c.a / TAU) * ROT) % ROT) + ROT) % ROT;
      const L = looks[c.look];
      const x = Math.round(c.x - ox) - SPRITE / 2;
      const y = Math.round(c.y - oy) - SPRITE / 2;
      ctx.globalAlpha = 0.35;
      ctx.drawImage(L.shadows[fr], x + 2, y + 2);
      ctx.globalAlpha = 1;
      ctx.drawImage(L.frames[fr], x, y);
    }
    drawGantry(ox, oy);
    weather.draw(ctx, v.cond, cars, world, ox, oy);
    {
      // arrow over the player's car
      const x = Math.round(player.x - ox);
      const y = Math.round(player.y - oy) - 12;
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y + 1, 1, 1);
    }
    ctx.drawImage(world.mini, SW - 74, BAR_H + 3);
    for (const c of cars) {
      ctx.fillStyle = looks[c.look].col;
      const s = c.ai && c !== player ? 2 : 3;
      ctx.fillRect(SW - 74 + (((c.x / world.w) * 66 + 1) | 0), BAR_H + 3 + (((c.y / world.h) * 46 + 1) | 0), s, s);
    }
    drawHud(v);
    if (popup) {
      drawText(ctx, popup.n, SW / 2, 24, popup.miss ? '#e4352b' : '#ffd23f', { align: 'center', scale: 3, shadow: '#000' });
      drawText(ctx, popup.l, SW / 2, 47, '#f2f0ea', { align: 'center', shadow: '#000' });
    }
    if (banner) {
      drawText(ctx, banner.a, SW / 2, 76, '#ffd23f', { align: 'center', scale: 3, shadow: '#000' });
      if (banner.b) drawText(ctx, banner.b, SW / 2, 100, '#f2f0ea', { align: 'center', shadow: '#000' });
    }
  }

  return { draw, skid };
}
