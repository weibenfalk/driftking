import type { Mode } from '../game/economy';
import type { Save } from '../game/save';
import type { Track } from '../race/track';
import { allTracks } from '../race/tracks';
import { rowFor } from './rows';
import { Header } from './ui';

const isDaily = (t: Track) => t.id.startsWith('daily-');

const TITLES: Record<Mode, string> = { race: 'FREE RACE', attack: 'TIME ATTACK', drift: 'DRIFT CHALLENGE' };

interface Props {
  mode: Mode;
  save: Save;
  onPick: (t: Track) => void;
  onBack: () => void;
}

export default function FreeRace({ mode, save, onPick, onBack }: Props) {
  const tracks = allTracks();
  const groups = [...new Set(tracks.map((t) => (isDaily(t) ? 'DAILY' : t.env)))];
  return (
    <main className="screen">
      <Header title={TITLES[mode]} onBack={onBack} />
      <div className="list">
        {groups.map((g) => (
          <section key={g} className="cup">
            <h2>{g}</h2>
            {tracks.filter((t) => (isDaily(t) ? 'DAILY' : t.env) === g).map((t) => rowFor(mode, save, t, () => onPick(t)))}
          </section>
        ))}
      </div>
    </main>
  );
}
