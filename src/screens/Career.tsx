import { CUPS, UNLOCK_POINTS, cupPoints, cupTracks, cupUnlocked } from '../game/career';
import type { Save } from '../game/save';
import type { Track } from '../race/track';
import { rowFor } from './rows';
import { Header } from './ui';

export default function Career({ save, onPick, onBack }: { save: Save; onPick: (t: Track) => void; onBack: () => void }) {
  return (
    <main className="screen">
      <Header title="CAREER" onBack={onBack} />
      <div className="list">
        {CUPS.map((cup, i) => {
          const open = cupUnlocked(save, i);
          return (
            <section key={cup.id} className={open ? 'cup' : 'cup locked'}>
              <h2>
                {cup.name} <span>{open ? `${cupPoints(save, cup)}/12 POINTS` : `LOCKED: ${UNLOCK_POINTS} POINTS IN ${CUPS[i - 1].name}`}</span>
              </h2>
              {cupTracks(cup).map((t) => rowFor('race', save, t, () => onPick(t), !open))}
            </section>
          );
        })}
      </div>
    </main>
  );
}
