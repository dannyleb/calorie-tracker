import { useEffect, useMemo, useState } from 'preact/hooks';
import { NUTRIENT_INFO, NUTRIENT_KEYS, type NutrientKey } from '../../shared/types';
import { todayKey } from '../lib/dates';
import { entriesInRange, type Entry } from '../lib/db';
import { fmtValue } from '../lib/format';
import type { Targets } from '../lib/settings';
import { targetKind } from '../lib/settings';
import {
  buckets,
  periodRange,
  rangeLabel,
  summarize,
  topContributors,
  totalsByDay,
  type Period,
} from '../lib/stats';
import { BarChart } from './BarChart';
import { Icon } from './Icon';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
];

const TILES: NutrientKey[] = ['calories', 'satFat', 'cholesterol', 'fiber', 'sodium', 'solubleFiber'];
const CHIPS: NutrientKey[] = ['satFat', 'cholesterol', 'fiber', 'calories', 'sodium', 'solubleFiber', 'transFat', 'protein', 'carbs', 'fat', 'sugar'];

function Delta({ nkey, now, prev }: { nkey: NutrientKey; now: number; prev: number }) {
  if (!prev || !now) return <span class="delta muted">no prior data</span>;
  const change = (now - prev) / prev;
  if (Math.abs(change) < 0.02) return <span class="delta muted">same as before</span>;
  const kind = targetKind(nkey);
  const up = change > 0;
  const good = kind === 'goal' ? up : kind === 'limit' ? !up : null;
  return (
    <span class={`delta ${good === null ? '' : good ? 'good' : 'bad'}`}>
      <Icon name={up ? 'up' : 'down'} size={12} />
      {Math.round(Math.abs(change) * 100)}% vs prior
    </span>
  );
}

export function Trends({ targets, version }: { targets: Targets; version: number }) {
  const [period, setPeriod] = useState<Period>('week');
  const [offset, setOffset] = useState(0);
  const [metric, setMetric] = useState<NutrientKey>('satFat');
  const [selected, setSelected] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);

  const today = todayKey();
  const { from, to } = periodRange(period, offset, today);
  const prev = periodRange(period, offset + 1, today);

  useEffect(() => {
    setSelected(null);
    entriesInRange(prev.from, to).then(setEntries);
  }, [period, offset, version]);

  const data = useMemo(() => {
    if (!entries) return null;
    const byDay = totalsByDay(entries);
    const current = entries.filter((e) => e.date >= from && e.date <= to);
    return {
      byDay,
      current,
      now: summarize(from, to, byDay, targets),
      before: summarize(prev.from, prev.to, byDay, targets),
    };
  }, [entries, targets, from, to]);

  if (!data) return <div class="empty">Loading…</div>;

  const { now, before } = data;
  const series = buckets(period, from, to, data.byDay, metric);
  const target = targets[metric];
  const kind = targetKind(metric);
  const unit = NUTRIENT_INFO[metric].unit;
  const labelEvery = series.length <= 7 ? 1 : period === 'month' ? 5 : 2;
  const sel = selected !== null ? series[selected] : null;
  const top = topContributors(data.current, metric);
  const daily = period === 'week' || period === 'month';

  return (
    <>
      <header class="page-head">
        <h1>Trends</h1>
      </header>

      <div class="segmented" role="tablist">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={period === p.id}
            class={period === p.id ? 'on' : ''}
            onClick={() => {
              setPeriod(p.id);
              setOffset(0);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div class="range-nav">
        <button class="icon-btn" onClick={() => setOffset(offset + 1)} aria-label="Earlier">
          <Icon name="left" />
        </button>
        <span>{rangeLabel(from, to)}</span>
        <button class="icon-btn" onClick={() => setOffset(Math.max(0, offset - 1))} disabled={offset === 0} aria-label="Later">
          <Icon name="right" />
        </button>
      </div>

      {now.loggedDays === 0 ? (
        <div class="card empty">Nothing logged in this period.</div>
      ) : (
        <>
          <div class="tiles">
            {TILES.map((k) => {
              const kd = targetKind(k);
              const t = targets[k];
              const count = kd === 'goal' ? now.daysMet[k] ?? 0 : now.daysOver[k] ?? 0;
              return (
                <button key={k} class={`tile ${metric === k ? 'on' : ''}`} onClick={() => setMetric(k)}>
                  <span class="tile-label">{NUTRIENT_INFO[k].label}</span>
                  <span class="tile-value">
                    {fmtValue(k, now.avg[k])}
                    <span class="unit"> {NUTRIENT_INFO[k].unit}/day</span>
                  </span>
                  <Delta nkey={k} now={now.avg[k]} prev={before.avg[k]} />
                  {t ? (
                    <span class="tile-foot muted">
                      {count} of {now.loggedDays} days {kd === 'goal' ? 'met goal' : 'over'}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <section class="card">
            <div class="chips" role="tablist" aria-label="Nutrient">
              {CHIPS.map((k) => (
                <button key={k} role="tab" aria-selected={metric === k} class={`chip ${metric === k ? 'on' : ''}`} onClick={() => setMetric(k)}>
                  {NUTRIENT_INFO[k].short}
                </button>
              ))}
            </div>
            <div class="readout">
              {sel ? (
                <>
                  <span class="muted">{sel.title}</span>
                  <strong>
                    {sel.value === null ? 'Nothing logged' : `${fmtValue(metric, sel.value)} ${unit}${daily ? '' : ' / day avg'}`}
                  </strong>
                </>
              ) : (
                <>
                  <span class="muted">
                    {NUTRIENT_INFO[metric].label}, {daily ? 'per day' : period === 'quarter' ? 'weekly average' : '4-week average'}
                  </span>
                  <strong>
                    Avg {fmtValue(metric, now.avg[metric])} {unit}
                    {target ? ` · ${kind === 'goal' ? 'goal' : 'limit'} ${fmtValue(metric, target)}` : ''}
                  </strong>
                </>
              )}
            </div>
            <BarChart
              data={series}
              nkey={metric}
              target={target}
              kind={kind}
              selected={selected}
              onSelect={setSelected}
              labelEvery={labelEvery}
            />
            <p class="hint">
              Averages use the {now.loggedDays} day{now.loggedDays === 1 ? '' : 's'} you logged out of {now.totalDays}. Tap a bar for details.
            </p>
          </section>

          {top.length > 0 && (
            <section class="card">
              <h3 class="section-label">Top sources of {NUTRIENT_INFO[metric].label.toLowerCase()}</h3>
              <ul class="sources">
                {top.map((c) => (
                  <li key={c.name}>
                    <div class="source-top">
                      <span class="source-name">{c.name}</span>
                      <span class="source-val">
                        {fmtValue(metric, c.value)} {unit} · {Math.round(c.share * 100)}%
                      </span>
                    </div>
                    <div class="share-track">
                      <div class="share-fill" style={{ width: `${Math.max(2, c.share * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section class="card">
            <h3 class="section-label">Totals · {rangeLabel(from, to)}</h3>
            <table class="totals">
              <thead>
                <tr>
                  <th scope="col">Nutrient</th>
                  <th scope="col">Total</th>
                  <th scope="col">Avg / day</th>
                </tr>
              </thead>
              <tbody>
                {NUTRIENT_KEYS.map((k) => (
                  <tr key={k}>
                    <th scope="row">{NUTRIENT_INFO[k].label}</th>
                    <td>
                      {fmtValue(k, now.total[k])} {NUTRIENT_INFO[k].unit}
                    </td>
                    <td>
                      {fmtValue(k, now.avg[k])} {NUTRIENT_INFO[k].unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}

