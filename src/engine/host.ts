import { Input } from './input';
import { audio } from './audio';
import type { CreateGame, GameApi, GameInstance, StatusItem } from './types';

export interface RaceHandle {
  /** Stop the race and release everything. */
  stop(): void;
  setPaused(paused: boolean): void;
  /** Latest values reported by the race. */
  state(): { score: number; status: StatusItem[] };
}

/**
 * Minimal replacement for Pixelpenta's GameHost: gives a race a canvas, input and audio,
 * runs its loop and tears everything down. No countdown, pause menu or points here.
 */
export function startRace(
  canvas: HTMLCanvasElement,
  createGame: CreateGame,
  onEnd: (raw: number) => void,
): RaceHandle {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  const input = new Input();
  input.attach();
  audio.unlock();

  let paused = false;
  let disposed = false;
  let ended = false;
  let score = 0;
  let status: StatusItem[] = [];
  let instance: GameInstance | null = null;
  const cleanups: (() => void)[] = [];

  const stop = () => {
    if (disposed) return;
    disposed = true;
    try {
      instance?.destroy?.();
    } catch (e) {
      console.error(e);
    }
    cleanups.splice(0).forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
    input.detach();
  };

  const finish = (raw?: number) => {
    if (ended) return;
    ended = true;
    const final = raw ?? score;
    stop();
    onEnd(final);
  };

  const api: GameApi = {
    canvas,
    ctx,
    input,
    audio,
    setScore: (raw) => {
      score = raw;
    },
    setStatus: (items) => {
      status = items;
    },
    end: (raw) => {
      if (ended) return;
      paused = true;
      const id = window.setTimeout(() => finish(raw), 250);
      cleanups.push(() => window.clearTimeout(id));
    },
    loop: (update, draw) => {
      let last = performance.now();
      let raf = 0;
      const frame = (now: number) => {
        const sec = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!paused && !disposed) {
          try {
            update(sec);
          } catch (e) {
            console.error(e);
          }
        }
        if (!disposed) {
          try {
            draw();
          } catch (e) {
            console.error(e);
          }
          raf = requestAnimationFrame(frame);
        }
      };
      raf = requestAnimationFrame(frame);
      cleanups.push(() => cancelAnimationFrame(raf));
    },
    listen: (target, type, handler, opts) => {
      const h = handler as EventListener;
      target.addEventListener(type, h, opts);
      cleanups.push(() => target.removeEventListener(type, h, opts));
    },
    onCleanup: (fn) => cleanups.push(fn),
    isPaused: () => paused,
    timeLimit: null,
  };

  instance = createGame(api);

  return {
    stop,
    setPaused: (p) => {
      paused = p;
    },
    state: () => ({ score, status }),
  };
}
