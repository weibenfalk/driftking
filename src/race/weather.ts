import type { Car } from './car';
import type { Conditions } from './conditions';
import type { World } from './track';

const SW = 320;
const SH = 200;

interface Drop {
  x: number;
  y: number;
  speed: number;
  phase: number;
}

/**
 * Weather and light drawn over the finished frame (before the HUD): falling rain or snow, a warm tint at dusk, and at
 * night a dark mask with banded headlight cones punched out of it. Purely visual; nothing here affects driving.
 */
export class Weather {
  private drops: Drop[] = [];
  private last = performance.now();
  private readonly dark: HTMLCanvasElement;
  private readonly dctx: CanvasRenderingContext2D;
  private kind: Conditions['weather'] | null = null;

  constructor() {
    this.dark = document.createElement('canvas');
    this.dark.width = SW;
    this.dark.height = SH;
    this.dctx = this.dark.getContext('2d')!;
  }

  private reset(kind: Conditions['weather']) {
    this.kind = kind;
    const n = kind === 'rain' ? 110 : kind === 'snow' ? 130 : 0;
    this.drops = Array.from({ length: n }, (_, i) => {
      const h = Math.imul(i + 7, 2654435761) >>> 0;
      return { x: h % SW, y: (h >>> 10) % SH, speed: kind === 'rain' ? 190 + (h % 60) : 24 + (h % 20), phase: (h >>> 20) % 100 };
    });
  }

  private precipitation(ctx: CanvasRenderingContext2D, kind: Conditions['weather'], now: number) {
    if (kind !== this.kind) this.reset(kind);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (kind === 'rain') {
      ctx.fillStyle = '#9bf';
      for (const d of this.drops) {
        d.y += d.speed * dt;
        d.x -= 40 * dt;
        if (d.y > SH) {
          d.y -= SH + 8;
          d.x = (d.x + 97) % SW;
        }
        if (d.x < 0) d.x += SW;
        const x = Math.floor(d.x);
        const y = Math.floor(d.y);
        ctx.fillRect(x, y, 1, 2);
        ctx.fillRect(x - 1, y + 2, 1, 2); // slanted streak
      }
    } else if (kind === 'snow') {
      ctx.fillStyle = '#fff';
      for (const d of this.drops) {
        d.y += d.speed * dt;
        if (d.y > SH) d.y -= SH + 4;
        const x = Math.floor(d.x + Math.sin(now / 700 + d.phase) * 4);
        const big = d.phase % 3 === 0;
        ctx.fillRect(((x % SW) + SW) % SW, Math.floor(d.y), big ? 2 : 1, big ? 2 : 1);
      }
    }
  }

  /** Headlight cones for every car on screen, three nested bands each, plus a glow round boost strips. */
  private night(ctx: CanvasRenderingContext2D, cars: Car[], world: World, ox: number, oy: number) {
    const g = this.dctx;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, SW, SH);
    g.fillStyle = 'rgba(0,0,34,.8)';
    g.fillRect(0, 0, SW, SH);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,.4)';
    for (const c of cars) {
      const x = c.x - ox;
      const y = c.y - oy;
      if (x < -90 || x > SW + 90 || y < -90 || y > SH + 90) continue;
      const nx = x + Math.cos(c.a) * 8;
      const ny = y + Math.sin(c.a) * 8;
      for (const [len, half] of [[76, 0.46], [54, 0.36], [34, 0.26]]) {
        g.beginPath();
        g.moveTo(nx, ny);
        g.arc(nx, ny, len, c.a - half, c.a + half);
        g.closePath();
        g.fill();
      }
      for (const r of [14, 10]) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (const b of world.boosts) {
      const x = b.x - ox;
      const y = b.y - oy;
      if (x < -30 || x > SW + 30 || y < -30 || y > SH + 30) continue;
      for (const r of [26, 20, 14]) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    ctx.drawImage(this.dark, 0, 0);
  }

  draw(ctx: CanvasRenderingContext2D, cond: Conditions, cars: Car[], world: World, ox: number, oy: number) {
    const now = performance.now();
    if (cond.weather === 'rain') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#bbc';
      ctx.fillRect(0, 0, SW, SH);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (cond.time === 'dusk') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#fb9';
      ctx.fillRect(0, 0, SW, SH);
      ctx.globalCompositeOperation = 'source-over';
    } else if (cond.time === 'night') {
      this.night(ctx, cars, world, ox, oy);
    }
    if (cond.weather !== 'clear') this.precipitation(ctx, cond.weather, now);
    else this.kind = null;
  }
}
