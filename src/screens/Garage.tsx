import { useState } from 'react';
import { CAR_MODELS, MAX_LEVEL, UPGRADES, UPGRADE_KINDS, statsFor } from '../game/cars';
import { buyCar, levelsOf, owns, selectCar, selectedModel, upgradeCar, upgradePrice } from '../game/garage';
import type { Save } from '../game/save';
import { getLooks } from '../race/car';
import Retro from '../ui/Retro';
import type { RetroScreen } from '../ui/Retro';
import { nav } from '../ui/nav';
import { C, H, W, bevel, button, copperBackground, header, text } from '../ui/kit';

const BARS = [
  ['GRIP', 'grip', 0.8, 1.3],
  ['ACCEL', 'accel', 0.9, 1.3],
  ['TOP SPEED', 'top', 0.9, 1.2],
  ['DRIFT', 'drift', 0.7, 1.4],
  ['BRAKES', 'brake', 0.9, 1.5],
] as const;

const CARD_W = 50;
const CARD_H = 48;
const CARD_Y = 30;

interface Props {
  save: Save;
  onChange: (next: Save) => void;
  onBack: () => void;
}

/** Pick a car with left/right, then up/down through the actions below it (use or buy, then the three upgrades). */
export default function Garage({ save, onChange, onBack }: Props) {
  const [car, setCar] = useState(() => Math.max(0, CAR_MODELS.findIndex((m) => m.id === selectedModel(save).id)));
  const [row, setRow] = useState(0);
  const model = CAR_MODELS[car];
  const owned = owns(save, model.id);
  const lv = levelsOf(save, model.id);
  const stats = statsFor(model, lv);
  const inUse = save.garage.selected === model.id;

  /** Rows: 0 is use/buy, 1-3 the upgrades. */
  const act = (r: number) => {
    const next = r === 0 ? (owned ? selectCar(save, model.id) : buyCar(save, model.id)) : owned ? upgradeCar(save, model.id, UPGRADE_KINDS[r - 1]) : null;
    if (next) onChange(next);
  };
  const rowsCount = owned ? 4 : 1;

  const screen: RetroScreen = {
    draw(ctx, t) {
      copperBackground(ctx);
      header(ctx, 'GARAGE');
      text(ctx, `$${save.money}`, W - 6, 28, C.green, { align: 'right' });
      const looks = getLooks();
      CAR_MODELS.forEach((m, i) => {
        const x = 6 + i * (CARD_W + 2);
        bevel(ctx, x, CARD_Y + 8, CARD_W, CARD_H, i === car ? C.navy3 : C.navy2, i === car);
        ctx.drawImage(looks[m.look].frames[i === car ? Math.floor(t * 8) % 64 : 0], x + CARD_W / 2 - 11, CARD_Y + 11);
        text(ctx, m.name, x + CARD_W / 2, CARD_Y + 36, i === car ? C.gold : C.ink, { align: 'center' });
        text(ctx, owns(save, m.id) ? (save.garage.selected === m.id ? 'IN USE' : 'OWNED') : `$${m.price}`, x + CARD_W / 2, CARD_Y + 46, owns(save, m.id) ? C.green : C.dim, { align: 'center' });
      });
      // detail
      bevel(ctx, 6, 90, W - 12, 98, C.navy1, true);
      ctx.save();
      ctx.translate(16, 98);
      ctx.scale(3, 3);
      ctx.drawImage(looks[model.look].frames[0], 0, 0);
      ctx.restore();
      text(ctx, model.name, 10, 158, C.gold, { scale: 2 });
      text(ctx, model.blurb, 10, 176, C.dim, { small: true });
      BARS.forEach(([label, key, lo, hi], i) => {
        const y = 94 + i * 9;
        text(ctx, label, 90, y, C.ink, { small: true });
        bevel(ctx, 144, y - 1, 100, 7, C.navy0, true);
        const w = Math.round(Math.min(1, Math.max(0.04, (stats[key] - lo) / (hi - lo))) * 96);
        ctx.fillStyle = i % 2 ? '#2b5' : '#4d6';
        ctx.fillRect(146, y + 1, w, 3);
      });
      // actions
      const mainLabel = owned ? (inUse ? 'IN USE' : 'USE THIS CAR') : `BUY  $${model.price}`;
      button(ctx, mainLabel, 90, 141, 100, 11, row === 0, owned ? inUse : save.money < model.price);
      if (owned) {
        UPGRADE_KINDS.forEach((k, i) => {
          const y = 156 + i * 10;
          const price = upgradePrice(save, model.id, k);
          const on = row === i + 1;
          const can = price !== null && save.money >= price;
          if (on) {
            ctx.fillStyle = can ? C.orange : C.navy3;
            ctx.fillRect(88, y - 2, 222, 10);
          }
          const ink = on ? C.black : C.ink;
          text(ctx, UPGRADES[k].label, 92, y, ink, { shadow: on ? null : '#000' });
          text(ctx, UPGRADES[k].effect, 134, y + 1, on ? C.black : C.dim, { small: true, shadow: on ? null : '#000' });
          text(ctx, Array.from({ length: MAX_LEVEL }, (_, j) => (j < lv[k] ? '#' : '-')).join(' '), 238, y, on ? C.black : C.gold, { shadow: on ? null : '#000' });
          text(ctx, price === null ? 'MAX' : `$${price}`, 306, y, on ? C.black : can ? C.green : C.red, { align: 'right', shadow: on ? null : '#000' });
        });
      }
      text(ctx, 'LEFT RIGHT CAR   UP DOWN CHOOSE   ENTER BUY OR USE', W / 2, H - 9, C.ink, { align: 'center', small: true });
    },
    key(e) {
      const n = nav(e);
      if (n === 'left') {
        setCar((car + CAR_MODELS.length - 1) % CAR_MODELS.length);
        setRow(0);
      } else if (n === 'right') {
        setCar((car + 1) % CAR_MODELS.length);
        setRow(0);
      } else if (n === 'up') setRow((row + rowsCount - 1) % rowsCount);
      else if (n === 'down') setRow((row + 1) % rowsCount);
      else if (n === 'ok') act(row);
      else if (n === 'back') onBack();
    },
    click(x, y) {
      const i = Math.floor((x - 6) / (CARD_W + 2));
      if (y >= CARD_Y + 8 && y <= CARD_Y + 8 + CARD_H && i >= 0 && i < CAR_MODELS.length) {
        setCar(i);
        setRow(0);
      } else if (y >= 141 && y <= 152 && x >= 90 && x <= 190) act(0);
      else if (owned && y >= 154 && y < 186 && x >= 88) {
        const r = 1 + Math.floor((y - 154) / 10);
        setRow(r);
        act(r);
      }
    },
  };
  return <Retro screen={screen} />;
}
