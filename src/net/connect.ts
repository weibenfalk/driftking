/*
 * From a paired relay link to the best link available: both sides try a direct WebRTC connection, with the offer and
 * answer carried over the relay, and keep the relay if that does not work out in a few seconds. The host decides and
 * says so (`path`), so both always end up on the same kind of link.
 */
import { directAvailable, directHost, directJoin } from './link';
import type { Direct, Link } from './link';

/** Seconds to wait for the direct connection before giving up on it. */
const WAIT = 6;

const after = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

export interface Upgraded {
  link: Link;
  direct: boolean;
}

export async function upgrade(relay: Link): Promise<Upgraded> {
  const stay: Upgraded = { link: relay, direct: false };
  return relay.role === 'host' ? hostSide(relay, stay) : guestSide(relay, stay);
}

async function hostSide(relay: Link, stay: Upgraded): Promise<Upgraded> {
  if (!directAvailable()) {
    relay.send({ t: 'path', direct: false });
    return stay;
  }
  let off = () => {};
  try {
    const d = await directHost();
    off = relay.onMessage((m) => m.t === 'rtc-answer' && void d.accept(m.sdp));
    relay.send({ t: 'rtc', sdp: d.sdp });
    const gone = new Promise<null>((r) => relay.onClose(() => r(null)));
    const link = await Promise.race([d.connected.catch(() => null), after(WAIT * 1000, null), gone]);
    off();
    relay.send({ t: 'path', direct: !!link });
    if (!link) {
      d.cancel();
      return stay;
    }
    setTimeout(() => relay.close(), 1500); // the guest is told first, then the relay is no longer needed
    return { link, direct: true };
  } catch (e) {
    console.warn('direct connection not possible', e);
    off();
    relay.send({ t: 'path', direct: false });
    return stay;
  }
}

async function guestSide(relay: Link, stay: Upgraded): Promise<Upgraded> {
  const box: { answer?: Promise<Direct | null> } = {};
  const decision = new Promise<boolean>((resolve) => {
    const off = relay.onMessage((m) => {
      if (m.t === 'rtc' && directAvailable()) {
        box.answer = directJoin(m.sdp).then((j) => {
          if (j) relay.send({ t: 'rtc-answer', sdp: j.sdp });
          return j;
        });
      } else if (m.t === 'path') {
        off();
        resolve(!!m.direct);
      }
    });
    setTimeout(() => (off(), resolve(false)), (WAIT + 6) * 1000);
    relay.onClose(() => resolve(false));
  });
  const direct = await decision;
  const j = await box.answer;
  if (!direct || !j) {
    j?.cancel();
    return stay;
  }
  const link = await Promise.race([j.connected.catch(() => null), after(4000, null)]);
  if (!link) {
    j.cancel();
    return stay;
  }
  relay.close();
  return { link, direct: true };
}
