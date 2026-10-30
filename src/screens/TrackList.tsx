import { useState } from 'react';
import Retro from '../ui/Retro';
import type { RetroScreen } from '../ui/Retro';
import { nav } from '../ui/nav';
import { C, H, W, bevel, copperBackground, header, medalChip, text } from '../ui/kit';
import { line } from '../ui/map';
import { thumb } from '../ui/thumb';
import { MEDAL_NAMES } from '../game/career';
import type { Group, Row } from './rows';

interface Props {
  title: string;
  groups: Group[];
  onPick: (r: Row) => void;
  onBack: () => void;
}

const TAB_Y = 27;
const TAB_H = 11;
const PREVIEW = { x: 4, y: 40, w: 132, h: 84 };
const CARD = { w: 60, h: 56, y: 127, step: 62, x: 6, shown: 5 };
const GOAL_NAMES = ['GOLD', 'SILVER', 'BRONZE'];

/**
 * Tracks as cards: a tab for each group (cup or environment), a row of five cards with a little picture of each
 * track, and a big preview of the highlighted one with a car driving round it, medal goals, best result and what
 * is left to earn. Left/right moves along the cards (on to the next group at the end), up/down changes group.
 * Locked rows are shown dimmed and can't be picked.
 */
export default function TrackList({ title, groups: all, onPick, onBack }: Props) {
  const groups = all.filter((g) => g.rows.length > 0);
  const career = groups.some((g) => g.rows.some((r) => r.pays));
  const [start] = useState(() => {
    // the career opens on the next track still without a medal; other lists on the first track
    for (let g = 0; g < groups.length; g++)
      for (let c = 0; c < groups[g].rows.length; c++) {
        const r = groups[g].rows[c];
        if (!r.locked && (!career || r.medal === 0)) return { g, c };
      }
    return { g: 0, c: 0 };
  });
  const [gi, setGi] = useState(start.g);
  const [ci, setCi] = useState(start.c);
  const g = groups[gi];
  const off = g.rows.length <= CARD.shown ? 0 : Math.max(0, Math.min(ci - 2, g.rows.length - CARD.shown));

  const select = (g2: number, c2: number) => {
    setGi(g2);
    setCi(c2);
  };
  const step = (d: number) => {
    let g2 = gi;
    let c2 = ci + d;
    if (c2 < 0) {
      if (g2 > 0) c2 = groups[--g2].rows.length - 1;
      else c2 = 0;
    } else if (c2 >= g.rows.length) {
      if (g2 < groups.length - 1) {
        g2++;
        c2 = 0;
      } else c2 = g.rows.length - 1;
    }
    select(g2, c2);
  };
  const group = (d: number) => {
    const g2 = Math.max(0, Math.min(groups.length - 1, gi + d));
    select(g2, Math.min(ci, groups[g2].rows.length - 1));
  };
  const pick = (r: Row | undefined) => r && !r.locked && onPick(r);
  const tabW = Math.floor((W - 8) / groups.length);
  const cardAt = (x: number, y: number) => {
    if (y < CARD.y || y >= CARD.y + CARD.h) return -1;
    const k = Math.floor((x - CARD.x) / CARD.step);
    if (k < 0 || k >= CARD.shown || (x - CARD.x) % CARD.step >= CARD.w) return -1;
    return off + k < g.rows.length ? off + k : -1;
  };

  const screen: RetroScreen = {
    draw(ctx, t) {
      copperBackground(ctx);
      header(ctx, title);

      // tabs
      groups.forEach((gr, i) => {
        const x = 4 + i * tabW;
        const on = i === gi;
        const locked = gr.rows.every((r) => r.locked);
        bevel(ctx, x, TAB_Y, tabW - 1, TAB_H, on ? C.orange : C.navy2, on);
        text(ctx, gr.title.replace(' CUP', ''), x + (tabW - 1) / 2, TAB_Y + 3, on ? C.black : locked ? C.red : C.ink, { align: 'center', shadow: on ? null : '#000', small: groups.length > 6 });
      });

      // preview of the highlighted track
      const r = g.rows[ci];
      bevel(ctx, PREVIEW.x, PREVIEW.y, PREVIEW.w, PREVIEW.h, C.navy0, true);
      if (r) {
        const th = thumb(r.track, 128, 80);
        ctx.drawImage(th.canvas, PREVIEW.x + 2, PREVIEW.y + 2);
        const S = line(r.track.cp);
        for (let k = 3; k >= 0; k--) {
          const s = S[(Math.floor(t * 50) - k * 4 + S.length * 4) % S.length];
          const x = Math.round(PREVIEW.x + 2 + th.ox + s.x * th.sc);
          const y = Math.round(PREVIEW.y + 2 + th.oy + s.y * th.sc);
          ctx.fillStyle = k ? 'rgba(255,80,60,.45)' : '#000';
          ctx.fillRect(x - 1, y - 1, 3, 3);
          if (!k) {
            ctx.fillStyle = '#f43';
            ctx.fillRect(x - 1, y - 1, 3, 2);
            ctx.fillStyle = '#fff';
            ctx.fillRect(x, y - 1, 1, 1);
          }
        }
        if (r.locked) {
          ctx.fillStyle = 'rgba(0,0,40,.7)';
          ctx.fillRect(PREVIEW.x + 2, PREVIEW.y + 2, 128, 80);
          text(ctx, 'LOCKED', PREVIEW.x + 66, PREVIEW.y + 38, C.red, { align: 'center', scale: 2 });
        }

        // the facts
        const x0 = 142;
        text(ctx, r.track.name, x0, 43, C.gold, { scale: 2 });
        text(ctx, `${r.track.env}  ${r.track.laps} LAPS  ${S.length * 4} LONG`, x0, 60, C.dim, { small: true });
        if (th.bridges > 0) text(ctx, `${th.bridges} BRIDGE${th.bridges > 1 ? 'S' : ''}`, x0, 68, C.cyan, { small: true });
        text(ctx, r.sub.startsWith('GOLD') ? 'GOALS' : 'TO BEAT', x0, 77, C.dim, { small: true });
        GOAL_NAMES.forEach((n, k) => {
          const y = 85 + k * 9;
          medalChip(ctx, 3 - k, x0, y);
          text(ctx, n, x0 + 11, y + 1, C.dim, { small: true });
          text(ctx, r.goals[k], x0 + 42, y, C.ink);
        });
        const bx = 244;
        text(ctx, 'BEST', bx, 77, C.dim, { small: true });
        text(ctx, r.value ?? '--', bx, 85, C.ink);
        medalChip(ctx, r.medal, bx, 97);
        text(ctx, MEDAL_NAMES[r.medal], bx + 11, 98, r.medal ? C.ink : C.dim, { small: true });
        if (r.pays && !r.locked) {
          text(ctx, r.left > 0 ? `$${r.left} LEFT` : 'ALL EARNED', bx, 109, r.left > 0 ? C.green : C.dim, { small: true });
          text(ctx, `EARNED $${r.earned}`, bx, 116, C.dim, { small: true });
        }
        if (g.note) text(ctx, g.note, x0, 114, g.note.startsWith('LOCKED') ? C.red : C.dim, { small: true });
      }

      // the cards
      for (let k = 0; k < CARD.shown; k++) {
        const idx = off + k;
        const row = g.rows[idx];
        if (!row) continue;
        const x = CARD.x + k * CARD.step;
        const on = idx === ci;
        bevel(ctx, x, CARD.y, CARD.w, CARD.h, on ? C.orange : C.navy2, on);
        ctx.drawImage(thumb(row.track, 56, 34).canvas, x + 2, CARD.y + 2);
        if (row.locked) {
          ctx.fillStyle = 'rgba(0,0,40,.7)';
          ctx.fillRect(x + 2, CARD.y + 2, 56, 34);
          text(ctx, 'LOCKED', x + CARD.w / 2, CARD.y + 16, C.red, { align: 'center', small: true });
        }
        text(ctx, row.track.name, x + CARD.w / 2, CARD.y + 39, row.locked ? C.navy3 : on ? C.black : C.ink, { align: 'center', small: true, shadow: on || row.locked ? null : '#000' });
        medalChip(ctx, row.medal, x + 4, CARD.y + 46);
        text(ctx, row.locked ? '' : (row.value ?? '--'), x + 14, CARD.y + 47, on ? C.black : C.dim, { small: true, shadow: on ? null : '#000' });
      }
      // more cards off to the sides
      ctx.fillStyle = C.gold;
      if (off > 0) for (let k = 0; k < 4; k++) ctx.fillRect(1 + k, CARD.y + 26 - k, 1, 1 + 2 * k);
      if (off + CARD.shown < g.rows.length) for (let k = 0; k < 4; k++) ctx.fillRect(W - 5 + (3 - k), CARD.y + 26 - k, 1, 1 + 2 * k);

      text(ctx, 'LEFT RIGHT TRACK   UP DOWN GROUP   ENTER GO', W / 2, H - 10, C.dim, { align: 'center', small: true });
    },
    key(e) {
      const n = nav(e);
      if (n === 'left') step(-1);
      else if (n === 'right') step(1);
      else if (n === 'up') group(-1);
      else if (n === 'down') group(1);
      else if (n === 'ok') pick(g.rows[ci]);
      else if (n === 'back') onBack();
    },
    hover(x, y) {
      if (y >= TAB_Y && y < TAB_Y + TAB_H) return;
      const c = cardAt(x, y);
      if (c >= 0) setCi(c);
    },
    click(x, y) {
      if (y >= TAB_Y && y < TAB_Y + TAB_H) {
        const i = Math.floor((x - 4) / tabW);
        if (i >= 0 && i < groups.length) select(i, Math.min(ci, groups[i].rows.length - 1));
        return;
      }
      const c = cardAt(x, y);
      if (c >= 0) pick(g.rows[c]);
      else if (x >= PREVIEW.x && x < PREVIEW.x + PREVIEW.w && y >= PREVIEW.y && y < PREVIEW.y + PREVIEW.h) pick(g.rows[ci]);
    },
    wheel(dy) {
      step(dy);
    },
  };
  return <Retro screen={screen} />;
}
