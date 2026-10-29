import { useMemo, useState } from 'react';
import { MAX_CUSTOM, newDraft, optsFor } from '../game/custom';
import { ENV_IDS, CUSTOM_H, CUSTOM_W, envGround, envLabel, envRoad } from '../race/tracks';
import type { CustomTrack } from '../race/tracks';
import { checkTrack } from '../race/trackgen';
import Retro from '../ui/Retro';
import type { RetroScreen } from '../ui/Retro';
import { C, H, W, bevel, copperBackground, header, text } from '../ui/kit';
import { drawMap, line } from '../ui/map';
import { nav } from '../ui/nav';

type CP = [number, number][];

const world = { w: CUSTOM_W, h: CUSTOM_H };
const MIN_POINTS = 8;
const MAX_POINTS = 32;
const STEP = 15;

const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Points 0, 1 and the last two make the start straight: they keep one height so the grid has road to stand on. */
const isStart = (i: number, n: number) => i === 0 || i === 1 || i >= n - 2;

interface ListProps {
  tracks: CustomTrack[];
  onEdit: (c: CustomTrack) => void;
  onNew: () => void;
  onRace: (c: CustomTrack) => void;
  onDelete: (c: CustomTrack) => void;
  onBack: () => void;
}

/** The custom tracks you have made, with a map of the highlighted one. */
export function EditorList({ tracks, onEdit, onNew, onRace, onDelete, onBack }: ListProps) {
  const [sel, setSel] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const rows = tracks.length;
  const total = rows + 1; // the first line is "new track"
  const cur = sel > 0 ? tracks[sel - 1] : null;
  const move = (i: number) => {
    setSel((i + total) % total);
    setConfirm(false);
  };

  const screen: RetroScreen = {
    draw(ctx) {
      copperBackground(ctx);
      header(ctx, 'TRACK EDITOR');
      bevel(ctx, 8, 32, 190, 140, C.navy1, true);
      const items = ['+ NEW TRACK', ...tracks.map((t) => t.name)];
      items.forEach((label, i) => {
        const y = 38 + i * 11;
        if (y > 160) return;
        const on = i === sel;
        if (on) {
          ctx.fillStyle = C.orange;
          ctx.fillRect(10, y - 2, 186, 10);
        }
        text(ctx, label, 16, y, on ? C.black : i === 0 ? C.green : C.ink, { shadow: on ? null : '#000' });
        if (i > 0) text(ctx, envLabel(tracks[i - 1].env), 190, y, on ? C.black : C.dim, { align: 'right', shadow: on ? null : '#000' });
      });
      if (tracks.length === 0) text(ctx, 'NO TRACKS YET. MAKE ONE!', 16, 56, C.dim);
      bevel(ctx, 204, 32, 108, 76, C.navy0, true);
      if (cur) drawMap(ctx, cur.cp, world, 208, 36, 100, 68, rgb(envRoad(cur.env)), rgb(envGround(cur.env)));
      else text(ctx, 'NEW LAYOUT', 258, 66, C.dim, { align: 'center' });
      text(ctx, 'EDITED TRACKS APPEAR IN', 208, 114, C.dim, { small: true });
      text(ctx, 'EVERY LIST UNDER CUSTOM.', 208, 122, C.dim, { small: true });
      text(ctx, 'THEY PAY NO PRIZE MONEY.', 208, 134, C.gold, { small: true });
      text(ctx, confirm ? 'PRESS X AGAIN TO DELETE' : tracks.length >= MAX_CUSTOM ? 'TRACK LIMIT REACHED' : '', W / 2, H - 24, C.red, { align: 'center' });
      text(ctx, 'ENTER EDIT   R RACE   X DELETE   ESC BACK', W / 2, H - 10, C.ink, { align: 'center', small: true });
    },
    key(e) {
      const n = nav(e);
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') move(sel + (e.key === 'ArrowUp' ? -1 : 1));
      else if (e.key === 'Enter' || e.key === ' ') {
        if (sel === 0) {
          if (tracks.length < MAX_CUSTOM) onNew();
        } else onEdit(tracks[sel - 1]);
      } else if ((e.key === 'r' || e.key === 'R') && cur) onRace(cur);
      else if ((e.key === 'x' || e.key === 'X' || e.key === 'Delete') && cur) {
        if (confirm) {
          onDelete(cur);
          setSel(Math.max(0, sel - 1));
          setConfirm(false);
        } else setConfirm(true);
      } else if (n === 'back') onBack();
    },
    click(_x, y) {
      const i = Math.floor((y - 36) / 11);
      if (i >= 0 && i < total) {
        setSel(i);
        if (i === 0 && tracks.length < MAX_CUSTOM) onNew();
        else if (i > 0) onEdit(tracks[i - 1]);
      }
    },
  };
  return <Retro screen={screen} />;
}

