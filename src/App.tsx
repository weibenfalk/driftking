import { useEffect, useState } from 'react';
import { audio } from './engine/audio';
import { startPadMenu } from './engine/gamepad';
import { music } from './engine/music';
import { careerPace, careerPrize, driftMedal, lapMedal, medalFor, nextCareerTrack } from './game/career';
import { loadCustom, newDraft, writeCustom } from './game/custom';
import { medalPay, payout, scalePayout } from './game/economy';
import type { Mode } from './game/economy';
import { selectedModel, selectedStats } from './game/garage';
import { credit, loadSave, withDrift, withLap, withResult, writeSave } from './game/save';
import type { Save } from './game/save';
import { DIFFICULTY, loadSettings, writeSettings } from './game/settings';
import type { Settings as SettingsData } from './game/settings';
import type { Session } from './net/session';
import { conditionsFor } from './race/conditions';
import type { Track } from './race/track';
import { forgetWorld } from './race/track';
import { allTracks, customToTrack, findTrack, isCustom, setCustomTracks } from './race/tracks';
import type { CustomTrack } from './race/tracks';
import { Editor, EditorList } from './screens/Editor';
import Garage from './screens/Garage';
import { Career, FreeRace } from './screens/Lists';
import Menu from './screens/Menu';
import Online from './screens/Online';
import RaceScreen from './screens/RaceScreen';
import Settings from './screens/Settings';

type From = 'career' | 'free' | 'attack' | 'drift' | 'menu' | 'editlist' | 'editor' | 'online';
type List = 'free' | 'attacklist' | 'driftlist' | 'editlist' | 'editor' | 'settings' | 'online';
type Screen = { k: 'menu' } | { k: 'career' } | { k: List } | { k: 'garage' } | { k: 'race'; track: Track; from: From; session?: Session };

const daily = () => allTracks().find((t) => t.id.startsWith('daily-'))!;
/** A track being test-driven from the editor: never saved, never pays. */
const TEST_ID = 'custom-test';

const modeOf = (from: From): Mode => (from === 'attack' || from === 'editor' ? 'attack' : from === 'drift' ? 'drift' : 'race');
const listFor: Record<From, Screen> = {
  career: { k: 'career' },
  free: { k: 'free' },
  attack: { k: 'attacklist' },
  drift: { k: 'driftlist' },
  menu: { k: 'menu' },
  editlist: { k: 'editlist' },
  editor: { k: 'editor' },
  online: { k: 'menu' },
};

