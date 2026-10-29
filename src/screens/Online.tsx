import { useEffect, useRef, useState } from 'react';
import { upgrade } from '../net/connect';
import type { Link } from '../net/link';
import { hostRoom, joinRoom } from '../net/relay';
import type { Room } from '../net/relay';
import { PLAYER_LOOKS } from '../net/session';
import type { Session } from '../net/session';
import type { Save } from '../game/save';
import type { Conditions } from '../race/conditions';
import type { Track } from '../race/track';
import { allTracks } from '../race/tracks';
import Retro from '../ui/Retro';
import type { RetroScreen } from '../ui/Retro';
import { nav } from '../ui/nav';
import { C, W, bevel, button, copperBackground, header, text } from '../ui/kit';
import { rowFor } from './rows';
import type { Group } from './rows';
import TrackList from './TrackList';

interface Props {
  save: Save;
  /** The sprite look of the player's car. */
  look: number;
  conditions: (t: Track) => Conditions;
  onStart: (s: Session, role: 'host' | 'guest') => void;
  onBack: () => void;
}

type Phase = 'menu' | 'pick' | 'host' | 'join';

async function copy(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    return false;
  }
}

/** Lap counts the host can pick from. */
const LAP_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10];

const BTN_X = 60;
const BTN_W = W - 120;

/**
 * Pairing for a duel: the host picks a track and gets a short room code, the friend types it, and the two find each
 * other through a public broker (see net/relay.ts). Then the game starts on both sides.
 */