interface EditorProps {
  draft: CustomTrack;
  onChange: (d: CustomTrack) => void;
  onSave: (d: CustomTrack) => void;
  onTest: (d: CustomTrack) => void;
  onBack: () => void;
}

const MX = 6;
const MY = 26;
const SC = Math.min(231 / CUSTOM_W, 150 / CUSTOM_H);

/**
 * Edit a track's control points on a map: drag points with the mouse, click empty ground to add one, right-click to
 * remove. The game's own validity check runs live and says what is wrong; only valid tracks can be saved or tested.
 */
export function Editor({ draft, onChange, onSave, onTest, onBack }: EditorProps) {
  const { cp, env } = draft;
  const [sel, setSel] = useState(2);
  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState('');
  const problem = useMemo(() => checkTrack(cp, optsFor(env)), [cp, env]);
  const length = useMemo(() => line(cp).length * 4, [cp]);

  const toWorld = (x: number, y: number): [number, number] => [(x - MX) / SC, (y - MY) / SC];
  const inMap = (x: number, y: number) => x >= MX && y >= MY && x <= MX + CUSTOM_W * SC && y <= MY + CUSTOM_H * SC;
  const clampPt = (p: [number, number]): [number, number] => [Math.min(CUSTOM_W - 20, Math.max(20, Math.round(p[0]))), Math.min(CUSTOM_H - 20, Math.max(20, Math.round(p[1])))];
  const set = (next: CP, s = sel) => {
    onChange({ ...draft, cp: next });
    setSel(s);
    setMsg('');
  };

  /** Moves a point; the start-straight points keep one height (moving the start point moves them all vertically). */
  const moveTo = (i: number, p: [number, number]) => {
    const n = cp.length;
    const [x, y] = clampPt(p);
    const next = cp.map((q) => [...q] as [number, number]);
    if (isStart(i, n)) {
      if (i === 0) for (const k of [0, 1, n - 2, n - 1]) next[k][1] = y;
      next[i][0] = x;
    } else next[i] = [x, y];
    set(next, i);
  };
  const nearest = (x: number, y: number) => {
    let best = -1;
    let bd = 36;
    cp.forEach((p, i) => {
      const d = (MX + p[0] * SC - x) ** 2 + (MY + p[1] * SC - y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  /** Inserts a point on the segment after `i`, unless that is part of the start straight. */
  const insertAfter = (i: number, at?: [number, number]) => {
    const n = cp.length;
    if (n >= MAX_POINTS) return setMsg('TOO MANY POINTS');
    if (i >= n - 2 || i === 0) return setMsg('NOT ON THE START STRAIGHT');
    const a = cp[i];
    const b = cp[(i + 1) % n];
    const p = clampPt(at ?? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const next = [...cp.slice(0, i + 1), p, ...cp.slice(i + 1)];
    set(next, i + 1);
  };
  const remove = (i: number) => {
    if (cp.length <= MIN_POINTS) return setMsg('NEEDS AT LEAST 8 POINTS');
    if (isStart(i, cp.length)) return setMsg('THE START STRAIGHT STAYS');
    set(cp.filter((_, k) => k !== i), Math.max(0, i - 1));
  };
  const segmentFor = (x: number, y: number) => {
    // which control-polygon segment is closest to the click
    let best = 0;
    let bd = 1e9;
    cp.forEach((a, i) => {
      const b = cp[(i + 1) % cp.length];
      const ax = MX + a[0] * SC;
      const ay = MY + a[1] * SC;
      const bx = MX + b[0] * SC;
      const by = MY + b[1] * SC;
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2));
      const d = (ax + (bx - ax) * t - x) ** 2 + (ay + (by - ay) * t - y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  const screen: RetroScreen = {
    draw(ctx) {
      copperBackground(ctx);
      header(ctx, 'EDIT TRACK', 'ESC BACK');
      // map
      const mw = CUSTOM_W * SC;
      const mh = CUSTOM_H * SC;
      ctx.fillStyle = rgb(envGround(env));
      ctx.fillRect(MX, MY, mw, mh);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; // the band near the edge where the road may not go
      const m = 140 * SC;
      ctx.fillRect(MX, MY, mw, m);
      ctx.fillRect(MX, MY + mh - m, mw, m);
      ctx.fillRect(MX, MY, m, mh);
      ctx.fillRect(MX + mw - m, MY, m, mh);
      bevel(ctx, MX - 1, MY - 1, mw + 2, mh + 2, 'rgba(0,0,0,0)', true);
      drawMap(ctx, cp, world, MX, MY, mw, mh, problem ? '#a66' : rgb(envRoad(env)), problem ? '#e44' : '#e33');
      cp.forEach((p, i) => {
        const x = Math.round(MX + p[0] * SC);
        const y = Math.round(MY + p[1] * SC);
        ctx.fillStyle = '#000';
        ctx.fillRect(x - 3, y - 3, 7, 7);
        ctx.fillStyle = i === sel ? C.orange : i === 0 ? C.green : isStart(i, cp.length) ? C.cyan : C.ink;
        ctx.fillRect(x - 2, y - 2, 5, 5);
      });
      // panel
      const px = MX + mw + 6;
      text(ctx, 'ENVIRONMENT', px, 28, C.dim, { small: true });
      text(ctx, envLabel(env), px, 36, C.gold);
      text(ctx, `POINTS ${cp.length}`, px, 48, C.ink, { small: true });
      text(ctx, `LENGTH ${length}`, px, 56, C.ink, { small: true });
      text(ctx, problem ? 'PROBLEM' : 'TRACK OK', px, 68, problem ? C.red : C.green);
      if (problem) {
        const words = problem.split(' ');
        let l = '';
        let y = 79;
        for (const w of words) {
          if ((l + ' ' + w).trim().length > 19) {
            text(ctx, l, px, y, C.red, { small: true });
            y += 7;
            l = w;
          } else l = (l + ' ' + w).trim();
        }
        text(ctx, l, px, y, C.red, { small: true });
      }
      const help = ['DRAG POINTS', 'CLICK ADDS', 'RIGHT CLICK', 'DELETES', '', 'E ENVIRONMENT', 'G NEW LAYOUT', 'T TEST DRIVE', 'ENTER SAVE'];
      help.forEach((h, i) => text(ctx, h, px, 112 + i * 8, i < 4 ? C.dim : C.ink, { small: true }));
      text(ctx, msg, MX, H - 20, C.red);
      text(ctx, 'GREEN IS THE START. CYAN POINTS FORM THE START STRAIGHT.', MX, H - 9, C.dim, { small: true });
    },
    key(e) {
      const k = e.key;
      if (k === 'Escape') return onBack();
      if (k === 'Tab' || k === ']') setSel((sel + 1) % cp.length);
      else if (k === '[') setSel((sel + cp.length - 1) % cp.length);
      else if (k.startsWith('Arrow')) {
        const d = e.shiftKey ? STEP * 4 : STEP;
        const p = cp[sel];
        moveTo(sel, [p[0] + (k === 'ArrowRight' ? d : k === 'ArrowLeft' ? -d : 0), p[1] + (k === 'ArrowDown' ? d : k === 'ArrowUp' ? -d : 0)]);
      } else if (k === 'Insert' || k === 'n' || k === 'N') insertAfter(sel);
      else if (k === 'Delete' || k === 'Backspace' || k === 'x' || k === 'X') remove(sel);
      else if (k === 'e' || k === 'E') onChange({ ...draft, env: ENV_IDS[(ENV_IDS.indexOf(env) + 1) % ENV_IDS.length] });
      else if (k === 'g' || k === 'G') {
        const fresh = newDraft();
        onChange({ ...draft, cp: fresh.cp });
        setSel(2);
      } else if (k === 't' || k === 'T') {
        if (problem) setMsg(problem);
        else onTest(draft);
      } else if (k === 'Enter') {
        if (problem) setMsg(problem);
        else onSave(draft);
      }
    },
    down(x, y, button) {
      if (!inMap(x, y)) return;
      const i = nearest(x, y);
      if (button === 2) {
        if (i >= 0) remove(i);
      } else if (i >= 0) {
        setSel(i);
        setDrag(true);
      } else {
        const seg = segmentFor(x, y);
        insertAfter(seg, clampPt(toWorld(x, y)));
        setDrag(true);
      }
    },
    hover(x, y) {
      if (drag) moveTo(sel, toWorld(x, y));
    },
    up() {
      setDrag(false);
    },
  };
  return <Retro screen={screen} />;
}
