/*
 * A two-player connection over WebRTC with no server of our own: the players swap two codes (offer and answer) by
 * hand, e.g. through a chat. Once paired, game data goes straight between the browsers.
 *
 * Two data channels with fixed ids, so neither side has to wait for the other to announce them:
 *  - `ctl` (reliable, ordered): inputs and events
 *  - `state` (unordered, no retransmits): host snapshots, where the newest one is all that matters
 */

/**
 * Public STUN finds each side's outside address. A TURN relay (for networks where no direct route exists) is added
 * when VITE_TURN_URL, VITE_TURN_USER and VITE_TURN_PASS are set at build time; URLs may be comma separated.
 */
const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const turn = import.meta.env.VITE_TURN_URL as string | undefined;
if (turn) ICE.push({ urls: turn.split(',').map((u) => u.trim()), username: import.meta.env.VITE_TURN_USER as string, credential: import.meta.env.VITE_TURN_PASS as string });
const OFFER_PREFIX = 'DKO1-';
const ANSWER_PREFIX = 'DKA1-';

export type Role = 'host' | 'guest';

/** A message on the wire: JSON with a type tag. Fields are checked where they are used. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = { t: string; [field: string]: any };

export interface Link {
  readonly role: Role;
  /** Send on the reliable channel. Silently dropped when the link is down. */
  send(msg: unknown): void;
  /** Send on the unreliable channel (dropped when the link is busy or down). */
  sendFast(msg: unknown): void;
  /** Listen for incoming messages (either channel). Messages that arrive while nobody listens wait for the first listener. */
  onMessage(fn: (msg: Msg) => void): () => void;
  /** Called once when the link closes, on either side (at once if it already has). Returns a way to stop listening. */
  onClose(fn: () => void): () => void;
  readonly open: boolean;
  close(): void;
}

/* ---- codes --------------------------------------------------------------------------------------------------- */

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pump(input: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([input as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

async function pack(prefix: string, desc: RTCSessionDescriptionInit): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
  return prefix + b64(await pump(raw, new CompressionStream('deflate-raw')));
}

async function unpack(prefix: string, code: string): Promise<RTCSessionDescriptionInit | null> {
  const c = code.trim().replace(/\s+/g, '');
  if (!c.startsWith(prefix)) return null;
  try {
    const raw = await pump(unb64(c.slice(prefix.length)), new DecompressionStream('deflate-raw'));
    const d = JSON.parse(new TextDecoder().decode(raw));
    return typeof d.s === 'string' && (d.t === 'offer' || d.t === 'answer') ? { type: d.t, sdp: d.s } : null;
  } catch {
    return null;
  }
}

/** Resolves once the browser has found all its network candidates (so the code is complete), or after a few seconds. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, 4000);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/* ---- the link ------------------------------------------------------------------------------------------------ */

/** Fan-out for incoming messages. Reliable messages that arrive before the first listener are kept for it. */
function hub() {
  const subs = new Set<(m: Msg) => void>();
  const backlog: Msg[] = [];
  return {
    emit(m: Msg) {
      if (subs.size) [...subs].forEach((f) => f(m));
      else if (m.t !== 'snap' && backlog.length < 200) backlog.push(m);
    },
    on(fn: (m: Msg) => void) {
      subs.add(fn);
      backlog.splice(0).forEach(fn);
      return () => void subs.delete(fn);
    },
  };
}

function makeLink(role: Role, pc: RTCPeerConnection, ctl: RTCDataChannel, state: RTCDataChannel): Link {
  const msgs = hub();
  const closers = new Set<() => void>();
  let closed = false;
  const shut = () => {
    if (closed) return;
    closed = true;
    [...closers].forEach((f) => f());
    closers.clear();
    try {
      pc.close();
    } catch {
      /* already closed */
    }
  };
  const recv = (e: MessageEvent) => {
    try {
      const m = JSON.parse(e.data);
      if (m.t === 'bye') shut();
      else msgs.emit(m);
    } catch (err) {
      console.error(err);
    }
  };
  ctl.onmessage = recv;
  state.onmessage = recv;
  ctl.onclose = shut;
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') shut();
  });
  return {
    role,
    get open() {
      return !closed && ctl.readyState === 'open';
    },
    send(msg) {
      if (!closed && ctl.readyState === 'open') ctl.send(JSON.stringify(msg));
    },
    sendFast(msg) {
      // never let snapshots pile up in a slow connection: a late one is worse than none
      if (!closed && state.readyState === 'open' && state.bufferedAmount < 16000) state.send(JSON.stringify(msg));
    },
    onMessage: msgs.on,
    onClose(fn) {
      if (closed) fn();
      else closers.add(fn);
      return () => void closers.delete(fn);
    },
    close() {
      if (!closed && ctl.readyState === 'open') ctl.send(JSON.stringify({ t: 'bye' }));
      shut();
    },
  };
}