export default function Online({ save, look, conditions, onStart, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('menu');
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [linked, setLinked] = useState(false);
  const pending = useRef<Room | null>(null);
  const link = useRef<Link | null>(null);
  const started = useRef(false);
  const track = useRef<Track | null>(null);
  const [laps, setLaps] = useState(3);
  const lapsRef = useRef(3);
  lapsRef.current = laps;
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // leaving before the game starts: drop the half-made connection
      if (!started.current) {
        pending.current?.cancel();
        link.current?.close();
      }
    };
  }, []);

  /** The two are paired through the relay: try for a direct connection, then carry on with whichever link we got. */
  const paired = async (relay: Link) => {
    if (!live.current) return relay.close();
    link.current = relay;
    setLinked(true);
    setMsg('FRIEND FOUND. TRYING A DIRECT CONNECTION...');
    const { link: l, direct } = await upgrade(relay);
    console.log(direct ? 'playing over a direct connection' : 'playing through the relay');
    linkUp(l);
  };

  /** The link to play on is ready. The guest says which car it drives; the host answers with the whole setup. */
  const linkUp = (l: Link) => {
    if (!live.current) return l.close();
    link.current = l;
    setMsg('CONNECTED');
    const go = (s: Session) => {
      started.current = true;
      onStart(s, l.role);
    };
    l.onClose(() => !started.current && live.current && setErr('THE CONNECTION CLOSED'));
    if (l.role === 'guest') {
      l.onMessage((m) => m.t === 'hello' && go({ link: l, trackId: m.trackId, cond: m.cond, looks: m.looks, laps: m.laps }));
      l.send({ t: 'join', look });
      setMsg('CONNECTED - WAITING FOR THE HOST TO START');
    } else {
      l.onMessage((m) => {
        if (m.t !== 'join' || started.current || !track.current) return;
        const guestLook = m.look === look ? (look + 1) % PLAYER_LOOKS : m.look;
        const s: Session = { link: l, trackId: track.current.id, cond: conditions(track.current), looks: [look, guestLook], laps: lapsRef.current };
        l.send({ t: 'hello', trackId: s.trackId, cond: s.cond, looks: s.looks, laps: s.laps });
        go(s);
      });
    }
  };

  const fail = (e: unknown) => {
    console.error(e);
    setErr(e instanceof Error && e.message ? e.message.toUpperCase().slice(0, 50) : 'COULD NOT CONNECT');
  };

  const startHost = async (t: Track) => {
    track.current = t;
    setLaps(t.laps);
    setPhase('host');
    setErr('');
    setMsg('OPENING A ROOM...');
    try {
      const room = await hostRoom();
      if (!live.current) return room.cancel();
      pending.current = room;
      setCode(room.code);
      setMsg((await copy(room.code)) ? 'ROOM CODE COPIED. WAITING FOR YOUR FRIEND...' : 'WAITING FOR YOUR FRIEND...');
      room.connected.then(paired).catch(fail);
    } catch (e) {
      fail(e);
    }
  };

  const enterCode = async () => {
    const text = window.prompt('TYPE THE ROOM CODE YOUR FRIEND GAVE YOU');
    if (text === null) return;
    setErr('');
    setMsg('JOINING THE ROOM...');
    try {
      const room = await joinRoom(text);
      if (!live.current) return room?.cancel();
      if (!room) {
        setMsg('');
        return setErr('THAT IS NOT A ROOM CODE');
      }
      pending.current = room;
      room.connected.then(paired).catch(fail);
    } catch (e) {
      fail(e);
    }
  };

  const reset = () => {
    pending.current?.cancel();
    pending.current = null;
    link.current?.close();
    link.current = null;
    setCode('');
    setMsg('');
    setErr('');
    setLinked(false);
    setSel(0);
  };

  if (phase === 'pick') {
    const groups: Group[] = [];
    for (const t of allTracks()) {
      if (t.id.startsWith('custom-') || t.id.startsWith('daily-')) continue; // a friend can't have these
      let g = groups.find((x) => x.title === t.env);
      if (!g) groups.push((g = { title: t.env, rows: [] }));
      g.rows.push(rowFor('race', save, t));
    }
    return <TrackList title="PICK A TRACK TO HOST" groups={groups} onPick={(r) => void startHost(r.track)} onBack={() => setPhase('menu')} />;
  }

  const cycle = (v: number, d: number) => LAP_CHOICES[(Math.max(0, LAP_CHOICES.indexOf(v)) + d + LAP_CHOICES.length) % LAP_CHOICES.length];
  type B = { label: string; act: () => void; off?: boolean; step?: (d: number) => void };
  let buttons: B[];
  if (phase === 'menu')
    buttons = [
      { label: 'HOST A GAME', act: () => setPhase('pick') },
      { label: 'JOIN A GAME', act: () => (reset(), setPhase('join')) },
      { label: 'BACK', act: onBack },
    ];
  else if (phase === 'host')
    buttons = [
      { label: `LAPS  < ${laps} >`, act: () => setLaps(cycle(laps, 1)), off: linked, step: (d: number) => setLaps(cycle(laps, d)) },
      { label: 'COPY ROOM CODE', act: () => void copy(code).then((ok) => ok && setMsg('ROOM CODE COPIED')), off: !code },
      { label: 'BACK', act: () => (reset(), setPhase('menu')) },
    ];
  else
    buttons = [
      { label: 'ENTER ROOM CODE', act: () => void enterCode(), off: linked },
      { label: 'BACK', act: () => (reset(), setPhase('menu')) },
    ];
  const TOP = phase === 'menu' ? 96 : 130;
  const STEP = 15;
  const at = (y: number) => Math.floor((y - TOP) / STEP);
  const press = (i: number) => buttons[i] && !buttons[i].off && buttons[i].act();

  const lines: string[] =
    phase === 'menu'
      ? ['PLAY AGAINST A FRIEND OVER THE INTERNET.', 'THE HOST GETS A SHORT ROOM CODE, THE FRIEND', 'TYPES IT IN. NO ACCOUNT NEEDED.']
      : phase === 'host'
        ? [`TRACK ${track.current?.name ?? ''}`, 'TELL YOUR FRIEND TO CHOOSE JOIN A GAME', 'AND TYPE THIS ROOM CODE']
        : ['ASK THE HOST FOR THEIR ROOM CODE', 'CHOOSE ENTER ROOM CODE AND TYPE IT', 'THE RACE STARTS WHEN YOU ARE IN'];

  const screen: RetroScreen = {
    draw(ctx, t) {
      copperBackground(ctx);
      header(ctx, 'PLAY ONLINE');
      bevel(ctx, 20, 34, W - 40, phase === 'menu' ? 50 : phase === 'host' ? 88 : 56, 'rgba(0,0,17,.7)', true);
      lines.forEach((l, i) => text(ctx, l, W / 2, 42 + i * 11, i === 0 && phase !== 'menu' ? C.gold : C.ink, { align: 'center', small: phase === 'menu' }));
      if (phase !== 'menu') {
        const dots = '...'.slice(0, 1 + (Math.floor(t * 2) % 3));
        if (err) text(ctx, err, W / 2, 84, C.red, { align: 'center' });
        else if (msg) text(ctx, linked ? msg : msg.replace('...', dots), W / 2, 84, linked ? C.green : C.cyan, { align: 'center', small: true });
        if (phase === 'host' && code) text(ctx, code, W / 2, 97, C.gold, { align: 'center', scale: 3 });
      }
      buttons.forEach((b, i) => button(ctx, b.label, BTN_X, TOP + i * STEP, BTN_W, 12, i === sel && !b.off, b.off));
      text(ctx, 'UP DOWN SELECT   ENTER GO   ESC BACK', W / 2, 186, C.dim, { align: 'center', small: true });
    },
    key(e) {
      const n = nav(e);
      if (n === 'up') setSel((sel + buttons.length - 1) % buttons.length);
      else if (n === 'down') setSel((sel + 1) % buttons.length);
      else if (n === 'ok') press(sel);
      else if ((n === 'left' || n === 'right') && buttons[sel]?.step && !buttons[sel].off) buttons[sel].step!(n === 'left' ? -1 : 1);
      else if (n === 'back') buttons[buttons.length - 1].act();
    },
    hover(x, y) {
      const i = at(y);
      if (i >= 0 && i < buttons.length && x >= BTN_X && x < BTN_X + BTN_W) setSel(i);
    },
    click(x, y) {
      const i = at(y);
      if (i >= 0 && i < buttons.length && x >= BTN_X && x < BTN_X + BTN_W && y < TOP + i * STEP + 12) press(i);
    },
  };
  return <Retro screen={screen} />;
}
