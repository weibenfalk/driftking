/*
 * The smallest MQTT 3.1.1 client that does the job: connect over a WebSocket, subscribe, publish at QoS 0. Public MQTT
 * brokers are free and need no account, so two players can find each other (and, when no direct route exists, pass the
 * game's messages) through one. Nothing here is specific to the game.
 */

export interface Mqtt {
  /** Sends `text` to everyone subscribed to `topic`. */
  publish(topic: string, text: string): void;
  /** Resolves once the broker has confirmed the subscription. `fn` gets the text of every message on it. */
  subscribe(topic: string, fn: (text: string) => void): Promise<void>;
  readonly open: boolean;
  /** Bytes waiting to be sent: grows when the connection is slower than what we send. */
  readonly buffered: number;
  onClose(fn: () => void): void;
  close(): void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const str = (s: string) => {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
};

/** A packet: first byte, then the "remaining length" in 7-bit groups, then the body. */
function packet(first: number, body: number[] | Uint8Array): Uint8Array {
  const len: number[] = [];
  let n = body.length;
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    len.push(d);
  } while (n > 0);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = first;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
}

export function connectMqtt(url: string, timeoutMs = 6000): Promise<Mqtt> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, 'mqtt');
    } catch (e) {
      return reject(e);
    }
    ws.binaryType = 'arraybuffer';
    let up = false;
    let closed = false;
    let nextId = 1;
    let buf = new Uint8Array(0);
    const topics = new Map<string, (text: string) => void>();
    const acks = new Map<number, () => void>();
    const closers: (() => void)[] = [];
    let ping = 0;

    const shut = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      clearTimeout(timer);
      closers.splice(0).forEach((f) => f());
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
    const timer = setTimeout(() => {
      if (!up) {
        reject(new Error('broker did not answer'));
        shut();
      }
    }, timeoutMs);

    const mqtt: Mqtt = {
      get open() {
        return up && !closed && ws.readyState === WebSocket.OPEN;
      },
      get buffered() {
        return ws.bufferedAmount;
      },
      publish(topic, text) {
        if (mqtt.open) ws.send(packet(0x30, [...str(topic), ...enc.encode(text)]));
      },
      subscribe(topic, fn) {
        topics.set(topic, fn);
        return new Promise((res) => {
          const id = nextId++;
          acks.set(id, res);
          ws.send(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
        });
      },
      onClose(fn) {
        if (closed) fn();
        else closers.push(fn);
      },
      close() {
        if (mqtt.open) ws.send(packet(0xe0, []));
        shut();
      },
    };

    ws.onopen = () => ws.send(packet(0x10, [...str('MQTT'), 4, 2, 0, 30, ...str(`dk${Math.random().toString(36).slice(2, 10)}`)]));
    ws.onerror = () => {
      if (!up) reject(new Error('could not reach the broker'));
      shut();
    };
    ws.onclose = shut;
    ws.onmessage = (e) => {
      const more = new Uint8Array(e.data as ArrayBuffer);
      const all = new Uint8Array(buf.length + more.length);
      all.set(buf);
      all.set(more, buf.length);
      buf = all;
      // a WebSocket message may hold several packets, or part of one
      for (;;) {
        if (buf.length < 2) return;
        let len = 0;
        let mult = 1;
        let i = 1;
        let d: number;
        do {
          if (i >= buf.length) return;
          d = buf[i++];
          len += (d & 127) * mult;
          mult *= 128;
        } while (d & 128);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4;
        const qos = (buf[0] >> 1) & 3;
        const body = buf.slice(i, i + len);
        buf = buf.slice(i + len);
        if (type === 2) {
          // CONNACK: the second byte is the result, 0 = accepted
          if (body[1] !== 0) {
            reject(new Error(`broker refused (${body[1]})`));
            return shut();
          }
          up = true;
          clearTimeout(timer);
          ping = window.setInterval(() => mqtt.open && ws.send(packet(0xc0, [])), 20000);
          resolve(mqtt);
        } else if (type === 9) {
          const id = (body[0] << 8) | body[1];
          acks.get(id)?.();
          acks.delete(id);
        } else if (type === 3) {
          const tl = (body[0] << 8) | body[1];
          const topic = dec.decode(body.slice(2, 2 + tl));
          topics.get(topic)?.(dec.decode(body.slice(2 + tl + (qos ? 2 : 0))));
        }
      }
    };
  });
}
