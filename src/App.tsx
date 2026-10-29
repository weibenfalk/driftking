import { useEffect, useRef, useState } from 'react';
import { startRace } from './engine/host';
import { createGame } from './race/race';
import { TRACKS } from './race/tracks';
import { formatTime } from './engine/util';

const WIDTH = 320;
const HEIGHT = 200;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);
  const [trackIdx, setTrackIdx] = useState(() => {
    const i = TRACKS.findIndex((t) => t.id === new URLSearchParams(location.search).get('track'));
    return Math.max(0, i);
  });
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setResult(null);
    const track = TRACKS[trackIdx];
    const race = startRace(canvas, (api) => createGame(api, track), (raw) => setResult(raw));
    return () => race.stop();
  }, [run, trackIdx]);

  return (
    <main className="stage">
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
      <nav className="tracks" aria-label="Track">
        {TRACKS.map((t, i) => (
          <button
            key={t.id}
            aria-pressed={i === trackIdx}
            onClick={(e) => {
              e.currentTarget.blur(); // keep SPACE (handbrake) from clicking the button again
              setTrackIdx(i);
              setRun((n) => n + 1);
            }}
          >
            {t.name}
          </button>
        ))}
      </nav>
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
