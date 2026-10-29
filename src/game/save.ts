const KEY = 'driftking.save.v1';

/** 0 = no medal, then bronze, silver, gold. */
export type Medal = 0 | 1 | 2 | 3;

export interface Best {
  /** Best final score in 1/100 s (time minus drift bonus). */
  time: number;
  medal: Medal;
}

export interface Save {
  v: 1;
  best: Record<string, Best>;
}

export const emptySave = (): Save => ({ v: 1, best: {} });

const isMedal = (m: unknown): m is Medal => m === 0 || m === 1 || m === 2 || m === 3;

/** Reads the save, dropping anything that doesn't look right instead of crashing on a corrupt or blocked store. */
export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    const data = JSON.parse(raw);
    if (data?.v !== 1 || typeof data.best !== 'object' || !data.best) return emptySave();
    const save = emptySave();
    for (const [id, b] of Object.entries<Best>(data.best)) {
      if (typeof b?.time === 'number' && b.time > 0 && isMedal(b.medal)) save.best[id] = { time: b.time, medal: b.medal };
    }
    return save;
  } catch {
    return emptySave();
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
