/*
 * A small ProTracker (.mod) player: parses the file and renders the whole song to a stereo buffer the way an Amiga's
 * Paula chip would mix it (four 8-bit channels, two on each side, played back at a rate set by each note's period),
 * with the tracker effects that real songs use: arpeggio, slides, tone portamento, vibrato, sample offset, volume and
 * volume slides, jumps and breaks, speed/tempo, and the E-commands for fine slides, retrigger, fine volume, note cut,
 * note delay, pattern loop and pattern delay, plus sample finetune. Not implemented: tremolo, panning, waveform and
 * filter commands.
 */

export interface ModSample {
  data: Int8Array;
  volume: number;
  /** Finetune in eighths of a semitone, -8..7. */
  finetune: number;
  /** Loop start and length in bytes; a length of 2 or less means the sample does not loop. */
  loopStart: number;
  loopLen: number;
}

export interface Mod {
  title: string;
  samples: ModSample[];
  /** Pattern numbers in play order. */
  order: number[];
  /** 64 rows x 4 channels x 4 bytes each. */
  patterns: Uint8Array[];
}

const PAL_CLOCK = 3546894.6;
const PERIODS = [
  856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151,
  143, 135, 127, 120, 113,
];
const SIGNATURES = ['M.K.', 'M!K!', '4CHN', 'FLT4'];

const ascii = (b: Uint8Array, from: number, len: number) => {
  let s = '';
  for (let i = from; i < from + len && b[i]; i++) s += String.fromCharCode(b[i]);
  return s;
};

/** Reads a 4-channel .mod file. Throws if it isn't one. */
export function parseMod(buf: ArrayBuffer): Mod {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (b.length < 1084 || !SIGNATURES.includes(ascii(b, 1080, 4))) throw new Error('not a 4-channel .mod file');
  const meta = Array.from({ length: 31 }, (_, i) => {
    const o = 20 + i * 30;
    const ft = b[o + 24] & 15;
    return { len: dv.getUint16(o + 22) * 2, finetune: ft > 7 ? ft - 16 : ft, volume: Math.min(64, b[o + 25]), loopStart: dv.getUint16(o + 26) * 2, loopLen: dv.getUint16(o + 28) * 2 };
  });
  const songLen = Math.min(128, Math.max(1, b[950]));
  const order = Array.from(b.slice(952, 952 + songLen));
  const patternCount = Math.max(...Array.from(b.slice(952, 952 + 128))) + 1;
  const patterns: Uint8Array[] = [];
  let o = 1084;
  for (let p = 0; p < patternCount; p++) {
    patterns.push(b.slice(o, o + 1024));
    o += 1024;
  }
  const samples: ModSample[] = meta.map((m) => {
    const data = new Int8Array(b.buffer.slice(b.byteOffset + o, b.byteOffset + Math.min(b.length, o + m.len)));
    o += m.len;
    return { data, volume: m.volume, finetune: m.finetune, loopStart: m.loopStart, loopLen: m.loopLen };
  });
  return { title: ascii(b, 0, 20), samples, order, patterns };
}

interface Channel {
  sample: number;
  pos: number;
  period: number;
  volume: number;
  target: number;
  portaSpeed: number;
  vibSpeed: number;
  vibDepth: number;
  vibPos: number;
  arp: number;
  /** Per-row E-command state: retrigger interval, note-cut tick, delayed note (tick and what to play). */
  retrig: number;
  cut: number;
  delay: number;
  dSample: number;
  dPeriod: number;
  dEff: number;
  dPar: number;
  effect: number;
  param: number;
  base: number;
}

const newChannel = (): Channel => ({ sample: -1, pos: 0, period: 0, volume: 0, target: 0, portaSpeed: 0, vibSpeed: 0, vibDepth: 0, vibPos: 0, arp: 0, retrig: 0, cut: -1, delay: -1, dSample: 0, dPeriod: 0, dEff: 0, dPar: 0, effect: 0, param: 0, base: 0 });

/** Index of the note in the period table closest to `period` (finetune 0). */
const noteIndex = (period: number) => {
  let best = 0;
  for (let i = 1; i < PERIODS.length; i++) if (Math.abs(PERIODS[i] - period) < Math.abs(PERIODS[best] - period)) best = i;
  return best;
};

export interface Block {
  left: Float32Array;
  right: Float32Array;
}

/**
 * A song being played, one block of audio at a time (so a ten-minute module never needs ten minutes of audio in
 * memory). `render(frames)` returns the next stretch, or null once the song has reached its end or jumped back to a
 * row it has already played (the loop point). `gain` scales the whole mix; the Amiga-style low-pass is applied here.
 */
