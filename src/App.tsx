import { useEffect, useRef, useState } from 'react';
import { startRace } from './engine/host';
import { createGame } from './race/race';
import { TRACKS, dailyTrack } from './race/tracks';
import { formatTime } from './engine/util';

const WIDTH = 320;
const HEIGHT = 200;

const ALL = [...TRACKS, dailyTrack()];
const GROUPS = [...new Set(ALL.map((t) => (t.id.startsWith('daily-') ? 'DAILY' : t.env)))];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);
  const [trackId, setTrackId] = useState(() => {
    const id = new URLSearchParams(location.search).get('track');
    return ALL.find((t) => t.id === id || (id === 'daily' && t.id.startsWith('daily-')))?.id ?? ALL[0].id;
  });
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setResult(null);
    const track = ALL.find((t) => t.id === trackId)!;
    const race = startRace(canvas, (api) => createGame(api, track), (raw) => setResult(raw));
    return () => race.stop();
  }, [run, trackId]);

  return (
    <main className="stage">
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
      <select
        className="tracks"
        aria-label="Track"
        value={trackId}
        onChange={(e) => {
          e.currentTarget.blur(); // keep the arrow keys and SPACE for driving
          setTrackId(e.currentTarget.value);
          setRun((n) => n + 1);
        }}
      >
        {GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {ALL.filter((t) => (t.id.startsWith('daily-') ? 'DAILY' : t.env) === g).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {result !== null && (
        <div className="result" role="dialog" aria-label="Race finished">
          <h1>FINISH</h1>
          <p>{formatTime(result / 100)}</p>
          <button autoFocus onClick={() => setRun((n) => n + 1)}>
            Race again
          </button>
        </div>
      )}
    </main>
  );
}
