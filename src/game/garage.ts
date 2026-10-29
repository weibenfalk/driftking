import { CAR_MODELS, MAX_LEVEL, NO_UPGRADES, STARTER_CAR, UPGRADES, findModel, statsFor } from './cars';
import type { Levels, UpgradeKind } from './cars';
import type { Save } from './save';

export const levelsOf = (save: Save, carId: string): Levels => save.garage.upgrades[carId] ?? NO_UPGRADES;
export const owns = (save: Save, carId: string) => save.garage.owned.includes(carId);

/** The selected car, falling back to the starter if the save names one that no longer exists. */
export const selectedModel = (save: Save) => {
  const m = findModel(save.garage.selected);
  return owns(save, m.id) ? m : findModel(STARTER_CAR);
};

export const selectedStats = (save: Save) => statsFor(selectedModel(save), levelsOf(save, selectedModel(save).id));

/** Each returns a new save, or null when the action isn't allowed (not enough money, already owned, maxed out...). */
export function buyCar(save: Save, carId: string): Save | null {
  const m = CAR_MODELS.find((c) => c.id === carId);
  if (!m || owns(save, carId) || save.money < m.price) return null;
  return { ...save, money: save.money - m.price, garage: { ...save.garage, owned: [...save.garage.owned, carId], selected: carId } };
}

export function selectCar(save: Save, carId: string): Save | null {
  if (!owns(save, carId) || save.garage.selected === carId) return null;
  return { ...save, garage: { ...save.garage, selected: carId } };
}

export const upgradePrice = (save: Save, carId: string, kind: UpgradeKind): number | null => {
  const lv = levelsOf(save, carId)[kind];
  return lv >= MAX_LEVEL ? null : UPGRADES[kind].prices[lv];
};

export function upgradeCar(save: Save, carId: string, kind: UpgradeKind): Save | null {
  const price = upgradePrice(save, carId, kind);
  if (!owns(save, carId) || price === null || save.money < price) return null;
  const lv = levelsOf(save, carId);
  return { ...save, money: save.money - price, garage: { ...save.garage, upgrades: { ...save.garage.upgrades, [carId]: { ...lv, [kind]: lv[kind] + 1 } } } };
}