export class ModPlayer {
  private readonly mod: Mod;
  private readonly rate: number;
  private readonly gain: number;
  private readonly ch = [newChannel(), newChannel(), newChannel(), newChannel()];
  private speed = 6;
  private tempo = 125;
  private ord = 0;
  private row = 0;
  private tick = 0;
  private carry = 0;
  private ended = false;
  private jump = -1;
  private breakRow = -1;
  /** Extra repeats of the current row (EEx) and pattern-loop (E6x) state. */
  private patDelay = 0;
  private loopRow = 0;
  private loopCount = 0;
  private loopTo = -1;
  private readonly seen = new Set<number>();
  private yl = 0;
  private yr = 0;
  private readonly lp: number;

  constructor(mod: Mod, rate = 44100, gain = 0.3) {
    this.mod = mod;
    this.rate = rate;
    this.gain = gain;
    this.lp = 1 - Math.exp((-2 * Math.PI * 6500) / rate); // the A500's output filter
  }

  /** Reads the notes and effects of the current row (tick 0). */
  private readRow() {
    const { mod, ch } = this;
    const pat = mod.patterns[mod.order[this.ord]];
    this.jump = -1;
    this.breakRow = -1;
    for (let c = 0; c < 4; c++) {
      const o = (this.row * 4 + c) * 4;
      const sampleNo = (pat[o] & 0xf0) | (pat[o + 2] >> 4);
      const period = ((pat[o] & 0x0f) << 8) | pat[o + 1];
      const eff = pat[o + 2] & 0x0f;
      const par = pat[o + 3];
      const s = ch[c];
      s.effect = eff;
      s.param = par;
      s.retrig = 0;
      s.cut = -1;
      s.delay = -1;
      const sub = eff === 0xe ? par >> 4 : -1;
      const x = par & 15;
      if (sub === 0xd && x > 0) {
        // note delay: the whole note starts on tick x instead
        s.delay = x;
        s.dSample = sampleNo;
        s.dPeriod = period;
        s.dEff = eff;
        s.dPar = par;
      } else this.trigger(s, sampleNo, period, eff, par);
      if (eff === 3 && par) s.portaSpeed = par;
      if (eff === 4) {
        if (par >> 4) s.vibSpeed = par >> 4;
        if (par & 15) s.vibDepth = par & 15;
      }
      if (eff === 0xc) s.volume = Math.min(64, par);
      else if (eff === 0xf) {
        if (par < 32) this.speed = par || 1;
        else this.tempo = par;
      } else if (eff === 0xb) {
        this.jump = par;
        this.breakRow = this.breakRow < 0 ? 0 : this.breakRow;
      } else if (eff === 0xd) this.breakRow = (par >> 4) * 10 + (par & 15);
      else if (eff === 0xe) {
        if (sub === 0x1) s.period = Math.max(113, s.period - x);
        else if (sub === 0x2) s.period = Math.min(856, s.period + x);
        else if (sub === 0x6) {
          if (x === 0) this.loopRow = this.row;
          else {
            if (this.loopCount === 0) this.loopCount = x;
            else this.loopCount--;
            if (this.loopCount > 0) this.loopTo = this.loopRow;
          }
        } else if (sub === 0x9) s.retrig = x;
        else if (sub === 0xa) s.volume = Math.min(64, s.volume + x);
        else if (sub === 0xb) s.volume = Math.max(0, s.volume - x);
        else if (sub === 0xc) {
          s.cut = x;
          if (x === 0) s.volume = 0;
        } else if (sub === 0xe) this.patDelay = x;
      }
    }
  }

  /** Starts a note (sample, period) on a channel, as a row's first tick does. */
  private trigger(s: Channel, sampleNo: number, period: number, eff: number, par: number) {
    if (sampleNo > 0 && sampleNo <= this.mod.samples.length) {
      s.sample = sampleNo - 1;
      s.volume = this.mod.samples[s.sample].volume;
    }
    if (period > 0) {
      if (eff === 3 || eff === 5) s.target = period;
      else {
        s.period = period;
        s.base = period;
        s.pos = eff === 9 ? par * 256 : 0;
        s.vibPos = 0;
      }
    }
  }

  /** Effects that run on every tick after the first. */
  private tickEffects() {
    for (const s of this.ch) {
      const p = s.param;
      if (s.delay === this.tick) this.trigger(s, s.dSample, s.dPeriod, s.dEff, s.dPar);
      if (s.cut === this.tick) s.volume = 0;
      if (s.retrig > 0 && this.tick % s.retrig === 0) s.pos = 0;
      if (s.effect === 0 && p) {
        s.arp = this.tick % 3;
        const i = noteIndex(s.base);
        s.period = PERIODS[Math.min(35, i + (s.arp === 0 ? 0 : s.arp === 1 ? p >> 4 : p & 15))];
      } else if (s.effect === 1) s.period = Math.max(113, s.period - p);
      else if (s.effect === 2) s.period = Math.min(856, s.period + p);
      else if (s.effect === 3 && s.target) {
        if (s.period > s.target) s.period = Math.max(s.target, s.period - s.portaSpeed);
        else s.period = Math.min(s.target, s.period + s.portaSpeed);
      } else if (s.effect === 4) {
        s.vibPos += s.vibSpeed;
        s.period = Math.max(113, Math.min(856, s.base + Math.sin((s.vibPos * Math.PI) / 32) * s.vibDepth * 2));
      } else if (s.effect === 0xa) s.volume = Math.max(0, Math.min(64, s.volume + (p >> 4) - (p & 15)));
    }
  }

