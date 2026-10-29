import type { Medal } from './save';

export type Mode = 'race' | 'attack' | 'drift';

/** Prize money by finishing place (1st..8th). Only races have places. */
export const PLACE_PAY = [400, 280, 200, 150, 110, 80, 50, 30];
/** Total medal bonus by medal in each mode; a run pays the difference when it improves the track's medal there. */
export const MEDAL_PAY: Record<Mode, number[]> = {
  race: [0, 100, 250, 500],
  attack: [0, 80, 200, 400],
  drift: [0, 120, 300, 600],
};
/** Replaying a race track you already have a result on pays this share of the place prize. */
export const REPEAT_SHARE = 0.4;
/** One money per this many drift points in a race. */
export const DRIFT_PER_MONEY = 20;

export interface Payout {
  place: number;
  medal: number;
  drift: number;
  total: number;
}

/** Scales every part of a payout (difficulty changes prize money). */
export function scalePayout(p: Payout, k: number): Payout {
  const place = Math.round(p.place * k);
  const medal = Math.round(p.medal * k);
  const drift = Math.round(p.drift * k);
  return { place, medal, drift, total: place + medal + drift };
}

/** Medal bonus for a run: only the step up from the best medal so far is paid. */
export function medalPay(mode: Mode, before: Medal, after: Medal) {
  return Math.max(0, MEDAL_PAY[mode][after] - MEDAL_PAY[mode][before]);
}

/**
 * Money for a finished race. The medal bonus is only paid when it beats the track's earlier medal, and repeat
 * runs pay a reduced place prize, so grinding one easy track is slow.
 */
export function payout(o: { place: number; drift: number; medalBefore: Medal; medalAfter: Medal; repeat: boolean }): Payout {
  const prize = PLACE_PAY[o.place - 1] ?? 0;
  const place = Math.round(o.repeat ? prize * REPEAT_SHARE : prize);
  const medal = medalPay('race', o.medalBefore, o.medalAfter);
  const drift = Math.floor(o.drift / DRIFT_PER_MONEY);
  return { place, medal, drift, total: place + medal + drift };
}

/**
 * What is still on offer on a track in a mode (best case: a win in a race, gold everywhere), so lists can show
 * "up to $X". Race drift money is not counted since it depends on how you drive.
 */
export function potential(mode: Mode, bestMedal: Medal, hasResult: boolean) {
  const left = MEDAL_PAY[mode][3] - MEDAL_PAY[mode][bestMedal];
  return mode === 'race' ? Math.round(PLACE_PAY[0] * (hasResult ? REPEAT_SHARE : 1)) + left : left;
}
