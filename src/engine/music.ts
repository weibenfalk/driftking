import { audio } from './audio';
import { ModPlayer, parseMod } from './mod';
import type { Mod } from './mod';

/*
 * Background music from real .mod files in public/music, streamed: a song is rendered a few seconds at a time and
 * queued on the audio clock, so even a ten-minute module needs only a few seconds of audio in memory. Songs play
 * either one at a time (looping) or as a playlist; the master gain applies, so mute and volume affect it too.
 *
 * To add a song: put the .mod in public/music and add it to SONGS. For `gain`, render it with `renderMod`
 * (engine/mod.ts) at a low gain, measure its RMS and peak per unit of gain, and use the smaller of 0.13 / rms and
 * 0.95 / peak: that gives every song about the same loudness without clipping.
 */

export interface SongInfo {
  id: string;
  title: string;
  /** Who made it, or an empty string when the file doesn't say (the credit line then shows only the title). */
  artist: string;
  /** Mix gain that brings the song to a common loudness. */
  gain: number;
}

export const SONGS: SongInfo[] = [
  { id: 'space-deliria', title: 'SPACE DELIRIA', artist: 'DR AWESOME', gain: 0.517 },
  { id: 'cosmos', title: 'COSMOS', artist: 'DR AWESOME', gain: 0.632 },
  { id: 'bridge_to_the', title: 'BRIDGE TO THE', artist: 'DR AWESOME', gain: 0.577 },
  { id: 'cru-eagle', title: 'CRU-EAGLE', artist: 'DR AWESOME', gain: 0.316 },
  { id: 'alien_atmosphere', title: 'ALIEN ATMOSPHERE', artist: '', gain: 0.689 },
  { id: 'cooking_it_up', title: 'COOKING IT UP', artist: '', gain: 0.412 },
  { id: 'duet-guitar-flute', title: 'DUET GUITAR FLUTE', artist: '', gain: 1.32 },
  { id: 'intromusic4_b', title: 'INTRO MUSIC 4', artist: '', gain: 0.44 },
];

/** Setting value meaning "play every song in turn". */
export const ALL = 'all';

const RATE = 32000;
const BLOCK = 4 * RATE; // render four seconds at a time
const LEAD = 12; // keep this many seconds queued ahead of the audio clock

const base = import.meta.env.BASE_URL;
const mods = new Map<string, Promise<Mod | null>>();

function loadMod(id: string): Promise<Mod | null> {
  let p = mods.get(id);
  if (!p) {
    p = fetch(`${base}music/${id}.mod`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? parseMod(b) : null))
      .catch((e) => {
        console.error(`music ${id}:`, e);
        return null;
      });
    mods.set(id, p);
  }
  return p;
}

interface Stream {
  gain: GainNode;
  song: SongInfo;
  player: ModPlayer | null;
  nextStart: number;
  /** When each song's first block starts on the audio clock, for "now playing". */
  segments: { start: number; song: SongInfo }[];
  sources: AudioBufferSourceNode[];
  timer: number;
  busy: boolean;
  stopped: boolean;
}

let stream: Stream | null = null;
let enabled = true;
let choice = ALL;
let level = 0.5;

const songFor = (id: string) => SONGS.find((s) => s.id === id);
const nextSong = (s: SongInfo) => (choice === ALL ? SONGS[(SONGS.indexOf(s) + 1) % SONGS.length] : s);

function stopStream() {
  const s = stream;
  if (!s) return;
  stream = null;
  s.stopped = true;
  window.clearInterval(s.timer);
  const ctx = audio.ctx;
  if (!ctx) return;
  s.gain.gain.cancelScheduledValues(ctx.currentTime);
  s.gain.gain.setValueAtTime(s.gain.gain.value, ctx.currentTime);
  s.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
  for (const src of s.sources) {
    try {
      src.stop(ctx.currentTime + 0.45);
    } catch {
      /* already finished */
    }
  }
}

/** Renders and queues blocks until `LEAD` seconds are waiting; moves to the next song when one ends. */
async function pump(s: Stream) {
  const ctx = audio.ctx;
  if (!ctx || s.busy || s.stopped) return;
  s.busy = true;
  try {
    while (!s.stopped && s.nextStart - ctx.currentTime < LEAD) {
      if (!s.player) {
        const mod = await loadMod(s.song.id);
        if (s.stopped) return;
        if (!mod) return;
        s.player = new ModPlayer(mod, RATE, s.song.gain);
        s.segments.push({ start: s.nextStart, song: s.song });
      }
      const block = s.player.render(BLOCK);
      if (!block) {
        // song over: play the next one (or the same again)
        s.song = nextSong(s.song);
        s.player = null;
        continue;
      }
      const buf = ctx.createBuffer(2, block.left.length, RATE);
      buf.copyToChannel(block.left, 0);
      buf.copyToChannel(block.right, 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(s.gain);
      src.start(s.nextStart);
      src.onended = () => {
        s.sources = s.sources.filter((x) => x !== src);
      };
      s.sources.push(src);
      s.nextStart += block.left.length / RATE;
      // forget segments that finished long ago
      while (s.segments.length > 2 && s.segments[1].start < ctx.currentTime) s.segments.shift();
    }
  } finally {
    s.busy = false;
  }
}

function begin() {
  const ctx = audio.ctx;
  const out = audio.out;
  if (!ctx || !out) return;
  stopStream();
  const song = songFor(choice) ?? SONGS[0];
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.8);
  gain.connect(out);
  const s: Stream = { gain, song, player: null, nextStart: ctx.currentTime + 0.1, segments: [], sources: [], timer: 0, busy: false, stopped: false };
  s.timer = window.setInterval(() => void pump(s), 1000);
  stream = s;
  void pump(s);
}

export const music = {
  /**
   * Applies the music settings: whether it plays, and what (a song id, or `ALL` for the whole playlist). Starts or
   * restarts the stream only when something changed.
   */
  configure(on: boolean, which: string) {
    const nextChoice = which === ALL || songFor(which) ? which : ALL;
    const changed = nextChoice !== choice;
    choice = nextChoice;
    enabled = on;
    if (!on) stopStream();
    else if (changed || !stream) begin();
  },
  /** The song audible right now (or about to be), for the credit line. */
  current(): SongInfo {
    const ctx = audio.ctx;
    const s = stream;
    if (!s || !ctx) return songFor(choice) ?? SONGS[0];
    let cur = s.segments[0]?.song ?? s.song;
    for (const seg of s.segments) if (seg.start <= ctx.currentTime) cur = seg.song;
    return cur;
  },
  isPlaying() {
    return enabled && !!stream;
  },
  /** 0..1 */
  setVolume(v: number) {
    level = Math.min(1, Math.max(0, v));
    if (stream && audio.ctx) stream.gain.gain.setTargetAtTime(level, audio.ctx.currentTime, 0.05);
  },
};
