import { NUTRIENT_INFO, type NutrientKey } from '../../shared/types';
import { fmtValue } from '../lib/format';
import type { TargetKind } from '../lib/settings';
import type { Bucket } from '../lib/stats';

const W = 340;
const H = 190;
const PAD = { l: 36, r: 8, t: 14, b: 22 };

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function barPath(x: number, y: number, w: number, base: number): string {
  const h = base - y;
  const r = Math.min(4, w / 2, h);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

/**
 * One series of bars (daily or weekly averages) with an optional target line.
 * Bars over a limit use the "serious" status color; the legend below names it.
 */
export function BarChart({
  data,
  nkey,
  target,
  kind,
  selected,
  onSelect,
  labelEvery,
}: {
  data: Bucket[];
  nkey: NutrientKey;
  target?: number;
  kind?: TargetKind;
  selected: number | null;
  onSelect: (i: number | null) => void;
  labelEvery: number;
}) {
  const values = data.map((b) => b.value ?? 0);
  const peak = Math.max(1, ...values, target ?? 0);
  const step = niceStep(peak / 3);
  const yMax = Math.ceil((peak * 1.05) / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const base = PAD.t + plotH;
  const y = (v: number) => base - (v / yMax) * plotH;
  const slot = plotW / data.length;
  const bw = slot >= 12 ? Math.min(24, slot * 0.62) : Math.max(2, slot - 2);
  const isLimit = kind === 'limit' || kind === 'budget';
  const unit = NUTRIENT_INFO[nkey].unit;

  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${NUTRIENT_INFO[nkey].label} by ${data.length > 7 && labelEvery > 1 ? 'period' : 'day'}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} class={t === 0 ? 'axis' : 'grid'} />
            <text x={PAD.l - 6} y={y(t)} class="tick" text-anchor="end" dominant-baseline="middle">
              {t >= 10000 ? `${Math.round(t / 1000)}K` : t.toLocaleString()}
            </text>
          </g>
        ))}

        {data.map((b, i) => {
          if (b.value === null || b.value <= 0) return null;
          const x = PAD.l + i * slot + (slot - bw) / 2;
          const over = isLimit && target !== undefined && target > 0 && b.value > target;
          const dim = selected !== null && selected !== i;
          return (
            <path
              key={i}
              d={barPath(x, Math.min(base - 1, y(b.value)), bw, base)}
              class={`bar ${over ? 'bar-over' : ''} ${dim ? 'bar-dim' : ''}`}
            />
          );
        })}

        {target !== undefined && target > 0 && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} class="target-line" />
            <text x={W - PAD.r} y={y(target) - 5} class="target-label" text-anchor="end">
              {kind === 'goal' ? 'Goal' : 'Limit'} {fmtValue(nkey, target)}
            </text>
          </g>
        )}

        {data.map((b, i) =>
          i % labelEvery === 0 ? (
            <text key={`l${i}`} x={PAD.l + i * slot + slot / 2} y={H - 6} class="tick" text-anchor="middle">
              {b.label}
            </text>
          ) : null,
        )}

        {/* Tap targets: the full column, wider than the bar. */}
        {data.map((_, i) => (
          <rect
            key={`h${i}`}
            x={PAD.l + i * slot}
            y={PAD.t}
            width={slot}
            height={plotH}
            class="hit"
            onClick={() => onSelect(selected === i ? null : i)}
          >
            <title>
              {data[i].title}: {data[i].value === null ? 'nothing logged' : `${fmtValue(nkey, data[i].value!)} ${unit}`}
            </title>
          </rect>
        ))}
      </svg>
      {isLimit && target ? (
        <div class="legend">
          <span>
            <i class="swatch" /> Under limit
          </span>
          <span>
            <i class="swatch swatch-over" /> Over limit
          </span>
        </div>
      ) : null}
    </div>
  );
}