function channels(pc: RTCPeerConnection) {
  return {
    ctl: pc.createDataChannel('ctl', { negotiated: true, id: 0 }),
    state: pc.createDataChannel('state', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 }),
  };
}

export interface Pending {
  /** Resolves with the code to give the other player. */
  code: string;
  /** Resolves with the link once both channels are open. */
  connected: Promise<Link>;
  cancel(): void;
}

/** Why a connection failed, in a few words: which kinds of network address each side found. */
function why(pc: RTCPeerConnection): string {
  const kinds = (sdp?: string | null) => ({ srflx: /typ srflx/.test(sdp ?? ''), relay: /typ relay/.test(sdp ?? '') });
  const mine = kinds(pc.localDescription?.sdp);
  const theirs = kinds(pc.remoteDescription?.sdp);
  if (!mine.srflx && !mine.relay) return 'NO PUBLIC ADDRESS FOUND FOR YOU (STUN BLOCKED?)';
  if (!theirs.srflx) return 'NO PUBLIC ADDRESS FOUND FOR THE OTHER PLAYER';
  return 'NO DIRECT ROUTE (STRICT NAT OR FIREWALL)';
}

const whenOpen = (pc: RTCPeerConnection, ch: RTCDataChannel[]) =>
  new Promise<void>((resolve, reject) => {
    const check = () => ch.every((c) => c.readyState === 'open') && resolve();
    ch.forEach((c) => c.addEventListener('open', check));
    pc.addEventListener('connectionstatechange', () => {
      console.log('webrtc', pc.connectionState, pc.iceConnectionState);
      if (pc.connectionState === 'failed') reject(new Error(why(pc)));
    });
    check();
  });

export const webrtcAvailable = () => typeof RTCPeerConnection !== 'undefined' && typeof CompressionStream !== 'undefined';

/** Host, step 1: make the offer code. After the guest's answer code comes back, call `accept` on the result. */
export async function host(): Promise<Pending & { accept(answer: string): Promise<boolean> }> {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const { ctl, state } = channels(pc);
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = await pack(OFFER_PREFIX, pc.localDescription!);
  const opened = whenOpen(pc, [ctl, state]);
  return {
    code,
    connected: opened.then(() => makeLink('host', pc, ctl, state)),
    async accept(answer) {
      const d = await unpack(ANSWER_PREFIX, answer);
      if (!d || d.type !== 'answer') return false;
      try {
        await pc.setRemoteDescription(d);
        return true;
      } catch {
        return false;
      }
    },
    cancel: () => pc.close(),
  };
}

/** Guest: turn the host's offer code into an answer code, or null when the offer is not a valid code. */
export async function join(offer: string): Promise<Pending | null> {
  const d = await unpack(OFFER_PREFIX, offer);
  if (!d || d.type !== 'offer') return null;
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const { ctl, state } = channels(pc);
  try {
    await pc.setRemoteDescription(d);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
  } catch {
    pc.close();
    return null;
  }
  const code = await pack(ANSWER_PREFIX, pc.localDescription!);
  const opened = whenOpen(pc, [ctl, state]);
  return { code, connected: opened.then(() => makeLink('guest', pc, ctl, state)), cancel: () => pc.close() };
}

/** Two linked ends in the same page, for testing without a network: `delayMs` each way, `loss` for the unreliable channel. */
export function loopback(delayMs = 0, loss = 0): [Link, Link] {
  const hubs = [hub(), hub()];
  const closers = [new Set<() => void>(), new Set<() => void>()];
  let down = false;
  const shut = () => {
    if (down) return;
    down = true;
    closers.forEach((c) => [...c].forEach((f) => f()));
  };
  const end = (role: Role, me: number): Link => {
    const deliver = (msg: unknown, fast: boolean) => {
      if (down || (fast && Math.random() < loss)) return;
      const copy = JSON.parse(JSON.stringify(msg));
      setTimeout(() => {
        if (down) return;
        if (copy.t === 'bye') shut();
        else hubs[1 - me].emit(copy);
      }, delayMs);
    };
    return {
      role,
      get open() {
        return !down;
      },
      send: (m) => deliver(m, false),
      sendFast: (m) => deliver(m, true),
      onMessage: hubs[me].on,
      onClose(fn) {
        if (down) fn();
        else closers[me].add(fn);
        return () => void closers[me].delete(fn);
      },
      close() {
        deliver({ t: 'bye' }, false);
        shut();
      },
    };
  };
  return [end('host', 0), end('guest', 1)];
}
