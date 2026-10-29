import { useState } from 'react';
import { ALL, SONGS } from '../engine/music';
import { DIFFICULTIES, TIMES, WEATHERS } from '../game/settings';
import type { Settings as SettingsData } from '../game/settings';
import { emptySave, exportSave, importSave } from '../game/save';
import type { Save } from '../game/save';
import Retro from '../ui/Retro';
import type { RetroScreen } from '../ui/Retro';
import { nav } from '../ui/nav';
import { C, H, W, bevel, copperBackground, header, text } from '../ui/kit';

interface Props {
  settings: SettingsData;
  save: Save;
  onChange: (s: SettingsData) => void;
  onSave: (s: Save) => void;
  onBack: () => void;
}

const ROW_TOP = 36;
const ROW_H = 11;
const ITEMS = ['SOUND', 'MUSIC', 'SONG', 'VOLUME', 'DIFFICULTY', 'WEATHER', 'TIME OF DAY', 'SCANLINES', 'EXPORT SAVE', 'IMPORT SAVE', 'ERASE SAVE'] as const;
const VALUES = 8;
const SONG_CHOICES = [ALL, ...SONGS.map((s) => s.id)]; // the first seven rows are values you change; the rest run an action

const cycle = <T,>(list: T[], v: T, d: number) => list[(list.indexOf(v) + d + list.length) % list.length];

export default function Settings({ settings, save, onChange, onSave, onBack }: Props) {
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);

  /** Left/right changes a value; Enter also toggles or runs the action. */
  const change = (i: number, d: number) => {
    if (i === 0) onChange({ ...settings, sound: !settings.sound });
    else if (i === 1) onChange({ ...settings, music: !settings.music });
    else if (i === 2) onChange({ ...settings, song: cycle(SONG_CHOICES, SONG_CHOICES.includes(settings.song) ? settings.song : ALL, d) });
    else if (i === 3) onChange({ ...settings, volume: Math.min(10, Math.max(0, settings.volume + d)) });
    else if (i === 4) onChange({ ...settings, difficulty: cycle(DIFFICULTIES, settings.difficulty, d) });
    else if (i === 5) onChange({ ...settings, weather: cycle(WEATHERS, settings.weather, d) });
    else if (i === 6) onChange({ ...settings, time: cycle(TIMES, settings.time, d) });
    else if (i === 7) onChange({ ...settings, scanlines: !settings.scanlines });
  };
  const run = (i: number) => {
    setConfirm(i === 10 ? confirm : false);
    if (i < VALUES) change(i, 1);
    else if (i === 8) {
      const code = exportSave(save);
      navigator.clipboard
        ?.writeText(code)
        .then(() => setMsg('SAVE CODE COPIED TO THE CLIPBOARD'))
        .catch(() => window.prompt('COPY THIS SAVE CODE', code));
      if (!navigator.clipboard) window.prompt('COPY THIS SAVE CODE', code);
    } else if (i === 9) {
      const code = window.prompt('PASTE A SAVE CODE');
      if (code === null) return;
      const s = importSave(code);
      if (s) {
        onSave(s);
        setMsg('SAVE LOADED');
      } else setMsg('THAT IS NOT A VALID SAVE CODE');
    } else if (i === 10) {
      if (!confirm) {
        setConfirm(true);
        setMsg('PRESS ENTER AGAIN TO ERASE EVERYTHING');
      } else {
        onSave(emptySave());
        setConfirm(false);
        setMsg('SAVE ERASED');
      }
    }
  };
  const move = (i: number) => {
    setSel(i);
    setConfirm(false);
  };
  const songName = settings.song === ALL ? 'ALL SONGS' : (SONGS.find((s) => s.id === settings.song)?.title ?? 'ALL SONGS');
  const value = (i: number) => [settings.sound ? 'ON' : 'OFF', settings.music ? 'ON' : 'OFF', songName, '', settings.difficulty.toUpperCase(), (settings.weather === 'clear' ? 'OFF' : settings.weather.toUpperCase()), settings.time.toUpperCase(), settings.scanlines ? 'ON' : 'OFF'][i] ?? '';

  const screen: RetroScreen = {
    draw(ctx) {
      copperBackground(ctx);
      header(ctx, 'SETTINGS');
      bevel(ctx, 20, ROW_TOP - 4, W - 40, ITEMS.length * ROW_H + 6, C.navy1, true);
      ITEMS.forEach((label, i) => {
        const y = ROW_TOP + i * ROW_H;
        const on = i === sel;
        if (on) {
          ctx.fillStyle = C.orange;
          ctx.fillRect(22, y - 2, W - 44, ROW_H - 1);
        }
        const ink = on ? C.black : C.ink;
        const sh = on ? null : '#000';
        text(ctx, label, 30, y + 2, ink, { shadow: sh });
        if (i === 3) {
          for (let k = 0; k < 10; k++) {
            ctx.fillStyle = k < settings.volume ? (on ? C.black : C.green) : on ? '#a50' : C.navy3;
            ctx.fillRect(196 + k * 7, y, 5, 7);
          }
        } else text(ctx, value(i), W - 30, y + 2, i >= VALUES ? C.dim : on ? C.black : C.gold, { align: 'right', shadow: sh });
      });
      text(ctx, msg, W / 2, H - 38, confirm ? C.red : C.green, { align: 'center' });
      text(ctx, 'DIFFICULTY SETS HOW FAST THE AI DRIVES AND HOW MUCH PRIZE MONEY PAYS.', W / 2, H - 27, C.dim, { align: 'center', small: true });
      text(ctx, 'WEATHER OFF = CLEAR SKIES. WEATHER AND TIME ARE VISUAL ONLY. M = MUSIC ON/OFF', W / 2, H - 19, C.dim, { align: 'center', small: true });
      text(ctx, 'UP DOWN CHOOSE   LEFT RIGHT CHANGE   ENTER GO   ESC BACK', W / 2, H - 9, C.ink, { align: 'center', small: true });
    },
    key(e) {
      const n = nav(e);
      if (n === 'up') move((sel + ITEMS.length - 1) % ITEMS.length);
      else if (n === 'down') move((sel + 1) % ITEMS.length);
      else if (n === 'left' && sel < VALUES) change(sel, -1);
      else if (n === 'right' && sel < VALUES) change(sel, 1);
      else if (n === 'ok') run(sel);
      else if (n === 'back') onBack();
    },
    hover(x, y) {
      const i = Math.floor((y - ROW_TOP + 2) / ROW_H);
      if (x > 20 && x < W - 20 && i >= 0 && i < ITEMS.length && i !== sel) move(i);
    },
    click(x, y) {
      const i = Math.floor((y - ROW_TOP + 2) / ROW_H);
      if (x > 20 && x < W - 20 && i >= 0 && i < ITEMS.length) run(i);
    },
  };
  return <Retro screen={screen} />;
}
