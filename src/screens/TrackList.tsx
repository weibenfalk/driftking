import { useState } from 'react';
import Retro from '../ui/Retro';
import type { RetroScreen } from '../ui/Retro';
import { nav } from '../ui/nav';
import { C, H, W, bevel, copperBackground, header, medalChip, text } from '../ui/kit';
import { drawMap } from '../ui/map';
import type { Group, Row } from './rows';

interface Props {
  title: string;
  groups: Group[];
  onPick: (r: Row) => void;
  onBack: () => void;
}

const LIST_TOP = 38;
const ROW_H = 11;
const VISIBLE = 11;

type Line = { head: Group } | { row: Row; index: number };

/**
 * A scrolling list of tracks in groups (cups or environments), with medal, money still on offer and best result per
 * row, and a detail box for the highlighted one. Locked rows are shown but can't be picked.
 */
export default function TrackList({ title, groups, onPick, onBack }: Props) {
  const lines: Line[] = [];
  const rows: Row[] = [];
  for (const g of groups) {
    lines.push({ head: g });
    for (const row of g.rows) lines.push({ row, index: rows.push(row) - 1 });
  }
  const [sel, setSel] = useState(() => Math.max(0, rows.findIndex((r) => !r.locked)));
  const [top, setTop] = useState(0);

  const lineOf = (index: number) => lines.findIndex((l) => 'row' in l && l.index === index);
  /** Moves the selection, keeping it on screen. */
  const go = (index: number) => {
    const i = Math.max(0, Math.min(rows.length - 1, index));
    setSel(i);
    const li = lineOf(i);
    // show the group heading above the first row when scrolling up to it
    const want = li > 0 && 'head' in lines[li - 1] ? li - 1 : li;
    if (want < top) setTop(want);
    else if (li >= top + VISIBLE) setTop(li - VISIBLE + 1);
  };
  const pick = (r: Row) => !r.locked && onPick(r);
  const lineAt = (y: number) => lines[top + Math.floor((y - LIST_TOP) / ROW_H)];

  const screen: RetroScreen = {
    draw(ctx) {
      copperBackground(ctx);
      header(ctx, title);
      text(ctx, 'TRACK', 22, 27, C.dim, { small: true });
      text(ctx, 'CAN EARN', 226, 27, C.dim, { align: 'right', small: true });
      text(ctx, 'BEST', W - 14, 27, C.dim, { align: 'right', small: true });
      bevel(ctx, 2, LIST_TOP - 3, W - 4, VISIBLE * ROW_H + 5, C.navy1, true);
      lines.slice(top, top + VISIBLE).forEach((l, k) => {
        const y = LIST_TOP + k * ROW_H;
        if ('head' in l) {
          text(ctx, l.head.title, 8, y + 2, C.gold);
          if (l.head.note) text(ctx, l.head.note, W - 14, y + 2, l.head.note.startsWith('LOCKED') ? C.red : C.dim, { align: 'right' });
          return;
        }
        const r = l.row;
        const on = l.index === sel;
        if (on) {
          ctx.fillStyle = r.locked ? C.navy3 : C.orange;
          ctx.fillRect(4, y, W - 8, ROW_H - 1);
        }
        const ink = r.locked ? C.navy3 : on ? C.black : C.ink;
        medalChip(ctx, r.medal, 9, y + 2);
        text(ctx, r.track.name, 22, y + 2, ink, { shadow: on || r.locked ? null : '#000' });
        text(ctx, r.locked ? '' : r.left > 0 ? `$${r.left}` : 'DONE', 226, y + 2, on ? C.black : C.green, { align: 'right', shadow: on ? null : '#000' });
        text(ctx, r.value ?? '--', W - 14, y + 2, on ? C.black : C.ink, { align: 'right', shadow: on ? null : '#000' });
      });
      // scroll arrows
      ctx.fillStyle = C.gold;
      if (top > 0) for (let k = 0; k < 4; k++) ctx.fillRect(W - 10 + k, LIST_TOP + 2 + (3 - k), 8 - 2 * k, 1);
      if (top + VISIBLE < lines.length) for (let k = 0; k < 4; k++) ctx.fillRect(W - 10 + k, LIST_TOP + VISIBLE * ROW_H - 7 + k, 8 - 2 * k, 1);
      // detail box
      const r = rows[sel];
      bevel(ctx, 2, H - 36, W - 4, 34, C.navy2);
      if (r) {
        // the track map (a bird's-eye view of the route) on the right of the box
        bevel(ctx, W - 74, H - 34, 70, 30, C.navy0, true);
        drawMap(ctx, r.track.cp, { w: r.track.width, h: r.track.height }, W - 72, H - 32, 66, 26, '#88a', '#334');
        text(ctx, r.track.name, 8, H - 31, C.gold, { scale: 1 });
        text(ctx, `${r.track.env}  ${r.sub}`, 8, H - 22, C.dim, { small: true });
        text(ctx, `EARNED $${r.earned}`, 8, H - 13, C.green);
        text(ctx, r.left > 0 ? `UP TO $${r.left} LEFT` : 'ALL EARNED', 76, H - 13, r.left > 0 ? C.green : C.dim);
      }
    },
    key(e) {
      const n = nav(e);
      if (n === 'up') go(sel - 1);
      else if (n === 'down') go(sel + 1);
      else if (n === 'ok' && rows[sel]) pick(rows[sel]);
      else if (n === 'back') onBack();
    },
    hover(x, y) {
      if (y < LIST_TOP || y > LIST_TOP + VISIBLE * ROW_H || x < 4 || x > W - 4) return;
      const l = lineAt(y);
      if (l && 'row' in l) setSel(l.index);
    },
    click(_x, y) {
      if (y < LIST_TOP || y > LIST_TOP + VISIBLE * ROW_H) return;
      const l = lineAt(y);
      if (l && 'row' in l) pick(l.row);
    },
    wheel(dy) {
      go(sel + dy);
    },
  };
  return <Retro screen={screen} />;
}
