const KEY = 'driftking.settings.v1';

export type WeatherSetting = 'auto' | 'clear' | 'rain' | 'snow';
export type TimeSetting = 'auto' | 'day' | 'dusk' | 'night';

export interface Settings {
  sound: boolean;
  /** 0..10 */
  volume: number;
  weather: WeatherSetting;
  time: TimeSetting;
  /** CRT scanline overlay on the screen. */
  scanlines: boolean;
}

export const DEFAULT_SETTINGS: Settings = { sound: true, volume: 7, weather: 'auto', time: 'auto', scanlines: false };

export const WEATHERS: WeatherSetting[] = ['auto', 'clear', 'rain', 'snow'];
export const TIMES: TimeSetting[] = ['auto', 'day', 'dusk', 'night'];

/** Reads settings, keeping only values that are valid. */
export function loadSettings(): Settings {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!d || typeof d !== 'object') return DEFAULT_SETTINGS;
    return {
      sound: typeof d.sound === 'boolean' ? d.sound : DEFAULT_SETTINGS.sound,
      volume: Number.isInteger(d.volume) && d.volume >= 0 && d.volume <= 10 ? d.volume : DEFAULT_SETTINGS.volume,
      weather: WEATHERS.includes(d.weather) ? d.weather : 'auto',
      time: TIMES.includes(d.time) ? d.time : 'auto',
      scanlines: typeof d.scanlines === 'boolean' ? d.scanlines : false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings just won't persist */
  }
}
