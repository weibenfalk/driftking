export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Draw a string-art sprite: rows of palette keys, '.' is transparent. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  palette: Record<string, string | null | undefined>,
  x: number,
  y: number,
  flip = false,
  override?: string | null,
): void {
  const h = rows.length;
  const w = rows[0].length;
  const ox = Math.round(x - w / 2);
  const oy = Math.round(y - h / 2);
  for (let r = 0; r < h; r++) {
    const row = rows[r];
    for (let c = 0; c < w; c++) {
      const ch = row[flip ? w - 1 - c : c];
      if (!ch || ch === '.') continue;
      const col = override || palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(ox + c, oy + r, 1, 1);
    }
  }
}

/** Formats seconds as m:ss.cc */
export const formatTime = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const r = sec - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, '0')}`;
};
