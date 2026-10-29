import { drawText } from '../engine/pixelfont';
import { TAU, formatTime } from '../engine/util';
import { ROT, getLooks } from './car';
import type { Car } from './car';
import type { World } from './track';

export const SW = 320;
export const SH = 200;

export interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  kind: 'smoke' | 'dirt' | 'leaf';
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
}

/** Owns a private copy of the track bitmap (so skid marks can be painted on it) and draws frames. */
export function createRenderer(ctx: CanvasRenderingContext2D, world: World) {
  ctx.imageSmoothingEnabled = false;
  const looks = getLooks();
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

  const panel = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = 'rgba(8,8,20,.55)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(x, y, w, 1);
  };

  function drawHud(v: View) {
    const h = v.hud;
    // top left: race time, lap, position
    panel(2, 2, 64, h.bestLap !== null ? 46 : 38);
    drawText(ctx, formatTime(v.raceT), 6, 5, '#ffffff', { scale: 2, shadow: '#000' });
    drawText(ctx, `LAP ${h.lap}/${h.laps}`, 6, 22, '#ffd23f', { shadow: '#000' });
    drawText(ctx, `POS ${h.pos}/${h.total}`, 6, 30, '#f2f0ea', { shadow: '#000' });
    if (h.bestLap !== null) drawText(ctx, `BEST ${formatTime(h.bestLap)}`, 6, 38, '#7ee0a0', { shadow: '#000' });

    // bottom left: speed and gauge
    panel(2, SH - 30, 78, 28);
    drawText(ctx, String(h.kmh), 6, SH - 27, '#ffffff', { scale: 2, shadow: '#000' });
    drawText(ctx, 'KMH', 40, SH - 22, '#aab0c8', { shadow: '#000' });
    const SEG = 18;
    const lit = Math.round(h.speedFrac * SEG);
    for (let i = 0; i < SEG; i++) {
      ctx.fillStyle = i >= lit ? '#2a2c40' : i < SEG * 0.55 ? '#3cbf5a' : i < SEG * 0.8 ? '#f2c230' : '#e4352b';
      ctx.fillRect(6 + i * 4, SH - 10, 3, 5);
    }

    // bottom right: drift score and the chain being built
    panel(SW - 92, SH - 30, 90, 28);
    drawText(ctx, 'DRIFT', SW - 88, SH - 26, '#aab0c8', { shadow: '#000' });
    drawText(ctx, String(h.drift), SW - 6, SH - 27, '#ffd23f', { scale: 2, align: 'right', shadow: '#000' });
    if (h.chain > 0) drawText(ctx, `+${Math.round(h.chain)}`, SW - 6, SH - 12, '#ff9a3a', { align: 'right', shadow: '#000' });
  }

  function draw(v: View) {
    const { cars, player, parts, popup, banner } = v;
    const ox = Math.round(v.camX - SW / 2);
    const oy = Math.round(v.camY - SH / 2);
    ctx.drawImage(canvas, ox, oy, SW, SH, 0, 0, SW, SH);
    for (const q of parts) {
      const a = q.life / q.max;
      const x = Math.round(q.x - ox);
      const y = Math.round(q.y - oy);
      if (q.kind === 'smoke') {
        const r = a > 0.6 ? 1 : a > 0.3 ? 2 : 3;
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = a > 0.5 ? '#e8e8ee' : '#b8bac6';
        ctx.fillRect(x - (r >> 1), y - (r >> 1), r, r);
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
    for (const c of cars) {
      const fr = ((Math.round((c.a / TAU) * ROT) % ROT) + ROT) % ROT;
      const L = looks[c.look];
      const x = Math.round(c.x - ox) - 9;
      const y = Math.round(c.y - oy) - 9;
      ctx.globalAlpha = 0.35;
      ctx.drawImage(L.shadows[fr], x + 2, y + 2);
      ctx.globalAlpha = 1;
      ctx.drawImage(L.frames[fr], x, y);
    }
    {
      // arrow over the player's car
      const x = Math.round(player.x - ox);
      const y = Math.round(player.y - oy) - 12;
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y + 1, 1, 1);
    }
    ctx.drawImage(world.mini, SW - 74, 4);
    for (const c of cars) {
      ctx.fillStyle = looks[c.look].col;
      const s = c.ai && c !== player ? 2 : 3;
      ctx.fillRect(SW - 74 + (((c.x / world.w) * 66 + 1) | 0), 4 + (((c.y / world.h) * 46 + 1) | 0), s, s);
    }
    drawHud(v);
    if (popup) {
      drawText(ctx, popup.n, SW / 2, 22, popup.miss ? '#e4352b' : '#ffd23f', { align: 'center', scale: 3, shadow: '#000' });
      drawText(ctx, popup.l, SW / 2, 40, '#f2f0ea', { align: 'center', shadow: '#000' });
    }
    if (banner) {
      drawText(ctx, banner.a, SW / 2, 80, '#ffd23f', { align: 'center', scale: 3, shadow: '#000' });
      if (banner.b) drawText(ctx, banner.b, SW / 2, 102, '#f2f0ea', { align: 'center', shadow: '#000' });
    }
  }

  return { draw, skid };
}
