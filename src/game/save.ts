import type { LapReport } from '../race/race';

const KEY = 'driftking.save.v1';

/** 0 = no medal, then bronze, silver, gold. */
export type Medal = 0 | 1 | 2 | 3;

export interface Best {
  /** Best final score in 1/100 s (time minus drift bonus). */
  time: number;
  medal: Medal;
}

/** Time attack record for one track: the best lap with its ghost, and the most drift points banked in one lap. */
export interface Attack {
  /** Best lap in 1/100 s. */
  lap: number;
  /** Ghost of that lap (see `GhostData`). */
  ghost: number[];
  drift: number;
  /** Best medal for a lap in time attack. */
  medal: Medal;
}

/** Drift challenge record for one track. */
export interface DriftBest {
  score: number;
  medal: Medal;
}

export interface Garage {
  owned: string[];
  selected: string;
  /** Upgrade level (0-3) per car id. */
  upgrades: Record<string, { tires: number; engine: number; brakes: number }>;
}

export interface Save {
  v: 3;
  best: Record<string, Best>;
  attack: Record<string, Attack>;
  /** Drift challenge records. */
  driftMode: Record<string, DriftBest>;
  /** Money earned per track and mode, keyed `${mode}:${trackId}`. */
  earned: Record<string, number>;
  money: number;
  garage: Garage;
}

export const START_MONEY = 300;

export const emptySave = (): Save => ({
  v: 3,
  best: {},
  attack: {},
  driftMode: {},
  earned: {},
  money: START_MONEY,
  garage: { owned: ['rookie'], selected: 'rookie', upgrades: {} },
});

const level = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) ? Math.min(3, Math.max(0, n)) : 0);

const isMedal = (m: unknown): m is Medal => m === 0 || m === 1 || m === 2 || m === 3;

/** Parses save text, dropping anything that doesn't look right. Returns null when it isn't a save at all. */
export function parseSave(raw: string): Save | null {
  try {
    const data = JSON.parse(raw);
    if (![1, 2, 3].includes(data?.v) || typeof data.best !== 'object' || !data.best) return null;
    const save = emptySave(); // older saves lack the newer parts; those load with their defaults
    for (const [id, b] of Object.entries<Best>(data.best)) {
      if (typeof b?.time === 'number' && b.time > 0 && isMedal(b.medal)) save.best[id] = { time: b.time, medal: b.medal };
    }
    if (data.v >= 2 && data.attack && typeof data.attack === 'object') {
      for (const [id, a] of Object.entries<Attack>(data.attack)) {
        const ok = typeof a?.lap === 'number' && a.lap > 0 && typeof a.drift === 'number' && a.drift >= 0;
        if (ok && Array.isArray(a.ghost) && a.ghost.length % 3 === 0 && a.ghost.length <= 30000 && a.ghost.every((n) => Number.isFinite(n))) {
          save.attack[id] = { lap: a.lap, drift: a.drift, ghost: a.ghost, medal: isMedal(a.medal) ? a.medal : 0 };
        }
      }
    }
    if (data.v === 3) {
      for (const [id, d] of Object.entries<DriftBest>(data.driftMode ?? {})) {
        if (typeof d?.score === 'number' && d.score >= 0 && isMedal(d.medal)) save.driftMode[id] = { score: d.score, medal: d.medal };
      }
      for (const [k, n] of Object.entries<number>(data.earned ?? {})) {
        if (typeof n === 'number' && n >= 0 && Number.isFinite(n)) save.earned[k] = Math.floor(n);
      }
      if (typeof data.money === 'number' && data.money >= 0 && Number.isFinite(data.money)) save.money = Math.floor(data.money);
      const g = data.garage;
      if (Array.isArray(g?.owned)) {
        const owned = [...new Set<string>(g.owned.filter((id: unknown) => typeof id === 'string'))];
        if (!owned.includes('rookie')) owned.unshift('rookie');
        save.garage.owned = owned;
        save.garage.selected = owned.includes(g.selected) ? g.selected : 'rookie';
        for (const [id, lv] of Object.entries<Record<string, unknown>>(g.upgrades ?? {})) {
          if (owned.includes(id)) save.garage.upgrades[id] = { tires: level(lv?.tires), engine: level(lv?.engine), brakes: level(lv?.brakes) };
        }
      }
    }
    return save;
  } catch {
    return null;
  }
}

/** Reads the save from storage; a corrupt or blocked store gives a fresh one instead of a crash. */
export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    return (raw && parseSave(raw)) || emptySave();
  } catch {
    return emptySave();
  }
}

/** The save as one pasteable line of text (for moving progress between browsers). */
export function exportSave(save: Save): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(save))));
}

/** Reads text from `exportSave`; null when it isn't valid. */
export function importSave(code: string): Save | null {
  try {
    return parseSave(decodeURIComponent(escape(atob(code.trim()))));
  } catch {
    return null;
  }
}

export function writeSave(save: Save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* private mode or full storage: progress just won't persist */
  }
}

/** Returns a new save with the result merged in (best time and best medal are tracked separately). */
export function withResult(save: Save, trackId: string, time: number, medal: Medal) {
  const prev = save.best[trackId];
  const isBest = !prev || time < prev.time;
  const best: Best = { time: prev ? Math.min(prev.time, time) : time, medal: prev ? (Math.max(prev.medal, medal) as Medal) : medal };
  return { save: { ...save, best: { ...save.best, [trackId]: best } }, isBest };
}

/** Merges a clean lap into the save. Best lap and best drift are independent; the ghost follows the best lap. */
export function withLap(save: Save, trackId: string, r: LapReport, medal: Medal) {
  const prev = save.attack[trackId];
  const newLap = !prev || r.lap < prev.lap;
  const newDrift = !prev || r.drift > prev.drift;
  const next: Attack = {
    lap: newLap ? r.lap : prev.lap,
    ghost: newLap ? r.ghost : prev.ghost,
    drift: newDrift ? r.drift : prev.drift,
    medal: prev ? (Math.max(prev.medal, medal) as Medal) : medal,
  };
  return { save: { ...save, attack: { ...save.attack, [trackId]: next } }, newLap, newDrift };
}

/** Merges a drift challenge score into the save. */
export function withDrift(save: Save, trackId: string, score: number, medal: Medal) {
  const prev = save.driftMode[trackId];
  const isBest = !prev || score > prev.score;
  const next: DriftBest = { score: prev ? Math.max(prev.score, score) : score, medal: prev ? (Math.max(prev.medal, medal) as Medal) : medal };
  return { save: { ...save, driftMode: { ...save.driftMode, [trackId]: next } }, isBest };
}

/** Pays out money and remembers how much each track and mode has earned. `mode` is 'race', 'attack' or 'drift'. */
export function credit(save: Save, mode: string, trackId: string, amount: number): Save {
  if (amount <= 0) return save;
  const key = `${mode}:${trackId}`;
  return { ...save, money: save.money + amount, earned: { ...save.earned, [key]: (save.earned[key] ?? 0) + amount } };
}
