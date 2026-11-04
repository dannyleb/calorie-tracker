import { NUTRIENT_INFO, type NutrientKey } from '../../shared/types';
import { fmtValue } from '../lib/format';
import type { TargetKind } from '../lib/settings';
import { Icon } from './Icon';

/**
 * Progress toward a daily target. Limits turn red with "over" when exceeded,
 * goals turn green with a check when met. State is always spelled out in text.
 */
export function Meter({
  nkey,
  value,
  target,
  kind,
  sub,
  label,
}: {
  nkey: NutrientKey;
  value: number;
  target: number;
  kind: TargetKind;
  sub?: string;
  label?: string;
}) {
  const info = NUTRIENT_INFO[nkey];
  const pct = target > 0 ? value / target : 0;
  const over = (kind === 'limit' || kind === 'budget') && pct > 1;
  const met = kind === 'goal' && pct >= 1;
  const state = over ? 'over' : met ? 'met' : '';
  let status: string;
  if (over) status = `${fmtValue(nkey, value - target)} ${info.unit} over`;
  else if (met) status = 'Goal met';
  else if (kind === 'goal') status = `${fmtValue(nkey, target - value)} ${info.unit} to go`;
  else status = `${fmtValue(nkey, target - value)} ${info.unit} left`;

  return (
    <div class={`meter ${state}`}>
      <div class="meter-top">
        <span class="meter-label">{label ?? info.label}</span>
        <span class="meter-value">
          <strong>{fmtValue(nkey, value)}</strong>
          <span class="muted">
            {' '}
            / {fmtValue(nkey, target)} {info.unit}
          </span>
        </span>
      </div>
      <div
        class="meter-track"
        role="progressbar"
        aria-label={info.label}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.round(value)}
      >
        <div class="meter-fill" style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <div class="meter-sub">
        <span class="meter-status">
          {over && <Icon name="alert" size={14} />}
          {met && <Icon name="check" size={14} />}
          {status}
        </span>
        {sub && <span class="muted">{sub}</span>}
      </div>
    </div>
  );
}
