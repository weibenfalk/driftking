import type { Conditions } from '../race/conditions';
import type { Link } from './link';

/** An online duel that is set up: who is connected, on what track, in what weather, and which car looks. */
export interface Session {
  link: Link;
  trackId: string;
  cond: Conditions;
  /** Sprite look of the host's car and of the guest's. */
  looks: [number, number];
}

/** Number of player sprite looks (see `getLooks` in race/car.ts). */
export const PLAYER_LOOKS = 6;
