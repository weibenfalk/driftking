import { useEffect, useRef, useState } from 'react';
import { startRace } from './engine/host';
import { createGame } from './race/race';
import { formatTime } from './engine/util';

const WIDTH = 320;
const HEIGHT = 200;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setResult(null);
    const race = startRace(canvas, createGame, (raw) => setResult(raw));
    return () => race.stop();
  }, [run]);

  return (
    <main className="stage">
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
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
