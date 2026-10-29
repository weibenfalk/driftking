import type { Save } from '../game/save';

export default function Menu({ save, onCareer, onFree, onAttack, onDrift, onGarage, onDaily }: { save: Save; onCareer: () => void; onFree: () => void; onAttack: () => void; onDrift: () => void; onGarage: () => void; onDaily: () => void }) {
  const medals = Object.values(save.best);
  const gold = medals.filter((b) => b.medal === 3).length;
  return (
    <main className="screen menu">
      <h1 className="title">DRIFT KING</h1>
      <nav>
        <button autoFocus onClick={onCareer}>
          CAREER
        </button>
        <button onClick={onFree}>FREE RACE</button>
        <button onClick={onAttack}>TIME ATTACK</button>
        <button onClick={onDrift}>DRIFT CHALLENGE</button>
        <button onClick={onGarage}>GARAGE · $ {save.money}</button>
        <button onClick={onDaily}>DAILY TRACK</button>
      </nav>
      <p className="hint">
        ARROWS / WASD STEER · SPACE HANDBRAKE · ESC LEAVES A RACE
        <br />
        {gold} GOLD · {medals.length} TRACKS DRIVEN
      </p>
    </main>
  );
}
