import { useEffect, useRef, useState } from 'react';
import { CAR_MODELS, MAX_LEVEL, UPGRADES, UPGRADE_KINDS, statsFor } from '../game/cars';
import { buyCar, levelsOf, owns, selectCar, selectedModel, upgradeCar, upgradePrice } from '../game/garage';
import type { Save } from '../game/save';
import { getLooks } from '../race/car';
import { Header } from './ui';

/** The car sprite at 5x, facing right. */
function CarPreview({ look }: { look: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 18, 18);
    ctx.drawImage(getLooks()[look].frames[0], 0, 0);
  }, [look]);
  return <canvas ref={ref} className="car-preview" width={18} height={18} />;
}

const BARS = [
  ['GRIP', 'grip', 0.8, 1.3],
  ['ACCEL', 'accel', 0.9, 1.3],
  ['TOP SPEED', 'top', 0.9, 1.2],
  ['DRIFT', 'drift', 0.7, 1.4],
  ['BRAKES', 'brake', 0.9, 1.5],
] as const;

interface Props {
  save: Save;
  onChange: (next: Save) => void;
  onBack: () => void;
}

export default function Garage({ save, onChange, onBack }: Props) {
  const [focus, setFocus] = useState(selectedModel(save).id);
  const model = CAR_MODELS.find((m) => m.id === focus) ?? CAR_MODELS[0];
  const owned = owns(save, model.id);
  const lv = levelsOf(save, model.id);
  const stats = statsFor(model, lv);
  const isSelected = save.garage.selected === model.id;

  return (
    <main className="screen">
      <Header title="GARAGE" onBack={onBack} />
      <p className="money">$ {save.money}</p>
      <div className="garage">
        <div className="cars">
          {CAR_MODELS.map((m) => (
            <button key={m.id} className={m.id === focus ? 'car-card on' : 'car-card'} onClick={() => setFocus(m.id)}>
              <CarPreview look={m.look} />
              <span>{m.name}</span>
              <small>{owns(save, m.id) ? (save.garage.selected === m.id ? 'IN USE' : 'OWNED') : `$ ${m.price}`}</small>
            </button>
          ))}
        </div>
        <section className="detail">
          <h2>{model.name}</h2>
          <p className="hint">{model.blurb}</p>
          {BARS.map(([label, key, lo, hi]) => (
            <div key={key} className="bar">
              <span>{label}</span>
              <i>
                <b style={{ width: `${Math.min(100, Math.max(4, ((stats[key] - lo) / (hi - lo)) * 100))}%` }} />
              </i>
            </div>
          ))}
          {owned ? (
            <>
              <button disabled={isSelected} onClick={() => onChange(selectCar(save, model.id)!)}>
                {isSelected ? 'IN USE' : 'USE THIS CAR'}
              </button>
              <h3>UPGRADES</h3>
              {UPGRADE_KINDS.map((k) => {
                const price = upgradePrice(save, model.id, k);
                return (
                  <div key={k} className="upg">
                    <span>
                      {UPGRADES[k].label} <small>{UPGRADES[k].effect}</small>
                    </span>
                    <span className="pips">{Array.from({ length: MAX_LEVEL }, (_, i) => (i < lv[k] ? '■' : '□')).join('')}</span>
                    <button disabled={price === null || save.money < price} onClick={() => onChange(upgradeCar(save, model.id, k)!)}>
                      {price === null ? 'MAX' : `$ ${price}`}
                    </button>
                  </div>
                );
              })}
            </>
          ) : (
            <button disabled={save.money < model.price} onClick={() => onChange(buyCar(save, model.id)!)}>
              BUY $ {model.price}
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
