import { NUTRIENT_INFO, type NutrientKey, type Nutrients } from '../../shared/types';
import { addDays, dayLabel, timeLabel, todayKey } from '../lib/dates';
import type { Entry } from '../lib/db';
import { describeAmount, fmtValue } from '../lib/format';
import type { Targets } from '../lib/settings';
import { entryNutrients, sumEntries } from '../lib/stats';
import { Icon } from './Icon';
import { Meter } from './Meter';

const MACROS: NutrientKey[] = ['protein', 'carbs', 'fat', 'sugar', 'transFat'];

function Summary({ total, targets }: { total: Nutrients; targets: Targets }) {
  const cal = targets.calories ?? 0;
  const pct = cal ? total.calories / cal : 0;
  return (
    <section class="card summary">
      <div class="hero">
        <div>
          <div class="hero-value">{fmtValue('calories', total.calories)}</div>
          <div class="muted">{cal ? `of ${cal.toLocaleString()} kcal` : 'kcal'}</div>
        </div>
        {cal > 0 && (
          <div class={`hero-left ${pct > 1 ? 'over' : ''}`}>
            {pct > 1 ? (
              <>
                <Icon name="alert" size={14} /> {fmtValue('calories', total.calories - cal)} over
              </>
            ) : (
              <>{fmtValue('calories', cal - total.calories)} left</>
            )}
          </div>
        )}
      </div>
      {cal > 0 && (
        <div class={`meter-track hero-track ${pct > 1 ? 'over' : ''}`}>
          <div class="meter-fill" style={{ width: `${Math.min(100, pct * 100)}%` }} />
        </div>
      )}

      <h3 class="section-label">Heart health</h3>
      <div class="meters">
        {targets.satFat ? <Meter nkey="satFat" value={total.satFat} target={targets.satFat} kind="limit" /> : null}
        {targets.cholesterol ? (
          <Meter nkey="cholesterol" value={total.cholesterol} target={targets.cholesterol} kind="limit" />
        ) : null}
        {targets.fiber ? (
          <Meter
            nkey="fiber"
            value={total.fiber}
            target={targets.fiber}
            kind="goal"
            sub={`~${fmtValue('solubleFiber', total.solubleFiber)} g soluble${
              targets.solubleFiber ? ` / ${targets.solubleFiber}` : ''
            }`}
          />
        ) : null}
        {targets.sodium ? <Meter nkey="sodium" value={total.sodium} target={targets.sodium} kind="limit" /> : null}
      </div>

      <div class="macros">
        {MACROS.map((k) => (
          <div class="macro" key={k}>
            <div class="macro-value">
              {fmtValue(k, total[k])}
              <span class="unit">{NUTRIENT_INFO[k].unit}</span>
            </div>
            <div class="macro-label">{NUTRIENT_INFO[k].short}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Today({
  date,
  setDate,
  entries,
  targets,
  onEdit,
}: {
  date: string;
  setDate: (d: string) => void;
  entries: Entry[];
  targets: Targets;
  onEdit: (e: Entry) => void;
}) {
  const today = todayKey();
  const total = sumEntries(entries);
  return (
    <>
      <header class="day-nav">
        <button class="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          <Icon name="left" />
        </button>
        <button class="day-title" onClick={() => setDate(today)} disabled={date === today}>
          <h1>{dayLabel(date, today)}</h1>
        </button>
        <button
          class="icon-btn"
          onClick={() => setDate(addDays(date, 1))}
          disabled={date >= today}
          aria-label="Next day"
        >
          <Icon name="right" />
        </button>
      </header>

      <Summary total={total} targets={targets} />

      <section class="card log">
        {entries.length === 0 ? (
          <div class="empty">
            Nothing logged {date === today ? 'yet today' : 'this day'}.
            <br />
            Snap a photo of your food, a barcode or a nutrition label.
          </div>
        ) : (
          <ul class="entries">
            {entries.map((e) => {
              const n = entryNutrients(e);
              return (
                <li key={e.id}>
                  <button class="entry" onClick={() => onEdit(e)}>
                    <div class="entry-main">
                      <div class="entry-name">
                        {e.food.name}
                        {e.food.brand && <span class="muted"> · {e.food.brand}</span>}
                      </div>
                      <div class="entry-sub muted">
                        {timeLabel(e.ts)} · {describeAmount(e.food, e.qty)}
                      </div>
                    </div>
                    <div class="entry-nums">
                      <div class="entry-kcal">{fmtValue('calories', n.calories)}</div>
                      <div class="entry-sub muted">
                        SF {fmtValue('satFat', n.satFat)}g · Ch {fmtValue('cholesterol', n.cholesterol)}mg
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
