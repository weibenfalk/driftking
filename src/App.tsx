import { useState } from 'react';
import { driftMedal, lapMedal, medalFor, nextCareerTrack } from './game/career';
import { medalPay, payout } from './game/economy';
import type { Mode } from './game/economy';
import { selectedModel, selectedStats } from './game/garage';
import { credit, loadSave, withDrift, withLap, withResult, writeSave } from './game/save';
import type { Save } from './game/save';
import type { Track } from './race/track';
import { allTracks, findTrack } from './race/tracks';
import Garage from './screens/Garage';
import { Career, FreeRace } from './screens/Lists';
import Menu from './screens/Menu';
import RaceScreen from './screens/RaceScreen';

type From = 'career' | 'free' | 'attack' | 'drift' | 'menu';
type List = 'free' | 'attacklist' | 'driftlist';
type Screen = { k: 'menu' } | { k: 'career' } | { k: List } | { k: 'garage' } | { k: 'race'; track: Track; from: From };

const daily = () => allTracks().find((t) => t.id.startsWith('daily-'))!;
const modeOf = (from: From): Mode => (from === 'attack' ? 'attack' : from === 'drift' ? 'drift' : 'race');
const listFor: Record<From, Screen> = {
  career: { k: 'career' },
  free: { k: 'free' },
  attack: { k: 'attacklist' },
  drift: { k: 'driftlist' },
  menu: { k: 'menu' },
};

export default function App() {
  const [save, setSave] = useState<Save>(loadSave);
  const [screen, setScreen] = useState<Screen>(() => {
    // ?track=<id> (or ?track=daily) jumps straight into a race; add &mode=attack or &mode=drift for the other modes
    const q = new URLSearchParams(location.search);
    const id = q.get('track');
    const t = id === 'daily' ? daily() : id ? findTrack(id) : undefined;
    const mode = q.get('mode');
    if (t) return { k: 'race', track: t, from: mode === 'attack' ? 'attack' : mode === 'drift' ? 'drift' : 'menu' };
    const scr = q.get('screen'); // dev shortcut: ?screen=garage|career|free
    return scr === 'garage' || scr === 'career' || scr === 'free' ? { k: scr } : { k: 'menu' };
  });

  const commit = (next: Save) => {
    setSave(next);
    writeSave(next);
  };
  const race = (track: Track, from: From) => setScreen({ k: 'race', track, from });
  const menu = () => setScreen({ k: 'menu' });

  if (screen.k === 'garage') return <Garage save={save} onChange={commit} onBack={menu} />;
  if (screen.k === 'career') return <Career save={save} onPick={(t) => race(t, 'career')} onBack={menu} />;
  if (screen.k === 'free') return <FreeRace mode="race" save={save} onPick={(t) => race(t, 'free')} onBack={menu} />;
  if (screen.k === 'attacklist') return <FreeRace mode="attack" save={save} onPick={(t) => race(t, 'attack')} onBack={menu} />;
  if (screen.k === 'driftlist') return <FreeRace mode="drift" save={save} onPick={(t) => race(t, 'drift')} onBack={menu} />;
  if (screen.k === 'race') {
    const { from } = screen;
    const mode = modeOf(from);
    return (
      <RaceScreen
        track={screen.track}
        mode={mode}
        car={{ look: selectedModel(save).look, stats: selectedStats(save) }}
        attack={
          mode === 'attack'
            ? {
                best: save.attack[screen.track.id] ?? null,
                onLap: (track, r) => {
                  const medal = lapMedal(track, r.lap);
                  const earned = medalPay('attack', save.attack[track.id]?.medal ?? 0, medal);
                  commit(credit(withLap(save, track.id, r, medal).save, 'attack', track.id, earned));
                  return { medal, earned };
                },
              }
            : undefined
        }
        onRecord={(track, res) => {
          if (mode === 'drift') {
            const medal = driftMedal(track, res.raw);
            const before = save.driftMode[track.id]?.medal ?? 0;
            const earned = medalPay('drift', before, medal);
            const r = withDrift(save, track.id, res.raw, medal);
            commit(credit(r.save, 'drift', track.id, earned));
            return { medal, isBest: r.isBest, payout: { place: 0, medal: earned, drift: 0, total: earned }, next: null };
          }
          const medal = medalFor(track, res.raw);
          const before = save.best[track.id];
          const r = withResult(save, track.id, res.raw, medal);
          const pay = payout({ place: res.place, drift: res.drift, medalBefore: before?.medal ?? 0, medalAfter: medal, repeat: !!before });
          const next = credit(r.save, 'race', track.id, pay.total);
          commit(next);
          return { medal, isBest: r.isBest, payout: pay, next: from === 'career' ? nextCareerTrack(next, track) : null };
        }}
        onNext={(t) => race(t, from)}
        onExit={() => setScreen(listFor[from])}
      />
    );
  }
  return (
    <Menu
      save={save}
      onCareer={() => setScreen({ k: 'career' })}
      onFree={() => setScreen({ k: 'free' })}
      onAttack={() => setScreen({ k: 'attacklist' })}
      onDrift={() => setScreen({ k: 'driftlist' })}
      onGarage={() => setScreen({ k: 'garage' })}
      onDaily={() => race(daily(), 'menu')}
    />
  );
}
