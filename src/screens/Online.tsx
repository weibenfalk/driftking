import { useEffect, useRef, useState } from 'react';
import { host, join, webrtcAvailable } from '../net/link';
import type { Link, Pending } from '../net/link';
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
    window.prompt('COPY THIS CODE AND SEND IT TO YOUR FRIEND', code);
    return false;
  }
}

async function paste(what: string): Promise<string | null> {
  try {
    const t = await navigator.clipboard.readText();
    if (t.trim()) return t;
  } catch {
    /* no permission: ask for it by hand */
  }
  return window.prompt(`PASTE ${what}`);
}

const BTN_X = 60;
const BTN_W = W - 120;

/**
 * Pairing for a duel, with no server: the host picks a track and gets a code to send to the friend, the friend pastes
 * it and gets a reply code, the host pastes that, and the connection opens. Then the game starts on both sides.
 */
export default function Online({ save, look, conditions, onStart, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('menu');
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [linked, setLinked] = useState(false);
  const pending = useRef<(Pending & { accept?: (a: string) => Promise<boolean> }) | null>(null);
  const link = useRef<Link | null>(null);
  const started = useRef(false);
  const track = useRef<Track | null>(null);
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

  /** Both channels are open. The guest says which car it drives; the host answers with the whole setup. */
  const linkUp = (l: Link) => {
    if (!live.current) return l.close();
    link.current = l;
    setLinked(true);
    setMsg('CONNECTED');
    const go = (s: Session) => {
      started.current = true;
      onStart(s, l.role);
    };
    l.onClose(() => !started.current && live.current && setErr('THE CONNECTION CLOSED'));
    if (l.role === 'guest') {
      l.onMessage((m) => m.t === 'hello' && go({ link: l, trackId: m.trackId, cond: m.cond, looks: m.looks }));
      l.send({ t: 'join', look });
      setMsg('CONNECTED - WAITING FOR THE HOST TO START');
    } else {
      l.onMessage((m) => {
        if (m.t !== 'join' || started.current || !track.current) return;
        const guestLook = m.look === look ? (look + 1) % PLAYER_LOOKS : m.look;
        const s: Session = { link: l, trackId: track.current.id, cond: conditions(track.current), looks: [look, guestLook] };
        l.send({ t: 'hello', trackId: s.trackId, cond: s.cond, looks: s.looks });
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
    setPhase('host');
    setErr('');
    setMsg('MAKING A CODE...');
    try {
      const h = await host();
      if (!live.current) return h.cancel();
      pending.current = h;
      setCode(h.code);
      const ok = await copy(h.code);
      setMsg(ok ? 'CODE COPIED. SEND IT TO YOUR FRIEND' : 'SEND THE CODE TO YOUR FRIEND');
      h.connected.then(linkUp).catch(fail);
    } catch (e) {
      fail(e);
    }
  };

  const takeReply = async () => {
    const h = pending.current;
    if (!h?.accept) return;
    const text = await paste('THE REPLY CODE FROM YOUR FRIEND');
    if (text === null) return;
    setErr('');
    if (await h.accept(text)) setMsg('CONNECTING...');
    else setErr('THAT IS NOT THE REPLY CODE');
  };

  const takeInvite = async () => {
    const text = await paste('THE CODE FROM THE HOST');
    if (text === null) return;
    setErr('');
    setMsg('MAKING A REPLY CODE...');
    try {
      const p = await join(text);
      if (!live.current) return p?.cancel();
      if (!p) {
        setMsg('');
        return setErr('THAT IS NOT A HOST CODE');
      }
      pending.current = p;
      setCode(p.code);
      const ok = await copy(p.code);
      setMsg(ok ? 'REPLY CODE COPIED. SEND IT BACK TO THE HOST' : 'SEND THE REPLY CODE TO THE HOST');
      p.connected.then(linkUp).catch(fail);
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

  type B = { label: string; act: () => void; off?: boolean };
  let buttons: B[];
  if (phase === 'menu')
    buttons = [
      { label: 'HOST A GAME', act: () => setPhase('pick') },
      { label: 'JOIN A GAME', act: () => (reset(), setPhase('join')) },
      { label: 'BACK', act: onBack },
    ];
  else if (phase === 'host')
    buttons = [
      { label: 'COPY CODE AGAIN', act: () => void copy(code).then((ok) => ok && setMsg('CODE COPIED. SEND IT TO YOUR FRIEND')), off: !code },
      { label: 'PASTE REPLY CODE', act: () => void takeReply(), off: !code || linked },
      { label: 'BACK', act: () => (reset(), setPhase('menu')) },
    ];
  else
    buttons = [
      { label: 'PASTE HOST CODE', act: () => void takeInvite(), off: !!code },
      { label: 'COPY REPLY AGAIN', act: () => void copy(code).then((ok) => ok && setMsg('REPLY CODE COPIED. SEND IT BACK TO THE HOST')), off: !code },
      { label: 'BACK', act: () => (reset(), setPhase('menu')) },
    ];
  const TOP = phase === 'menu' ? 96 : 118;
  const STEP = 15;
  const at = (y: number) => Math.floor((y - TOP) / STEP);
  const press = (i: number) => buttons[i] && !buttons[i].off && buttons[i].act();

  const lines: string[] =
    phase === 'menu'
      ? ['PLAY AGAINST A FRIEND OVER THE INTERNET.', 'NO ACCOUNT AND NO SERVER: YOU SWAP TWO CODES', 'IN ANY CHAT, THEN THE GAME CONNECTS BY ITSELF.']
      : phase === 'host'
        ? [`TRACK ${track.current?.name ?? ''}`, '1  SEND THE CODE TO YOUR FRIEND', '2  PASTE THE REPLY CODE YOU GET BACK']
        : ['1  PASTE THE CODE YOUR FRIEND SENT YOU', '2  SEND THE REPLY CODE BACK TO THEM', 'THE RACE STARTS WHEN THEY HAVE PASTED IT'];

  const screen: RetroScreen = {
    draw(ctx, t) {
      copperBackground(ctx);
      header(ctx, 'PLAY ONLINE');
      bevel(ctx, 20, 34, W - 40, phase === 'menu' ? 50 : 66, 'rgba(0,0,17,.7)', true);
      lines.forEach((l, i) => text(ctx, l, W / 2, 42 + i * 11, i === 0 && phase !== 'menu' ? C.gold : C.ink, { align: 'center', small: phase === 'menu' }));
      if (phase !== 'menu') {
        const dots = '...'.slice(0, 1 + (Math.floor(t * 2) % 3));
        if (err) text(ctx, err, W / 2, 84, C.red, { align: 'center' });
        else if (msg) text(ctx, linked ? msg : msg.replace('...', dots), W / 2, 84, linked ? C.green : C.cyan, { align: 'center', small: true });
        if (!webrtcAvailable()) text(ctx, 'THIS BROWSER CANNOT DO ONLINE PLAY', W / 2, 96, C.red, { align: 'center' });
      }
      buttons.forEach((b, i) => button(ctx, b.label, BTN_X, TOP + i * STEP, BTN_W, 12, i === sel && !b.off, b.off));
      text(ctx, 'UP DOWN SELECT   ENTER GO   ESC BACK', W / 2, 186, C.dim, { align: 'center', small: true });
    },
    key(e) {
      const n = nav(e);
      if (n === 'up') setSel((sel + buttons.length - 1) % buttons.length);
      else if (n === 'down') setSel((sel + 1) % buttons.length);
      else if (n === 'ok') press(sel);
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
