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
    drawText(ctx, formatTime(v.raceT), 6, 6, '#ffffff', { scale: 2, shadow: '#000' });
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
