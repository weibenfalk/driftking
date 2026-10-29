import { drawText, textWidth } from '../engine/pixelfont';

/*
 * Drawing kit for the menus: everything is painted on the same 320x200 canvas, with the same 3x5 pixel font, as the
 * game, in a 12-bit palette with Workbench-style bevelled boxes, raster bars and a starfield.
 */

export const W = 320;
export const H = 200;

export const C = {
  ink: '#fff',
  dim: '#88a',
  gold: '#fd3',
  orange: '#f80',
  red: '#e32',
  green: '#4d6',
  cyan: '#5ef',
  black: '#000',
  navy0: '#001',
  navy1: '#113',
  navy2: '#226',
  navy3: '#44a',
  navy4: '#88d',
  bronze: '#c83',
  silver: '#bcd',
};

export interface TextOpts {
  scale?: number;
  align?: 'left' | 'center' | 'right';
  shadow?: string | null;
}

/** Text with the usual hard black drop shadow. */
export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string = C.ink, o: TextOpts = {}) {
  drawText(ctx, s, x, y, color, { scale: o.scale, align: o.align, shadow: o.shadow === null ? undefined : (o.shadow ?? '#000') });
}

export { textWidth };

/** Workbench-style box: light edge top-left, dark edge bottom-right (swapped when sunken). */
export function bevel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string = C.navy2, sunken = false) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = sunken ? C.navy0 : C.navy4;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = sunken ? C.navy4 : C.navy0;
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
}

/** A push button; `on` is the highlighted (selected) state. */
export function button(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, w: number, h: number, on: boolean, disabled = false) {
  bevel(ctx, x, y, w, h, on ? C.orange : C.navy2, on);
  const color = disabled ? C.navy3 : on ? C.black : C.ink;
  text(ctx, label, x + w / 2, y + Math.floor((h - 5) / 2), color, { align: 'center', shadow: on || disabled ? null : '#000' });
}

/** Horizontal bands, e.g. a copper bar: `colors` are stacked top to bottom, each `bandH` tall. */
export function bars(ctx: CanvasRenderingContext2D, y: number, colors: string[], bandH = 1, x = 0, w = W) {
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y + i * bandH, w, bandH);
  });
}

const SKY = ['#001', '#001', '#002', '#002', '#012', '#012', '#013', '#023'];

/** Dark blue gradient background in bands, like an Amiga copper list. */
export function copperBackground(ctx: CanvasRenderingContext2D) {
  const band = Math.ceil(H / SKY.length);
  SKY.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, i * band, W, band);
  });
}

const STARS = Array.from({ length: 70 }, (_, i) => {
  const h = Math.imul(i + 1, 2654435761) >>> 0;
  return { x: h % W, y: (h >>> 9) % H, speed: 4 + ((h >>> 17) % 24) };
});

/** Slow parallax starfield, stars drifting left at different speeds. */
export function stars(ctx: CanvasRenderingContext2D, t: number) {
  for (const s of STARS) {
    const x = (((s.x - t * s.speed) % W) + W) % W;
    ctx.fillStyle = s.speed > 20 ? '#fff' : s.speed > 12 ? '#99b' : '#556';
    ctx.fillRect(Math.floor(x), s.y, 1, 1);
  }
}

/** Sine-moving raster bars, the classic demo effect. */
export function rasterBars(ctx: CanvasRenderingContext2D, t: number, y0: number, amp: number) {
  const GRAD = ['#400', '#a20', '#f60', '#fa0', '#ff8', '#fa0', '#f60', '#a20', '#400'];
  for (let k = 0; k < 3; k++) {
    const y = Math.round(y0 + Math.sin(t * 1.3 + k * 1.1) * amp);
    ctx.globalAlpha = 0.55;
    bars(ctx, y, GRAD, 1);
    ctx.globalAlpha = 1;
  }
}

const logoCache = new Map<string, HTMLCanvasElement>();

/** Big title text filled with a vertical colour gradient and a hard drop shadow. */
export function logo(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, scale: number) {
  const key = `${s}|${scale}`;
  let c = logoCache.get(key);
  if (!c) {
    const w = textWidth(s, scale) + scale * 2;
    const h = 5 * scale + scale * 2;
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    drawText(g, s, 0, 0, '#fff', { scale });
    // colour the letters: paint the gradient on its own canvas, then keep it only where the text is
    // (source-in clears everything outside the shape, so it must be done in one go)
    const gc = document.createElement('canvas');
    gc.width = w;
    gc.height = h;
    const gg = gc.getContext('2d')!;
    const GRAD = ['#fff', '#ff8', '#fd3', '#fb0', '#f80', '#e50', '#c30'];
    const rowH = (5 * scale) / GRAD.length;
    GRAD.forEach((col, i) => {
      gg.fillStyle = col;
      gg.fillRect(0, Math.floor(i * rowH), w, Math.ceil(rowH) + 1);
    });
    g.globalCompositeOperation = 'source-in';
    g.drawImage(gc, 0, 0);
    logoCache.set(key, c);
  }
  const x = Math.round(cx - textWidth(s, scale) / 2);
  const sh = document.createElement('canvas');
  sh.width = c.width;
  sh.height = c.height;
  const sg = sh.getContext('2d')!;
  sg.drawImage(c, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = '#400';
  sg.fillRect(0, 0, sh.width, sh.height);
  ctx.drawImage(sh, x + scale, y + scale);
  ctx.drawImage(c, x, y);
}

/** Small filled medal disc: 0 none (hollow), 1 bronze, 2 silver, 3 gold. */
export function medalChip(ctx: CanvasRenderingContext2D, medal: number, x: number, y: number) {
  const cols = [C.navy3, C.bronze, C.silver, C.gold];
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y + 1, 7, 5);
  ctx.fillRect(x + 1, y, 5, 7);
  ctx.fillStyle = cols[medal];
  ctx.fillRect(x + 1, y + 2, 5, 3);
  ctx.fillRect(x + 2, y + 1, 3, 5);
  if (medal > 0) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 2, y + 2, 1, 1);
  }
}

/** Screen title bar: a copper strip with the title and a back hint. */
export function header(ctx: CanvasRenderingContext2D, title: string, right = 'ESC BACK') {
  bars(ctx, 0, ['#a20', '#e40', '#f80', '#fb0', '#f80', '#e40', '#a20', '#600'], 3);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 24, W, 1);
  text(ctx, title, 8, 7, C.ink, { scale: 2, shadow: '#400' });
  text(ctx, right, W - 6, 10, '#ffd', { align: 'right', shadow: '#400' });
}
