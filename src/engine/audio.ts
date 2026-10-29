/**
 * Shared chiptune audio. One AudioContext for the whole app, a master gain
 * for mute, and two helpers that cover most retro sound effects.
 */
type Listener = (muted: boolean) => void;

const MUTE_KEY = 'driftking:v1:muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const listeners = new Set<Listener>();

try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* storage unavailable */
}

function ensure(): AudioContext | null {
  if (!ctx) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export const audio = {
  /** Call from a user gesture (click/key) so the browser allows sound. */
  unlock(): void {
    ensure();
  },

  /** Raw context for custom sound graphs (e.g. a looping engine). */
  get ctx(): AudioContext | null {
    return ensure();
  },

  /** Connect custom nodes here so mute applies to them. */
  get out(): AudioNode | null {
    ensure();
    return master;
  },

  tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.05, slide = 0, delay = 0): void {
    const c = ensure();
    if (!c || !master || muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  noise(dur: number, vol = 0.1): void {
    const c = ensure();
    if (!c || !master || muted) return;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(g).connect(master);
    src.start();
  },

  /** Play a short melody: [frequency, duration] pairs, back to back. */
  jingle(notes: [number, number][], type: OscillatorType = 'square', vol = 0.05): void {
    let t = 0;
    for (const [f, d] of notes) {
      if (f > 0) audio.tone(f, d * 0.95, type, vol, 0, t);
      t += d;
    }
  },

  isMuted(): boolean {
    return muted;
  },

  setMuted(m: boolean): void {
    muted = m;
    if (master) master.gain.value = m ? 0 : 1;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l(m));
  },

  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export type Audio = typeof audio;