export default function App() {
  const [save, setSave] = useState<Save>(loadSave);
  const [settings, setSettings] = useState<SettingsData>(loadSettings);
  const [custom, setCustom] = useState<CustomTrack[]>(() => {
    const c = loadCustom();
    setCustomTracks(c); // before the first render, so lists and ?track= can see them
    return c;
  });
  const [draft, setDraft] = useState<CustomTrack | null>(() => (new URLSearchParams(location.search).get('screen') === 'editor' ? newDraft() : null));
  const [screen, setScreen] = useState<Screen>(() => {
    // ?track=<id> (or ?track=daily) jumps straight into a race; add &mode=attack or &mode=drift for the other modes
    const q = new URLSearchParams(location.search);
    const id = q.get('track');
    const t = id === 'daily' ? daily() : id ? findTrack(id) : undefined;
    const mode = q.get('mode');
    if (t) return { k: 'race', track: t, from: mode === 'attack' ? 'attack' : mode === 'drift' ? 'drift' : 'menu' };
    const scr = q.get('screen'); // dev shortcut: ?screen=garage|career|free|settings|editlist|editor
    return scr === 'garage' || scr === 'career' || scr === 'free' || scr === 'settings' || scr === 'editlist' || scr === 'editor' ? { k: scr } : { k: 'menu' };
  });

  // settings take effect straight away
  useEffect(() => {
    audio.setMuted(!settings.sound);
    audio.setVolume(settings.volume / 10);
    music.configure(settings.music, settings.song);
    document.documentElement.classList.toggle('scan', settings.scanlines);
    writeSettings(settings);
  }, [settings]);

  // browsers only allow sound after a first click or key press
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // a gamepad drives the menus through key events
  useEffect(() => startPadMenu(), []);

  // M turns the music on and off from anywhere (the settings screen has the full set of switches)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) setSettings((s) => ({ ...s, music: !s.music }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commit = (next: Save) => {
    setSave(next);
    writeSave(next);
  };
  const commitCustom = (list: CustomTrack[]) => {
    setCustom(list);
    setCustomTracks(list);
    writeCustom(list);
  };
  const race = (track: Track, from: From) => setScreen({ k: 'race', track, from });
  const menu = () => setScreen({ k: 'menu' });

  if (screen.k === 'online')
    return (
      <Online
        save={save}
        look={selectedModel(save).look}
        conditions={(t) => conditionsFor(t, settings)}
        onStart={(session) => {
          const track = findTrack(session.trackId);
          if (!track) return session.link.close();
          setScreen({ k: 'race', track, from: 'online', session });
        }}
        onBack={menu}
      />
    );
  if (screen.k === 'settings') return <Settings settings={settings} save={save} onChange={setSettings} onSave={commit} onBack={menu} />;
  if (screen.k === 'garage') return <Garage save={save} onChange={commit} onBack={menu} />;
  if (screen.k === 'career') return <Career save={save} onPick={(t) => race(t, 'career')} onBack={menu} />;
  if (screen.k === 'free') return <FreeRace mode="race" save={save} onPick={(t) => race(t, 'free')} onBack={menu} />;
  if (screen.k === 'attacklist') return <FreeRace mode="attack" save={save} onPick={(t) => race(t, 'attack')} onBack={menu} />;
  if (screen.k === 'driftlist') return <FreeRace mode="drift" save={save} onPick={(t) => race(t, 'drift')} onBack={menu} />;
  if (screen.k === 'editlist')
    return (
      <EditorList
        tracks={custom}
        onNew={() => {
          setDraft(newDraft());
          setScreen({ k: 'editor' });
        }}
        onEdit={(c) => {
          setDraft(c);
          setScreen({ k: 'editor' });
        }}
        onRace={(c) => race(findTrack(c.id)!, 'editlist')}
        onDelete={(c) => commitCustom(custom.filter((t) => t.id !== c.id))}
        onImport={(c) => commitCustom([...custom, { ...c, id: `custom-${Date.now().toString(36)}`, name: c.name || `CUSTOM ${custom.length + 1}` }])}
        onBack={menu}
      />
    );
  if (screen.k === 'editor' && draft)
    return (
      <Editor
        draft={draft}
        onChange={setDraft}
        onSave={(d) => {
          const saved: CustomTrack = d.id ? d : { ...d, id: `custom-${Date.now().toString(36)}`, name: `CUSTOM ${custom.length + 1}` };
          commitCustom(d.id ? custom.map((t) => (t.id === d.id ? saved : t)) : [...custom, saved]);
          setDraft(null);
          setScreen({ k: 'editlist' });
        }}
        onTest={(d) => {
          forgetWorld(TEST_ID);
          race(customToTrack({ ...d, id: TEST_ID, name: 'TEST DRIVE' }), 'editor');
        }}
        onBack={() => setScreen({ k: 'editlist' })}
      />
    );
  if (screen.k === 'race') {
    const { from, session } = screen;
    const mode = modeOf(from);
    const { track } = screen;
    const noPrize = isCustom(track) || from !== 'career'; // prize money is for the career only (and a tiny custom track could be farmed)
    const prize = DIFFICULTY[settings.difficulty].prize * careerPrize(track.id);
    const keep = track.id !== TEST_ID; // a test drive leaves no records at all
    return (
      <RaceScreen
        track={track}
        mode={mode}
        car={{ look: selectedModel(save).look, stats: selectedStats(save) }}
        conditions={session ? session.cond : conditionsFor(track, settings)}
        online={session}
        paceScale={DIFFICULTY[settings.difficulty].pace * careerPace(track.id)}
        attack={
          mode === 'attack'
            ? {
                best: keep ? (save.attack[track.id] ?? null) : null,
                onLap: (t, r) => {
                  const medal = lapMedal(t, r.lap);
                  if (!keep) return { medal, earned: 0 };
                  const earned = noPrize ? 0 : Math.round(medalPay('attack', save.attack[t.id]?.medal ?? 0, medal) * prize);
                  commit(credit(withLap(save, t.id, r, medal).save, 'attack', t.id, earned));
                  return { medal, earned };
                },
              }
            : undefined
        }
        onRecord={(t, res) => {
          if (session) return { medal: 0, isBest: false, payout: { place: 0, medal: 0, drift: 0, total: 0 }, next: null }; // a duel pays nothing and keeps no records
          if (mode === 'drift') {
            const medal = driftMedal(t, res.raw);
            const before = save.driftMode[t.id]?.medal ?? 0;
            const earned = noPrize ? 0 : Math.round(medalPay('drift', before, medal) * prize);
            const r = withDrift(save, t.id, res.raw, medal);
            commit(credit(r.save, 'drift', t.id, earned));
            return { medal, isBest: r.isBest, payout: { place: 0, medal: earned, drift: 0, total: earned }, next: null };
          }
          const medal = medalFor(t, res.raw);
          const before = save.best[t.id];
          const r = withResult(save, t.id, res.raw, medal);
          const pay = noPrize ? { place: 0, medal: 0, drift: 0, total: 0 } : scalePayout(payout({ place: res.place, drift: res.drift, medalBefore: before?.medal ?? 0, medalAfter: medal, repeat: !!before }), prize);
          const next = credit(r.save, 'race', t.id, pay.total);
          commit(next);
          return { medal, isBest: r.isBest, payout: pay, next: from === 'career' ? nextCareerTrack(next, t) : null };
        }}
        onNext={(t) => race(t, from)}
        onExit={() => {
          session?.link.close();
          setScreen(listFor[from]);
        }}
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
      onOnline={() => setScreen({ k: 'online' })}
      onDaily={() => race(daily(), 'menu')}
      onEditor={() => setScreen({ k: 'editlist' })}
      onSettings={() => setScreen({ k: 'settings' })}
    />
  );
}
