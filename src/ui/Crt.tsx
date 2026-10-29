import type { ReactNode } from 'react';

/** The 320x200 canvas frame: scales crisply, and the optional scanline overlay (see index.css) lines up with source pixels. */
export default function Crt({ children }: { children: ReactNode }) {
  return (
    <main className="stage">
      <div className="crt">{children}</div>
    </main>
  );
}
