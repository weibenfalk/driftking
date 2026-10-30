/**
 * Gamepad support. In a race `Input` reads the pad directly (`readPad`); everywhere else `startPadMenu` turns the
 * d-pad, stick and buttons into the same key presses the menus already understand, so no screen needs to know.
 */
import type { Button } from './input';

/** True while a race has its `Input` attached, so the menu translator stays quiet and doesn't double up. */
export const padState = { racing: false };

const DEAD = 0.25;

function firstPad(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

export interface PadReading {
  /** Steering -1..1 (stick, analog) or 0. */
  x: number;
  held: Record<Button, boolean>;
}

/** The pad as a race wants it: left stick or d-pad steers, RT/A gas, LT/B brake, X/RB handbrake, Y puts the car back on the road. */
export function readPad(): PadReading | null {
  const p = firstPad();
  if (!p) return null;
  const b = (i: number) => !!p.buttons[i]?.pressed;
  const ax = p.axes[0] ?? 0;
  const stick = Math.abs(ax) > DEAD ? (ax - Math.sign(ax) * DEAD) / (1 - DEAD) : 0;
  const x = stick || (b(15) ? 1 : 0) - (b(14) ? 1 : 0);
  const held: Record<Button, boolean> = {
    up: b(7) || b(0) || b(12),
    down: b(6) || b(1) || b(13),
    left: x < -0.3,
    right: x > 0.3,
    a: b(2) || b(5) || b(4),
    b: false,
    reset: b(3),
  };
  return { x, held };
}

/** Polls the pad and fires key events for menus. Returns a function that stops it. */
export function startPadMenu(): () => void {
  const prev = { up: false, down: false, left: false, right: false, ok: false, back: false, start: false };
  const nextRepeat: Partial<Record<keyof typeof prev, number>> = {};
  const KEY: Record<keyof typeof prev, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ok: 'Enter', back: 'Escape', start: 'Escape' };
  let raf = 0;
  const fire = (k: keyof typeof prev) => window.dispatchEvent(new KeyboardEvent('keydown', { key: KEY[k], bubbles: true }));
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const p = firstPad();
    if (!p) return;
    const b = (i: number) => !!p.buttons[i]?.pressed;
    const ax = p.axes[0] ?? 0;
    const ay = p.axes[1] ?? 0;
    const cur = {
      up: b(12) || ay < -0.6,
      down: b(13) || ay > 0.6,
      left: b(14) || ax < -0.6,
      right: b(15) || ax > 0.6,
      ok: b(0),
      back: b(1),
      start: b(9),
    };
    for (const k of Object.keys(cur) as (keyof typeof prev)[]) {
      const dir = k === 'up' || k === 'down' || k === 'left' || k === 'right';
      if (cur[k] && !prev[k]) {
        // in a race only Start (leave) is wanted from the pad
        if (!padState.racing || k === 'start') fire(k);
        nextRepeat[k] = now + 380;
      } else if (cur[k] && dir && !padState.racing && now >= (nextRepeat[k] ?? Infinity)) {
        fire(k);
        nextRepeat[k] = now + 110;
      }
      prev[k] = cur[k];
    }
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
