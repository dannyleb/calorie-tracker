import { useEffect, useState } from 'preact/hooks';
import { scaleNutrients } from '../../shared/types';
import { savedFoods, setFavorite, type SavedFood } from '../lib/db';
import { describeAmount, fmtValue } from '../lib/format';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

export function RecentSheet({
  onPick,
  onClose,
}: {
  onPick: (f: SavedFood) => void;
  onClose: () => void;
}) {
  const [foods, setFoods] = useState<SavedFood[] | null>(null);
  const [q, setQ] = useState('');

  const load = () => savedFoods().then(setFoods);
  useEffect(() => {
    load();
  }, []);

  const query = q.trim().toLowerCase();
  const list = (foods ?? []).filter(
    (f) => !query || f.food.name.toLowerCase().includes(query) || f.food.brand?.toLowerCase().includes(query),
  );

  return (
    <Sheet title="Recent & favorites" onClose={onClose} footer={<button class="secondary-btn" onClick={onClose}>Done</button>}>
      {(foods?.length ?? 0) > 6 && (
        <label class="search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
      )}
      {foods && foods.length === 0 && (
        <div class="empty">Foods you log show up here so you can add them again with one tap.</div>
      )}
      <ul class="recent-list">
        {list.map((f) => {
          const kcal = scaleNutrients(f.food.perUnit, f.lastQty).calories;
          return (
            <li key={f.key}>
              <button class="recent-main" onClick={() => onPick(f)}>
                <span class="recent-name">
                  {f.food.name}
                  {f.food.brand && <span class="muted"> · {f.food.brand}</span>}
                </span>
                <span class="recent-sub muted">
                  {describeAmount(f.food, f.lastQty)} · {fmtValue('calories', kcal)} kcal
                </span>
              </button>
              <button
                class={`icon-btn star ${f.favorite ? 'on' : ''}`}
                aria-label={f.favorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={f.favorite}
                onClick={async () => {
                  await setFavorite(f.food, !f.favorite);
                  load();
                }}
              >
                <Icon name="star" filled={f.favorite} />
              </button>
            </li>
          );
        })}
      </ul>
      <p class="hint">Tap a food to add it with the amount you used last time.</p>
    </Sheet>
  );
}
