import type { Save } from '../game/save';
import type { Track } from '../race/track';
import { allTracks } from '../race/tracks';
import { Header, TrackRow } from './ui';

const isDaily = (t: Track) => t.id.startsWith('daily-');

export default function FreeRace({ save, onPick, onBack }: { save: Save; onPick: (t: Track) => void; onBack: () => void }) {
  const tracks = allTracks();
  const groups = [...new Set(tracks.map((t) => (isDaily(t) ? 'DAILY' : t.env)))];
  return (
    <main className="screen">
      <Header title="FREE RACE" onBack={onBack} />
      <div className="list">
        {groups.map((g) => (
          <section key={g} className="cup">
            <h2>{g}</h2>
            {tracks
              .filter((t) => (isDaily(t) ? 'DAILY' : t.env) === g)
              .map((t) => (
                <TrackRow key={t.id} track={t} best={save.best[t.id]} onPick={() => onPick(t)} />
              ))}
          </section>
        ))}
      </div>
    </main>
  );
}