  /** Mixes one tick (a fiftieth of a second at the usual tempo) and moves on. */
  private nextTick(): Block | null {
    if (this.ended) return null;
    if (this.tick === 0) {
      if (this.ord >= this.mod.order.length) return this.end();
      const key = this.ord * 64 + this.row;
      // rows repeated by a pattern loop are not a song loop
      if (this.loopCount === 0) {
        if (this.seen.has(key)) return this.end();
        this.seen.add(key);
      }
      this.patDelay = 0;
      this.loopTo = -1;
      this.readRow();
    } else this.tickEffects();
    const exact = (this.rate * 2.5) / this.tempo + this.carry;
    const n = Math.floor(exact);
    this.carry = exact - n;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let c = 0; c < 4; c++) {
      const s = this.ch[c];
      const smp = s.sample >= 0 ? this.mod.samples[s.sample] : null;
      if (!smp || s.period <= 0 || s.volume <= 0 || smp.data.length < 2) continue;
      const step = (PAL_CLOCK / (s.period * Math.pow(2, -smp.finetune / 96))) / this.rate;
      const looped = smp.loopLen > 2;
      const end = looped ? smp.loopStart + smp.loopLen : smp.data.length;
      const g = s.volume / 64 / 128;
      const out = c === 0 || c === 3 ? L : R;
      const bleed = c === 0 || c === 3 ? R : L;
      let pos = s.pos;
      for (let i = 0; i < n; i++) {
        if (pos >= end) {
          if (!looped) {
            s.sample = -1;
            break;
          }
          pos = smp.loopStart + ((pos - end) % smp.loopLen);
        }
        const i0 = Math.floor(pos);
        const i1 = i0 + 1 >= end ? (looped ? smp.loopStart : i0) : i0 + 1;
        const f = pos - i0;
        const v = (smp.data[i0] * (1 - f) + smp.data[i1] * f) * g;
        out[i] += v * 0.78;
        bleed[i] += v * 0.22; // a little of each channel on the other side keeps hard panning comfortable
        pos += step;
      }
      s.pos = pos;
    }
    for (let i = 0; i < n; i++) {
      this.yl += this.lp * (L[i] - this.yl);
      this.yr += this.lp * (R[i] - this.yr);
      L[i] = Math.max(-1, Math.min(1, this.yl * this.gain));
      R[i] = Math.max(-1, Math.min(1, this.yr * this.gain));
    }
    if (++this.tick >= this.speed * (1 + this.patDelay)) {
      this.tick = 0;
      if (this.loopTo >= 0) this.row = this.loopTo;
      else if (this.jump >= 0) {
        this.ord = this.jump;
        this.row = this.breakRow;
      } else if (this.breakRow >= 0) {
        this.ord++;
        this.row = this.breakRow;
      } else if (++this.row >= 64) {
        this.ord++;
        this.row = 0;
      }
    }
    return { left: L, right: R };
  }

  private end(): null {
    this.ended = true;
    return null;
  }

  /** The next `frames` samples (a little more, rounded up to whole ticks), or null when the song is over. */
  render(frames: number): Block | null {
    const ls: Float32Array[] = [];
    const rs: Float32Array[] = [];
    let total = 0;
    while (total < frames) {
      const t = this.nextTick();
      if (!t) break;
      ls.push(t.left);
      rs.push(t.right);
      total += t.left.length;
    }
    if (total === 0) return null;
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    let o = 0;
    for (let i = 0; i < ls.length; i++) {
      left.set(ls[i], o);
      right.set(rs[i], o);
      o += ls[i].length;
    }
    return { left, right };
  }
}

/**
 * Renders a whole song in one go. Only for tools and tests: it holds the entire song in memory, so the game itself
 * streams with `ModPlayer`. Returns the audio and the peak (so a gain that puts it at 0.9 can be worked out).
 */
export function renderMod(mod: Mod, rate = 44100, gain = 1, maxSeconds = 900): { left: Float32Array; right: Float32Array; rate: number; peak: number } {
  const p = new ModPlayer(mod, rate, gain);
  const parts: Block[] = [];
  let total = 0;
  for (;;) {
    const b = p.render(rate);
    if (!b || total > maxSeconds * rate) break;
    parts.push(b);
    total += b.left.length;
  }
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let o = 0;
  let peak = 0;
  for (const b of parts) {
    left.set(b.left, o);
    right.set(b.right, o);
    o += b.left.length;
    for (let i = 0; i < b.left.length; i++) peak = Math.max(peak, Math.abs(b.left[i]), Math.abs(b.right[i]));
  }
  return { left, right, rate, peak };
}
