import type { Settings } from '../game/settings';
import type { Track } from './track';

/** What the weather and light are doing. The light is purely visual; rain and snow also cost grip (see `weatherGrip`). */
export interface Conditions {
  weather: 'clear' | 'rain' | 'snow';
  time: 'day' | 'dusk' | 'night';
}

/** Hand-picked moods where the name suggests one; every other track gets one from its id. */
const MOODS: Record<string, Conditions> = {
  'neon-alley': { weather: 'clear', time: 'night' },
  skyline: { weather: 'clear', time: 'night' },
  'pine-ridge': { weather: 'rain', time: 'day' },
  'mud-creek': { weather: 'rain', time: 'dusk' },
  'deep-woods': { weather: 'clear', time: 'night' },
  mirage: { weather: 'clear', time: 'dusk' },
  meadow: { weather: 'clear', time: 'day' },
};

/** Each track has its own default conditions, picked from its id and environment, so a track always looks the same. */
export function autoConditions(track: Track): Conditions {
  if (MOODS[track.id]) return MOODS[track.id];
  let h = 2166136261;
  for (const ch of track.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h >>>= 0;
  const r1 = (h % 100) / 100;
  const r2 = ((h >>> 8) % 100) / 100;
  const weather = track.env === 'SNOW' ? 'snow' : track.env === 'DESERT' ? 'clear' : r1 < 0.28 ? 'rain' : 'clear';
  const time = track.env === 'CITY' ? (r2 < 0.6 ? 'night' : 'dusk') : r2 < 0.5 ? 'day' : r2 < 0.78 ? 'dusk' : 'night';
  return { weather, time };
}

/**
 * Grip left on the road in this weather, as a multiplier on the track's own grip: rain makes the asphalt greasy and snow
 * on a track that isn't a snow track is worse still. Snow tracks already have their low grip built in.
 */
export function weatherGrip(track: Pick<Track, 'env'>, weather: Conditions['weather']): number {
  if (weather === 'rain') return 0.9;
  if (weather === 'snow') return track.env === 'SNOW' ? 1 : 0.86;
  return 1;
}

/** Auto uses the track's own conditions; any other setting overrides them. */
export function conditionsFor(track: Track, s: Pick<Settings, 'weather' | 'time'>): Conditions {
  const auto = autoConditions(track);
  return { weather: s.weather === 'auto' ? auto.weather : s.weather, time: s.time === 'auto' ? auto.time : s.time };
}
