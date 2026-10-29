import { useState } from 'react';
import { medalFor, nextCareerTrack } from './game/career';
import { loadSave, withResult, writeSave } from './game/save';
import type { Save } from './game/save';
import type { Track } from './race/track';
import { allTracks, findTrack } from './race/tracks';
import Career from './screens/Career';
import FreeRace from './screens/FreeRace';
import Menu from './screens/Menu';
import RaceScreen from './screens/RaceScreen';

type Screen = { k: 'menu' } | { k: 'career' } | { k: 'free' } | { k: 'race'; track: Track; from: 'career' | 'free' | 'menu' };

const daily = () => allTracks().find((t) => t.id.startsWith('daily-'))!;

export default function App() {
  const [save, setSave] = useState<Save>(loadSave);
  const [screen, setScreen] = useState<Screen>(() => {
    // ?track=<id> (or ?track=daily) jumps straight into a race
    const id = new URLSearchParams(location.search).get('track');
    const t = id === 'daily' ? daily() : id ? findTrack(id) : undefined;
    return t ? { k: 'race', track: t, from: 'menu' } : { k: 'menu' };
  });

  const race = (track: Track, from: 'career' | 'free' | 'menu') => setScreen({ k: 'race', track, from });

  if (screen.k === 'career') return <Career save={save} onPick={(t) => race(t, 'career')} onBack={() => setScreen({ k: 'menu' })} />;
  if (screen.k === 'free') return <FreeRace save={save} onPick={(t) => race(t, 'free')} onBack={() => setScreen({ k: 'menu' })} />;
  if (screen.k === 'race') {
    const { from } = screen;
    return (
      <RaceScreen
        track={screen.track}
        onRecord={(track, raw) => {
          const medal = medalFor(track, raw);
          const r = withResult(save, track.id, raw, medal);
          setSave(r.save);
          writeSave(r.save);
          return { medal, isBest: r.isBest, next: from === 'career' ? nextCareerTrack(r.save, track) : null };
        }}
        onNext={(t) => race(t, from)}
        onExit={() => setScreen({ k: from === 'menu' ? 'menu' : from })}
      />
    );
  }
  return <Menu save={save} onCareer={() => setScreen({ k: 'career' })} onFree={() => setScreen({ k: 'free' })} onDaily={() => race(daily(), 'menu')} />;
}
