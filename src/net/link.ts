/*
 * What the game needs from a connection to the other player, whatever carries it: a direct WebRTC connection (below)
 * or `net/relay.ts`, which passes messages through a public MQTT broker. `loopback` is an in-memory pair for tests.
 *
 * The direct connection has two data channels with fixed ids, so neither side waits for the other to announce them:
 * `ctl` (reliable, ordered: inputs and events) and `state` (unordered, no retransmits: snapshots, where only the
 * newest matters). Signalling (offer and answer) is carried by the relay, see `net/connect.ts`.
 */

export type Role = 'host' | 'guest';

/** A message on the wire: JSON with a type tag. Fields are checked where they are used. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = { t: string; [field: string]: any };

export interface Link {
  readonly role: Role;
  /** Send reliably, in order. Silently dropped when the link is down. */
  send(msg: unknown): void;
  /** Send something that is worthless once it is late (a snapshot); may be dropped. */
  sendFast(msg: unknown): void;
  /** Listen for incoming messages. Messages that arrive while nobody listens wait for the first listener. */
  onMessage(fn: (msg: Msg) => void): () => void;
  /** Called once when the link closes, on either side (at once if it already has). Returns a way to stop listening. */
  onClose(fn: () => void): () => void;
  readonly open: boolean;
  close(): void;
}

/** Fan-out for incoming messages. Reliable messages that arrive before the first listener are kept for it. */
export function hub() {
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

/* ---- direct connection --------------------------------------------------------------------------------------- */

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];

export const directAvailable = () => typeof RTCPeerConnection !== 'undefined';

/** Resolves once the browser has found all its network candidates (so the description is complete), or after a few seconds. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, 3000);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function makeLink(role: Role, pc: RTCPeerConnection, ctl: RTCDataChannel, state: RTCDataChannel): Link {
  const msgs = hub();
  const closers = new Set<() => void>();
  let closed = false;
  let grace = 0;
  const shut = () => {
    if (closed) return;
    closed = true;
    clearTimeout(grace);
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
  // 'disconnected' often heals by itself (a Wi-Fi hiccup, a throttled tab), so give it a few seconds
  pc.addEventListener('connectionstatechange', () => {
    clearTimeout(grace);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') shut();
    else if (pc.connectionState === 'disconnected') grace = window.setTimeout(shut, 6000);
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

export interface Direct {
  /** The session description to hand to the other side (through the relay). */
  sdp: string;
  /** Resolves with the link once both channels are open; rejects if the connection fails. */
  connected: Promise<Link>;
  cancel(): void;
}

function open(role: Role, pc: RTCPeerConnection, ctl: RTCDataChannel, state: RTCDataChannel): Promise<Link> {
  return new Promise((resolve, reject) => {
    const check = () => ctl.readyState === 'open' && state.readyState === 'open' && resolve(makeLink(role, pc, ctl, state));
    ctl.addEventListener('open', check);
    state.addEventListener('open', check);
    pc.addEventListener('connectionstatechange', () => pc.connectionState === 'failed' && reject(new Error('no direct route')));
    check();
  });
}

function pair(pc: RTCPeerConnection) {
  return {
    ctl: pc.createDataChannel('ctl', { negotiated: true, id: 0 }),
    state: pc.createDataChannel('state', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 }),
  };
}

/** Host: make an offer. Call `accept` with the guest's answer. */
export async function directHost(): Promise<Direct & { accept(answer: string): Promise<boolean> }> {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const { ctl, state } = pair(pc);
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const connected = open('host', pc, ctl, state);
  connected.catch(() => {}); // the caller decides what a failure means
  return {
    sdp: pc.localDescription!.sdp,
    connected,
    async accept(answer) {
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
        return true;
      } catch {
        return false;
      }
    },
    cancel: () => pc.close(),
  };
}

/** Guest: answer the host's offer, or null when it can't be used. */
export async function directJoin(offer: string): Promise<Direct | null> {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const { ctl, state } = pair(pc);
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
  } catch {
    pc.close();
    return null;
  }
  const connected = open('guest', pc, ctl, state);
  connected.catch(() => {});
  return { sdp: pc.localDescription!.sdp, connected, cancel: () => pc.close() };
}

/** Two linked ends in the same page, for testing without a network: `delayMs` each way, `loss` for the unreliable channel. */
export function loopback(delayMs = 0, loss = 0, jitterMs = 0): [Link, Link] {
  const hubs = [hub(), hub()];
  const closers = [new Set<() => void>(), new Set<() => void>()];
  let down = false;
  const shut = () => {
    if (down) return;
    down = true;
    closers.forEach((c) => [...c].forEach((f) => f()));
  };
  const end = (role: Role, me: number): Link => {
    let lastAt = 0; // a real connection keeps order: a message never overtakes one sent before it
    const deliver = (msg: unknown, fast: boolean) => {
      if (down || (fast && Math.random() < loss)) return;
      const copy = JSON.parse(JSON.stringify(msg));
      const at = Math.max(lastAt, Date.now() + delayMs + Math.random() * jitterMs);
      lastAt = at;
      setTimeout(() => {
        if (down) return;
        if (copy.t === 'bye') shut();
        else hubs[1 - me].emit(copy);
      }, Math.max(0, at - Date.now()));
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
