/*
 * A link through a public MQTT broker: free, no account, works behind any NAT. The host makes a short room code, the
 * guest types it, and from then on messages go through the broker (a little slower than a direct connection, which
 * `net/link.ts` is used for when it works). Everything is plain text on a topic only the two players know, but it
 * is a public broker, so don't send anything secret.
 */
import { hub } from './link';
import type { Link, Msg, Role } from './link';
import { connectMqtt } from './mqtt';
import type { Mqtt } from './mqtt';

/** Public brokers with WebSocket support, tried in order. The first character of a room code says which one. */
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
/** Seconds of silence after which the other side counts as gone. */
const SILENCE = 8;

export interface Room {
  /** The code to tell the friend (host only). */
  code: string;
  /** Resolves with the link once the other player is in. Rejects if the room could not be reached. */
  connected: Promise<Link>;
  cancel(): void;
}

const topics = (code: string) => ({ toHost: `driftking/v1/${code}/h`, toGuest: `driftking/v1/${code}/g` });
const norm = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function openBroker(first: number): Promise<{ mqtt: Mqtt; index: number }> {
  let err: unknown;
  for (let k = 0; k < BROKERS.length; k++) {
    const index = (first + k) % BROKERS.length;
    try {
      return { mqtt: await connectMqtt(BROKERS[index]), index };
    } catch (e) {
      err = e;
    }
  }
  throw err instanceof Error ? err : new Error('could not reach the relay');
}

function makeRelayLink(role: Role, mqtt: Mqtt, out: string, inn: string): Link {
  const msgs = hub();
  const closers = new Set<() => void>();
  let closed = false;
  let last = Date.now();
  const send = (msg: unknown) => !closed && mqtt.publish(out, JSON.stringify(msg));
  const beat = window.setInterval(() => {
    mqtt.publish(out, JSON.stringify({ t: 'hb' }));
    if (Date.now() - last > SILENCE * 1000) shut();
  }, 2000);
  const shut = () => {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    [...closers].forEach((f) => f());
    closers.clear();
    mqtt.close();
  };
  mqtt.onClose(shut);
  void mqtt.subscribe(inn, (text) => {
    last = Date.now();
    try {
      const m = JSON.parse(text) as Msg;
      if (m.t === 'hi' && role === 'host') send({ t: 'ack' }); // the guest's first ack may have been missed
      if (m.t === 'bye') shut();
      else if (m.t !== 'hb' && m.t !== 'hi' && m.t !== 'ack') msgs.emit(m);
    } catch (e) {
      console.error(e);
    }
  });
  return {
    role,
    get open() {
      return !closed && mqtt.open;
    },
    send,
    sendFast: send,
    onMessage: msgs.on,
    onClose(fn) {
      if (closed) fn();
      else closers.add(fn);
      return () => void closers.delete(fn);
    },
    close() {
      send({ t: 'bye' });
      shut();
    },
  };
}

/** Host: open a room and wait for one guest. */
export async function hostRoom(): Promise<Room> {
  const first = Math.floor(Math.random() * BROKERS.length);
  const { mqtt, index } = await openBroker(first);
  let code = String(index + 1);
  for (let i = 0; i < 5; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  const t = topics(code);
  const connected = new Promise<Link>((resolve, reject) => {
    let paired = false;
    mqtt.onClose(() => !paired && reject(new Error('lost the relay')));
    void mqtt.subscribe(t.toHost, (text) => {
      if (paired || !text.includes('"hi"')) return;
      paired = true;
      mqtt.publish(t.toGuest, JSON.stringify({ t: 'ack' }));
      resolve(makeRelayLink('host', mqtt, t.toGuest, t.toHost));
    });
  });
  return { code, connected, cancel: () => mqtt.close() };
}

/** Guest: join a room by its code. Returns null when the code is not a room code. */
export async function joinRoom(raw: string): Promise<Room | null> {
  const code = norm(raw);
  const index = Number(code[0]) - 1;
  if (code.length !== 6 || !(index >= 0 && index < BROKERS.length)) return null;
  const mqtt = await connectMqtt(BROKERS[index]);
  const t = topics(code);
  const connected = new Promise<Link>((resolve, reject) => {
    let done = false;
    let knock = 0;
    const giveUp = window.setTimeout(() => {
      if (done) return;
      clearInterval(knock);
      reject(new Error('NO ONE IS HOSTING THAT ROOM'));
      mqtt.close();
    }, 10000);
    mqtt.onClose(() => !done && reject(new Error('lost the relay')));
    void mqtt
      .subscribe(t.toGuest, (text) => {
        if (done || !text.includes('"ack"')) return;
        done = true;
        clearInterval(knock);
        clearTimeout(giveUp);
        resolve(makeRelayLink('guest', mqtt, t.toHost, t.toGuest));
      })
      .then(() => {
        // knock until the host answers (it may not have seen the first one)
        const hi = () => mqtt.publish(t.toHost, JSON.stringify({ t: 'hi' }));
        hi();
        knock = window.setInterval(hi, 1000);
      });
  });
  return { code, connected, cancel: () => mqtt.close() };
}

export const normaliseRoom = norm;
