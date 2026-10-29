/**
 * A tiny virtual joystick: four directions plus A and B.
 * Keyboard and the on-screen pad both feed the same state, so games never
 * need to know which one the player uses.
 */
export type Button = 'up' | 'down' | 'left' | 'right' | 'a' | 'b';

export const BUTTONS: Button[] = ['up', 'down', 'left', 'right', 'a', 'b'];

const KEYMAP: Record<string, Button> = {
  ArrowUp: 'up',
  w: 'up',
  W: 'up',
  ArrowDown: 'down',
  s: 'down',
  S: 'down',
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
  ' ': 'a',
  x: 'a',
  X: 'a',
  j: 'a',
  J: 'a',
  z: 'b',
  Z: 'b',
  k: 'b',
  K: 'b',
  Shift: 'b',
};

export class Input {
  private keys = new Set<Button>();
  private virtual = new Set<Button>();
  private presses = new Map<Button, number>();
  private attached = false;

  private onKeyDown = (e: KeyboardEvent) => {
    const b = KEYMAP[e.key];
    if (!b) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (!e.repeat) this.bump(b);
    this.keys.add(b);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const b = KEYMAP[e.key];
    if (b) this.keys.delete(b);
  };

  private onBlur = () => {
    this.keys.clear();
    this.virtual.clear();
  };

  private bump(b: Button) {
    this.presses.set(b, (this.presses.get(b) ?? 0) + 1);
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.onBlur();
    this.presses.clear();
  }

  /** Is the button held right now? */
  down(b: Button): boolean {
    return this.keys.has(b) || this.virtual.has(b);
  }

  /** Was the button pressed since the last call? Consumes one press. */
  pressed(b: Button): boolean {
    const n = this.presses.get(b) ?? 0;
    if (n > 0) {
      this.presses.set(b, n - 1);
      return true;
    }
    return false;
  }

  /** -1, 0 or 1 from left/right. */
  axisX(): number {
    return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
  }

  /** -1, 0 or 1 from up/down. */
  axisY(): number {
    return (this.down('down') ? 1 : 0) - (this.down('up') ? 1 : 0);
  }

  /** Forget queued presses (e.g. presses made during the countdown). */
  clearPresses() {
    this.presses.clear();
  }

  /** On-screen pad. */
  virtualDown(b: Button) {
    if (!this.virtual.has(b)) this.bump(b);
    this.virtual.add(b);
  }

  virtualUp(b: Button) {
    this.virtual.delete(b);
  }
}
