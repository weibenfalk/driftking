const KEY = 'driftking.settings.v1';

/**
 * Stored settings carry a version. Version 2 made scanlines default to on; settings saved before that (no version)
 * were written automatically with the old default off, so for them the scanlines value is not a choice the player made
 * and is taken from the new default instead. Everything else in an old save is kept.
 */
const VERSION = 2;

export type WeatherSetting = 'auto' | 'clear' | 'rain' | 'snow';
export type TimeSetting = 'auto' | 'day' | 'dusk' | 'night';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Settings {
  sound: boolean;
  /** Background music on or off (sound must be on too). */
  music: boolean;
  /** `all` for the whole playlist, or a song id from `SONGS` in engine/music.ts. */
  song: string;
  difficulty: Difficulty;
  /** 0..10 */
  volume: number;
  weather: WeatherSetting;
  time: TimeSetting;
  /** CRT scanline overlay on the screen (on by default). */
  scanlines: boolean;
}

export const DEFAULT_SETTINGS: Settings = { sound: true, music: true, song: 'all', difficulty: 'normal', volume: 7, weather: 'auto', time: 'auto', scanlines: true };
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

/** What each difficulty changes: how fast the AI drives, and how much prize money pays. Medal targets stay the same. */
export const DIFFICULTY: Record<Difficulty, { pace: number; prize: number }> = {
  easy: { pace: 0.9, prize: 0.7 },
  normal: { pace: 1, prize: 1 },
  hard: { pace: 1.08, prize: 1.3 },
};

export const WEATHERS: WeatherSetting[] = ['auto', 'clear', 'rain', 'snow'];
export const TIMES: TimeSetting[] = ['auto', 'day', 'dusk', 'night'];

/** Reads settings, keeping only values that are valid. */
export function loadSettings(): Settings {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!d || typeof d !== 'object') return DEFAULT_SETTINGS;
    return {
      sound: typeof d.sound === 'boolean' ? d.sound : DEFAULT_SETTINGS.sound,
      music: typeof d.music === 'boolean' ? d.music : true,
      song: typeof d.song === 'string' && d.song.length < 40 ? d.song : 'all', // unknown ids fall back to the playlist when played
      difficulty: DIFFICULTIES.includes(d.difficulty) ? d.difficulty : 'normal',
      volume: Number.isInteger(d.volume) && d.volume >= 0 && d.volume <= 10 ? d.volume : DEFAULT_SETTINGS.volume,
      weather: WEATHERS.includes(d.weather) ? d.weather : 'auto',
      time: TIMES.includes(d.time) ? d.time : 'auto',
      scanlines: d.v === VERSION && typeof d.scanlines === 'boolean' ? d.scanlines : DEFAULT_SETTINGS.scanlines,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...s }));
  } catch {
    /* storage blocked: settings just won't persist */
  }
}
