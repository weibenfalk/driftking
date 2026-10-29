import { useEffect, useRef } from 'react';
import Crt from './Crt';
import { H, W } from './kit';

/** What a menu screen provides: how to draw a frame, and how it reacts to input. All coordinates are 320x200 pixels. */
export interface RetroScreen {
  draw(ctx: CanvasRenderingContext2D, t: number): void;
  key?(e: KeyboardEvent): void;
  hover?(x: number, y: number): void;
  click?(x: number, y: number): void;
  /** Mouse button pressed (0 left, 2 right) and released, for dragging. */
  down?(x: number, y: number, button: number): void;
  up?(): void;
  wheel?(dy: number): void;
}

const KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'Tab', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D']);

/**
 * Hosts a menu screen on a 320x200 canvas scaled up with crisp pixels, like the game. The screen object may change on
 * every render (it closes over React state); the loop always uses the latest.
 */
export default function Retro({ screen }: { screen: RetroScreen }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cur = useRef(screen);
  cur.current = screen;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      cur.current.draw(ctx, (now - start) / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const pos = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (KEYS.has(e.key)) e.preventDefault();
      cur.current.key?.(e);
    };
    const onMove = (e: MouseEvent) => {
      const p = pos(e);
      cur.current.hover?.(p.x, p.y);
    };
    const onClick = (e: MouseEvent) => {
      const p = pos(e);
      cur.current.click?.(p.x, p.y);
    };
    const onWheel = (e: WheelEvent) => cur.current.wheel?.(Math.sign(e.deltaY));
    const onDown = (e: MouseEvent) => {
      const p = pos(e);
      cur.current.down?.(p.x, p.y, e.button);
    };
    const onUp = () => cur.current.up?.();
    const onMenu = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('contextmenu', onMenu);
    window.addEventListener('mouseup', onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('contextmenu', onMenu);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <Crt>
      <canvas ref={ref} width={W} height={H} />
    </Crt>
  );
}
