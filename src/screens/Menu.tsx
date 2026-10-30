import { useState } from 'react';
import { music } from '../engine/music';
import type { Save } from '../game/save';
import Retro from '../ui/Retro';
import type { RetroScreen } from '../ui/Retro';
import { nav } from '../ui/nav';
import { C, H, W, bevel, button, copperBackground, logo, rasterBars, stars, text } from '../ui/kit';

interface Props {
  save: Save;
  onCareer: () => void;
  onFree: () => void;
  onAttack: () => void;
  onDrift: () => void;
  onGarage: () => void;
  onOnline: () => void;
  onDaily: () => void;
  onEditor: () => void;
  onSettings: () => void;
  /** Wipe all progress: medals, records, money and cars. */
  onReset: () => void;
}

const BTN_W = 150;
const BTN_H = 9;
const TOP = 62;
const STEP = 10;

/** The confirmation box that opens over the menu: where its two buttons are. */
const ASK = { x: 34, y: 62, w: 252, h: 76 };
const YES = { x: 48, y: 118, w: 106, h: 12 };
const NO = { x: 166, y: 118, w: 106, h: 12 };

export default function Menu(p: Props) {
  const [sel, setSel] = useState(0);
  /** Asking whether to reset all progress: null = not asking, otherwise which answer is highlighted. */
  const [ask, setAsk] = useState<'yes' | 'no' | null>(null);
  const items: [string, () => void][] = [
    ['CAREER', p.onCareer],
    ['FREE RACE', p.onFree],
    ['TIME ATTACK', p.onAttack],
    ['DRIFT CHALLENGE', p.onDrift],
    ['PLAY ONLINE', p.onOnline],
    [`GARAGE  $${p.save.money}`, p.onGarage],
    ['DAILY TRACK', p.onDaily],
    ['TRACK EDITOR', p.onEditor],
    ['SETTINGS', p.onSettings],
    ['RESET PROGRESS', () => setAsk('no')],
  ];
  const medals = Object.values(p.save.best);
  const gold = medals.filter((b) => b.medal === 3).length;
  const at = (y: number) => Math.floor((y - TOP) / STEP);

  const inBox = (b: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  const answer = (yes: boolean) => {
    setAsk(null);
    if (yes) p.onReset();
  };

  const screen: RetroScreen = {
    draw(ctx, t) {
      copperBackground(ctx);
      stars(ctx, t);
      rasterBars(ctx, t, 28, 10);
      logo(ctx, 'DRIFT KING', W / 2, 16, 4, t);
      text(ctx, 'TOP DOWN DRIFT RACING', W / 2, 52, C.cyan, { align: 'center' });
      items.forEach(([label], i) => button(ctx, label, (W - BTN_W) / 2, TOP + i * STEP, BTN_W, BTN_H, i === sel));
      text(ctx, 'UP DOWN SELECT   ENTER GO', W / 2, 165, C.dim, { align: 'center' });
      text(ctx, `${gold} GOLD   ${medals.length} TRACKS DRIVEN`, W / 2, 175, C.gold, { align: 'center' });
      text(ctx, 'ARROWS STEER  SPACE HANDBRAKE  R RESPAWN  ESC LEAVES  M MUSIC', W / 2, 185, C.navy4, { align: 'center', small: true });
      const song = music.current();
      text(ctx, song.artist ? `MUSIC BY ${song.artist} - ${song.title}` : `MUSIC: ${song.title}`, W / 2, 193, C.cyan, { align: 'center', small: true });
      if (ask) {
        ctx.fillStyle = 'rgba(0,0,24,.78)';
        ctx.fillRect(0, 0, W, H);
        bevel(ctx, ASK.x, ASK.y, ASK.w, ASK.h, C.navy2);
        text(ctx, 'RESET ALL PROGRESS?', W / 2, ASK.y + 8, C.gold, { align: 'center', scale: 2 });
        text(ctx, 'MEDALS, RECORDS, MONEY AND CARS', W / 2, ASK.y + 28, C.ink, { align: 'center', small: true });
        text(ctx, 'ARE ERASED. IT CANNOT BE UNDONE.', W / 2, ASK.y + 36, C.ink, { align: 'center', small: true });
        text(ctx, 'SETTINGS AND YOUR OWN TRACKS STAY.', W / 2, ASK.y + 44, C.dim, { align: 'center', small: true });
        button(ctx, 'YES, RESET', YES.x, YES.y, YES.w, YES.h, ask === 'yes');
        button(ctx, 'NO, KEEP IT', NO.x, NO.y, NO.w, NO.h, ask === 'no');
      }
    },
    key(e) {
      const n = nav(e);
      if (ask) {
        // the confirmation has the keyboard until it is answered
        if (n === 'left' || n === 'right') setAsk(ask === 'yes' ? 'no' : 'yes');
        else if (e.key === 'y' || e.key === 'Y') answer(true);
        else if (e.key === 'n' || e.key === 'N' || n === 'back') answer(false);
        else if (n === 'ok') answer(ask === 'yes');
        return;
      }
      if (n === 'up') setSel((sel + items.length - 1) % items.length);
      else if (n === 'down') setSel((sel + 1) % items.length);
      else if (n === 'ok') items[sel][1]();
    },
    hover(x, y) {
      if (ask) {
        if (inBox(YES, x, y)) setAsk('yes');
        else if (inBox(NO, x, y)) setAsk('no');
        return;
      }
      const i = at(y);
      if (i >= 0 && i < items.length && Math.abs(x - W / 2) < BTN_W / 2) setSel(i);
    },
    click(x, y) {
      if (ask) {
        if (inBox(YES, x, y)) answer(true);
        else if (inBox(NO, x, y) || !inBox(ASK, x, y)) answer(false);
        return;
      }
      const i = at(y);
      if (i >= 0 && i < items.length && Math.abs(x - W / 2) < BTN_W / 2) items[i][1]();
    },
  };
  return <Retro screen={screen} />;
}
