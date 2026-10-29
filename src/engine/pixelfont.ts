/**
 * 3×5 pixel font for drawing text inside game canvases at native resolution.
 * Covers A–Z, ÅÄÖ, digits and common punctuation. Text is upper-cased.
 */
const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  Å: '010010101111101', Ä: '101010101111101', Ö: '101010101101010', É: '001010111100111',
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
  '8': '111101111101111', '9': '111101111001111',
  '!': '010010010000010', '?': '110001010000010', ':': '000010000010000', '.': '000000000000010',
  ',': '000000000010100', '-': '000000111000000', '+': '000010111010000', '/': '001001010100100',
  '%': '101001010100101', "'": '010010000000000', '(': '010100100100010', ')': '010001001001010',
  '=': '000111000111000', '$': '011110010011110', '#': '101111101111101', '^': '010101000000000', '×': '000101010101000', '<': '001010100010001', '>': '100010001010100',
  ' ': '000000000000000',
};

export interface TextOpts {
  scale?: number;
  align?: 'left' | 'center' | 'right';
  shadow?: string;
}

export function textWidth(text: string, scale = 1): number {
  return text.length ? (text.length * 4 - 1) * scale : 0;
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  opts: TextOpts = {},
): void {
  const s = opts.scale ?? 1;
  const str = text.toUpperCase();
  let px = Math.round(x);
  const w = textWidth(str, s);
  if (opts.align === 'center') px = Math.round(x - w / 2);
  else if (opts.align === 'right') px = Math.round(x - w);
  const py = Math.round(y);
  if (opts.shadow) paint(ctx, str, px + s, py + s, opts.shadow, s);
  paint(ctx, str, px, py, color, s);
}

function paint(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, color: string, s: number) {
  ctx.fillStyle = color;
  for (const ch of str) {
    const g = GLYPHS[ch];
    if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(x + (i % 3) * s, y + Math.floor(i / 3) * s, s, s);
    x += 4 * s;
  }
}
