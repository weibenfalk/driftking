import type { CSSProperties } from 'react';

/** On-screen driving buttons for touch screens. They send the same key events the keyboard does, so the race can't tell. */
const BUTTONS: { label: string; key: string; style: CSSProperties }[] = [
  { label: '<', key: 'ArrowLeft', style: { left: 10, bottom: 12 } },
  { label: '>', key: 'ArrowRight', style: { left: 86, bottom: 12 } },
  { label: 'GAS', key: 'ArrowUp', style: { right: 10, bottom: 82 } },
  { label: 'BRAKE', key: 'ArrowDown', style: { right: 10, bottom: 12 } },
  { label: 'DRIFT', key: ' ', style: { right: 92, bottom: 12 } },
];

const base: CSSProperties = {
  position: 'fixed',
  width: 68,
  height: 62,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  font: 'bold 13px monospace',
  color: '#fff',
  background: 'rgba(34,34,102,.55)',
  border: '2px solid',
  borderColor: '#aab #113 #113 #aab',
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

const send = (type: 'keydown' | 'keyup', key: string) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));

export default function TouchPad({ onMenu }: { onMenu: () => void }) {
  return (
    <>
      {BUTTONS.map((b) => (
        <div
          key={b.key}
          style={{ ...base, ...b.style }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            send('keydown', b.key);
          }}
          onPointerUp={() => send('keyup', b.key)}
          onPointerCancel={() => send('keyup', b.key)}
        >
          {b.label}
        </div>
      ))}
      <div style={{ ...base, right: 10, top: 8, width: 56, height: 28 }} onPointerDown={onMenu}>
        MENU
      </div>
    </>
  );
}
