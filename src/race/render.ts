import { drawText, textWidth } from '../engine/pixelfont';
import { TAU, formatTime } from '../engine/util';
import { AIR_PEAK, GHOST_LOOK, ROT, SPRITE, airHeight, getLooks } from './car';
import type { Car } from './car';
import type { Conditions } from './conditions';
import type { GhostPose } from './ghost';
import { WATER } from './surfaces';
import { Weather } from './weather';
import type { World } from './track';

export const SW = 320;
export const SH = 200;
/** Height of the HUD bar along the top. */
const BAR_H = 16;
const BAR_BANDS = ['#55b', '#44a', '#449', '#338', '#338', '#227', '#226', '#115'];

export interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  kind: 'smoke' | 'dirt' | 'leaf' | 'splash' | 'spark';
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
  /** Camera shake in pixels (decays in the race). */
  shake?: number;
  /** Start lights: 0-3 red lamps lit, 4 = green. Undefined when they are not shown. */
  lights?: number;
  /** Frames since a race was finished, for the chequered flag. */
  flag?: number;
  /** The player is going the wrong way round: `ang` is the direction the track runs in (radians, screen space). */
  wrongWay?: { ang: number };
  /** A line of advice at the bottom of the screen. */
  hint?: string;
  /** Replay mode: cinema bars and a label instead of the HUD. `cam` is the camera name index. */
  cinema?: { t: number; cam: number };
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
      const dark = ((Math.floor((u + edge) / 4) + Math.floor(performance.now() / 500)) & 1) === 0;
      ctx.fillStyle = dark ? '#111' : '#fff';
      ctx.fillRect(x, y - 1, 1, 4);
      ctx.fillStyle = dark ? '#fff' : '#111';
      ctx.fillRect(x, y + 1, 1, 1);
    }
  }

  /** One slim bar along the top: clock and race info on the left, speed and drift on the right. */
  /** Boost strips: the stripes run forwards in steps, like a palette cycle. */
  function drawBoosts(ox: number, oy: number) {
    const ph = Math.floor(performance.now() / 70) % 8;
    for (const p of world.boosts) {
      if (p.x - ox < -30 || p.x - ox > SW + 30 || p.y - oy < -30 || p.y - oy > SH + 30) continue;
      const nx = -p.ty;
      const ny = p.tx;
      let last = '';
      for (let u = -14; u <= 14; u += 0.5)
        for (let v = -12; v <= 12; v += 0.5) {
          const k = (((v - ph + Math.abs(u) * 0.5 + 100) % 8) + 8) % 8;
          const c = Math.abs(u) >= 13 || Math.abs(v) >= 11.5 ? '#fd3' : k < 3 ? '#5ef' : k < 4 ? '#27b' : '#124';
          if (c !== last) ctx.fillStyle = last = c;
          ctx.fillRect(Math.round(p.x + nx * u + p.tx * v - ox), Math.round(p.y + ny * u + p.ty * v - oy), 1, 1);
        }
    }
  }

  /** Three lamps in a housing under the bar: red one by one, then green. */
  function drawLights(n: number) {
    const cx = SW / 2;
    const y = BAR_H + 5;
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - 24, y - 3, 48, 17);
    ctx.fillStyle = '#99a';
    ctx.fillRect(cx - 24, y - 3, 48, 1);
    ctx.fillRect(cx - 24, y - 3, 1, 17);
    ctx.fillStyle = '#334';
    ctx.fillRect(cx - 24, y + 13, 48, 1);
    ctx.fillRect(cx + 23, y - 3, 1, 17);
    for (let i = 0; i < 3; i++) {
      const x = cx - 14 + i * 14;
      const on = n >= 4 || i < n;
      const col = !on ? '#401010' : n >= 4 ? '#30ff50' : '#ff3020';
      ctx.fillStyle = col;
      for (const [dy, x0, w] of [[0, 2, 4], [1, 1, 6], [2, 0, 8], [3, 0, 8], [4, 0, 8], [5, 0, 8], [6, 1, 6], [7, 2, 4]])
        ctx.fillRect(x - 4 + x0, y + 2 + dy, w, 1);
      if (on) {
        ctx.fillStyle = n >= 4 ? '#b0ffc0' : '#ff9a88';
        ctx.fillRect(x - 2, y + 4, 2, 2);
      }
    }
  }

  /** A flashing red WRONG WAY sign with an arrow showing which way the track runs. */
  function drawWrongWay(ang: number) {
    const on = Math.floor(performance.now() / 280) % 2 === 0;
    const w = textWidth('WRONG WAY', 2) + 14;
    const x = Math.round((SW - w) / 2);
    const y = BAR_H + 6;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 1, y - 1, w + 2, 20);
    ctx.fillStyle = on ? '#d21' : '#701';
    ctx.fillRect(x, y, w, 18);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + 17, w, 1);
    drawText(ctx, 'WRONG WAY', SW / 2, y + 2, '#fff', { align: 'center', scale: 2, shadow: '#000' });
    const cx = SW / 2;
    const cy = y + 34;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - 14, cy - 14, 28, 28);
    ctx.fillStyle = on ? '#ffd23f' : '#a80';
    for (let t = -9; t <= 6; t++) ctx.fillRect(Math.round(cx + dx * t) - 1, Math.round(cy + dy * t) - 1, 3, 3);
    for (let k = 0; k <= 6; k++)
      for (const side of [-1, 1]) ctx.fillRect(Math.round(cx + dx * (10 - k) - dy * side * k * 0.8) - 1, Math.round(cy + dy * (10 - k) + dx * side * k * 0.8) - 1, 2, 2);
  }

  /** Black bars top and bottom with a blinking REPLAY and the camera in use. */
  function drawCinema(c: { t: number; cam: number }) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SW, 16);
    ctx.fillRect(0, SH - 16, SW, 16);
    ctx.fillStyle = '#335';
    ctx.fillRect(0, 16, SW, 1);
    ctx.fillRect(0, SH - 17, SW, 1);
    if (Math.floor(c.t * 2) % 2 === 0) drawText(ctx, 'REPLAY', 8, 5, '#ff3020', { shadow: '#000' });
    drawText(ctx, ['CHASE CAM', 'TRACKSIDE', 'RIVALS'][c.cam], SW - 8, 5, '#aab0c8', { align: 'right', shadow: '#000' });
    drawText(ctx, 'ARROWS CHANGE CAMERA   ESC BACK', SW / 2, SH - 11, '#aab0c8', { align: 'center', small: true });
  }

  /** Chequered band that sweeps in from the left and then waves. */
  function drawFlag(f: number) {
    const reach = Math.min(SW, f * 8);
    for (let x = 0; x < reach; x += 8)
      for (let row = 0; row < 3; row++) {
        const wave = Math.round(Math.sin(x * 0.05 - f * 0.12) * 3);
        ctx.fillStyle = ((x >> 3) + row) & 1 ? '#fff' : '#111';
        ctx.fillRect(x, 122 + row * 8 + wave, 8, 8);
      }
  }

  function drawHud(v: View) {
    const h = v.hud;
    const at = h.attack;
    const INK = '#ffffff';
    const GOLD = '#ffd23f';
    const GREEN = '#7ee0a0';
    const RED = '#ff6a5a';
    const DIM = '#aab0c8';
    const BAR = BAR_H;
    const now = performance.now();
    const blink = (hz: number) => Math.floor(now / (500 / hz)) % 2 === 0;
    const sh = { shadow: '#000' };
    // raster bar: hard bands of blue, light edge on top and dark below
    BAR_BANDS.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, i * 2, SW, 2);
    });
    ctx.fillStyle = '#aac';
    ctx.fillRect(0, 0, SW, 1);
    ctx.fillStyle = '#001';
    ctx.fillRect(0, BAR - 1, SW, 1);
    // speed gauge as LED segments along the bottom of the bar
    const SEG = 39;
    const lit = Math.round(h.speedFrac * SEG);
    for (let i = 0; i < SEG; i++) {
      const k = i / SEG;
      const on = i < lit;
      const [hi, lo] = k < 0.55 ? ['#7fe89a', '#2fae4c'] : k < 0.8 ? ['#ffe070', '#d8a410'] : ['#ff8070', '#c82a20'];
      const x = 4 + i * 8;
      ctx.fillStyle = on ? hi : '#303860';
      ctx.fillRect(x, BAR - 5, 6, 1);
      ctx.fillStyle = on ? lo : '#1a1c34';
      ctx.fillRect(x, BAR - 4, 6, 2);
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
      items.push([formatTime(h.driftLeft), h.driftLeft < 10 ? (blink(h.driftLeft < 5 ? 4 : 2) ? '#ff3020' : INK) : INK]);
      items.push([h.driftNext != null ? `NEXT ${h.driftNext}` : 'GOLD!', GREEN]);
    } else if (at) {
      items.push([formatTime(at.lapT), at.valid ? INK : '#e4352b']);
      items.push([h.lap < 1 ? 'OUT LAP' : at.valid ? `LAP ${h.lap}` : 'INVALID', at.valid ? GOLD : blink(2) ? '#ff3020' : '#7a1a14']);
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
    if (h.boost) drawText(ctx, 'BOOST', 4, BAR + 3, blink(4) ? '#5ae6ff' : '#ffffff', sh);
    else if (h.draft > 0.25) drawText(ctx, 'DRAFT', 4, BAR + 3, DIM, sh);
    if (h.chain > 0) drawText(ctx, `+${Math.round(h.chain)}`, SW - 78, BAR + 3, '#ff9a3a', { align: 'right', ...sh });
    if (at && at.bestDrift !== null) drawText(ctx, `BEST DRIFT ${at.bestDrift}`, 4, BAR + (h.boost || h.draft > 0.25 ? 13 : 3), GREEN, { small: true, ...sh });
  }

  function draw(v: View) {
    const { cars, player, parts, popup, banner } = v;
    const sk = v.shake ?? 0;
    const ox = Math.round(v.camX - SW / 2) + (sk > 0.5 ? Math.round((Math.random() * 2 - 1) * sk) : 0);
    const oy = Math.round(v.camY - SH / 2) + (sk > 0.5 ? Math.round((Math.random() * 2 - 1) * sk) : 0);
    ctx.drawImage(canvas, ox, oy, SW, SH, 0, 0, SW, SH);
    drawWater(ox, oy);
    drawBoosts(ox, oy);
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
      } else if (q.kind === 'spark') {
        ctx.globalAlpha = 1;
        ctx.fillStyle = a > 0.5 ? '#fff' : '#ffb030';
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
    const drawCar = (c: Car) => {
      const fr = ((Math.round((c.a / TAU) * ROT) % ROT) + ROT) % ROT;
      const L = looks[c.look];
      const x = Math.round(c.x - ox) - SPRITE / 2;
      const y = Math.round(c.y - oy) - SPRITE / 2;
      const h = airHeight(c);
      if (h > 0) {
        // in the air: the car grows a little and lifts off its shadow, which stays on the ground and fades
        const k = 1 + (h / AIR_PEAK) * 0.35;
        const size = Math.round(SPRITE * k);
        ctx.globalAlpha = 0.3 - (h / AIR_PEAK) * 0.12;
        ctx.drawImage(L.shadows[fr], x + 2, y + 2);
        ctx.globalAlpha = 1;
        ctx.drawImage(L.frames[fr], Math.round(c.x - ox - size / 2), Math.round(c.y - oy - size / 2 - h), size, size);
        return;
      }
      ctx.globalAlpha = 0.35;
      ctx.drawImage(L.shadows[fr], x + 2, y + 2);
      ctx.globalAlpha = 1;
      ctx.drawImage(L.frames[fr], x, y);
    };
    // cars on the ground, then the bridges over them, then the cars driving on the bridges
    for (const c of cars) if (!c.z) drawCar(c);
    if (world.deckImg) {
      ctx.drawImage(world.deckImg, ox, oy, SW, SH, 0, 0, SW, SH);
      for (const c of cars) if (c.z) drawCar(c);
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
    if (v.cinema) drawCinema(v.cinema);
    else drawHud(v);
    if (v.lights !== undefined) drawLights(v.lights);
    if (v.flag !== undefined) drawFlag(v.flag);
    if (v.wrongWay) drawWrongWay(v.wrongWay.ang);
    if (v.hint && Math.floor(performance.now() / 350) % 3 !== 0) drawText(ctx, v.hint, SW / 2, SH - 12, '#ffd23f', { align: 'center', shadow: '#000' });
    if (popup) {
      drawText(ctx, popup.n, SW / 2, 24, popup.miss ? '#e4352b' : '#ffd23f', { align: 'center', scale: 3, shadow: '#000' });
      drawText(ctx, popup.l, SW / 2, 47, '#f2f0ea', { align: 'center', shadow: '#000' });
    }
    if (banner) {
      const hot = banner.a.startsWith('NEW BEST') || banner.a === 'VICTORY!';
      drawText(ctx, banner.a, SW / 2, 76, hot && Math.floor(performance.now() / 125) % 2 ? '#7ee0a0' : '#ffd23f', { align: 'center', scale: 3, shadow: '#000' });
      if (banner.b) drawText(ctx, banner.b, SW / 2, 100, '#f2f0ea', { align: 'center', shadow: '#000' });
    }
  }

  return { draw, skid };
}
