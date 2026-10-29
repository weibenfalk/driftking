/*
 * What the game needs from a connection to the other player, whatever carries it: `net/relay.ts` passes messages
 * through a public MQTT broker. `loopback` is an in-memory pair for tests.
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
