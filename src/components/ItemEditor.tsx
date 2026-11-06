import { useState } from 'preact/hooks';
import { scaleNutrients, type FoodItem, type NutrientKey } from '../../shared/types';
import { parseAmountLocal } from '../lib/amount';
import { parseAmount } from '../lib/api';
import { countSavedCall, recallAmount, rememberAmount } from '../lib/memory';
import { SOURCE_LABEL, describeAmount, fmtQty, fmtValue } from '../lib/format';
import { Icon } from './Icon';

const MAIN: [NutrientKey, string, string][] = [
  ['satFat', 'Sat fat', 'g'],
  ['cholesterol', 'Chol', 'mg'],
  ['fiber', 'Fiber', 'g'],
  ['sodium', 'Sodium', 'mg'],
];
const MINOR: [NutrientKey, string, string][] = [
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
  ['sugar', 'Sugar', 'g'],
  ['transFat', 'Trans', 'g'],
];

export function NutrientLine({ food, qty }: { food: FoodItem; qty: number }) {
  const n = scaleNutrients(food.perUnit, qty);
  const show = (k: NutrientKey, label: string, unit: string) => (
    <span key={k}>
      {label} <b>{food.missing?.includes(k) ? 'n/a' : `${fmtValue(k, n[k])}${unit === 'mg' ? ' mg' : ' g'}`}</b>
    </span>
  );
  return (
    <div class="nutrients">
      <div class="nutrients-main">
        <span class="kcal">
          <b>{fmtValue('calories', n.calories)}</b> kcal
        </span>
        {MAIN.map(([k, l, u]) => show(k, l, u))}
      </div>
      <div class="nutrients-minor">{MINOR.map(([k, l, u]) => show(k, l, u))}</div>
    </div>
  );
}

export function ItemEditor({
  food,
  qty,
  onQty,
  include,
  onToggle,
}: {
  food: FoodItem;
  qty: number;
  onQty: (q: number) => void;
  include?: boolean;
  onToggle?: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function applyAmount(e?: Event) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    (document.activeElement as HTMLElement | null)?.blur();
    const local = parseAmountLocal(t, food.unitGrams);
    if (local) {
      onQty(local);
      setNote('');
      setText('');
      return;
    }
    setBusy(true);
    setNote('Working out the amount…');
    try {
      const known = await recallAmount(food, t);
      if (known) {
        countSavedCall();
        onQty(known);
        setNote(`"${t}" — remembered from last time.`);
        setText('');
        return;
      }
      const r = await parseAmount(food, t);
      onQty(r.multiplier);
      rememberAmount(food, t, r.multiplier);
      setNote(r.note);
      setText('');
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const stepDown = qty <= 1 ? 0.25 : 0.5;
  const stepUp = qty < 1 ? 0.25 : 0.5;
  const dim = include === false;

  return (
    <div class={`item ${dim ? 'item-off' : ''}`}>
      <div class="item-head">
        {onToggle && (
          <button
            class={`check ${include ? 'on' : ''}`}
            onClick={onToggle}
            role="checkbox"
            aria-checked={include}
            aria-label={`Include ${food.name}`}
          >
            {include && <Icon name="check" size={16} />}
          </button>
        )}
        <div class="item-title">
          <div class="item-name">
            {food.name}
            {food.brand && <span class="muted"> · {food.brand}</span>}
          </div>
          <div class="item-unit muted">{describeAmount(food, qty)}</div>
        </div>
        <span class={`badge badge-${food.source}`} title={food.sourceDetail}>
          {SOURCE_LABEL[food.source]}
        </span>
      </div>

      <NutrientLine food={food} qty={qty} />

      {food.confidence === 'low' && <div class="hint">Low confidence: check the food and portion.</div>}

      <div class="amount-row">
        <div class="stepper" aria-label="Quantity">
          <button onClick={() => onQty(Math.max(0.25, qty - stepDown))} aria-label="Less" disabled={qty <= 0.25}>
            <Icon name="minus" size={18} />
          </button>
          <span class="stepper-value">{fmtQty(qty)}×</span>
          <button onClick={() => onQty(Math.min(50, qty + stepUp))} aria-label="More">
            <Icon name="plus" size={18} />
          </button>
        </div>
        <form class="amount-form" onSubmit={applyAmount}>
          <input
            type="text"
            inputMode="text"
            enterKeyHint="done"
            placeholder="Say or type an amount"
            maxLength={100}
            value={text}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            aria-label="Amount"
            disabled={busy}
          />
          {text.trim() && (
            <button type="submit" class="small-btn" disabled={busy}>
              Set
            </button>
          )}
        </form>
      </div>
      {note && <div class="hint">{note}</div>}
    </div>
  );
}
