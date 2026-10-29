import type { CarStats } from '../race/car';

export interface CarModel {
  id: string;
  name: string;
  price: number;
  /** Index into the sprite sets in race/car.ts. */
  look: number;
  blurb: string;
  /** Baseline multipliers before upgrades (brakes only come from upgrades). */
  stats: Omit<CarStats, 'brake'>;
}

export const CAR_MODELS: CarModel[] = [
  { id: 'rookie', name: 'ROOKIE', price: 0, look: 0, blurb: 'HONEST ALL-ROUNDER', stats: { grip: 1, accel: 1, top: 1, drift: 1 } },
  { id: 'sprinter', name: 'SPRINTER', price: 1200, look: 1, blurb: 'QUICK OFF THE LINE', stats: { grip: 0.95, accel: 1.15, top: 1, drift: 1 } },
  { id: 'gripper', name: 'GRIPPER', price: 2000, look: 2, blurb: 'STICKS TO THE ROAD', stats: { grip: 1.15, accel: 1, top: 0.98, drift: 0.85 } },
  { id: 'drifter', name: 'DRIFTER', price: 2400, look: 3, blurb: 'LOOSE AND LOVES IT', stats: { grip: 0.9, accel: 1.05, top: 1, drift: 1.3 } },
  { id: 'rocket', name: 'ROCKET', price: 4000, look: 4, blurb: 'ALL ABOUT TOP SPEED', stats: { grip: 0.92, accel: 1.1, top: 1.1, drift: 0.95 } },
  { id: 'king', name: 'KING', price: 7000, look: 5, blurb: 'THE BEST OF EVERYTHING', stats: { grip: 1.08, accel: 1.1, top: 1.08, drift: 1.1 } },
];

export const STARTER_CAR = 'rookie';

export type UpgradeKind = 'tires' | 'engine' | 'brakes';
export const UPGRADE_KINDS: UpgradeKind[] = ['tires', 'engine', 'brakes'];
export const MAX_LEVEL = 3;

export interface Levels {
  tires: number;
  engine: number;
  brakes: number;
}

export const NO_UPGRADES: Levels = { tires: 0, engine: 0, brakes: 0 };

/** Price of each level (index 0 buys level 1). */
export const UPGRADES: Record<UpgradeKind, { label: string; effect: string; prices: number[] }> = {
  tires: { label: 'TIRES', effect: '+GRIP', prices: [400, 800, 1400] },
  engine: { label: 'ENGINE', effect: '+ACCEL +TOP SPEED', prices: [600, 1200, 2000] },
  brakes: { label: 'BRAKES', effect: '+BRAKING', prices: [300, 600, 1000] },
};

export const findModel = (id: string) => CAR_MODELS.find((m) => m.id === id) ?? CAR_MODELS[0];

/** Final physics multipliers for a model with its upgrades fitted. */
export function statsFor(model: CarModel, lv: Levels): CarStats {
  const b = model.stats;
  return {
    grip: b.grip * (1 + 0.04 * lv.tires),
    accel: b.accel * (1 + 0.04 * lv.engine),
    top: b.top * (1 + 0.015 * lv.engine),
    drift: b.drift,
    brake: 1 + 0.15 * lv.brakes,
  };
}
