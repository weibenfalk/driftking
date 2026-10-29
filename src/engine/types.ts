import type { Input } from './input';
import type { Audio } from './audio';

/** One line in the HUD, e.g. { label: 'LAP', value: '1/2' }. */
export interface StatusItem {
  label: string;
  value: string | number;
}

/** Everything a race gets from the host. */
export interface GameApi {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  input: Input;
  audio: Audio;
  /** Report the current raw score (call when it changes). */
  setScore(raw: number): void;
  /** Report extra HUD values such as lap or position. */
  setStatus(items: StatusItem[]): void;
  /** The race is over. Pass the final raw score (defaults to the last setScore). */
  end(raw?: number): void;
  /** Run the game loop. `update` gets elapsed seconds and is skipped while paused. */
  loop(update: (sec: number) => void, draw: () => void): void;
  /** addEventListener that is removed automatically when the race ends. */
  listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window,
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void;
  /** Register any extra cleanup (audio nodes, timers). */
  onCleanup(fn: () => void): void;
  /** True while the host has the game paused. */
  isPaused(): boolean;
  /** Seconds the race may last, or null when untimed. */
  timeLimit: number | null;
}

export interface GameInstance {
  /** Called when the time limit runs out. Return the final raw score. */
  timeUp?(): number;
  destroy?(): void;
  /** Read-only look at the race's state, for tools and tests. */
  inspect?(): unknown;
}

export type CreateGame = (api: GameApi) => GameInstance;
