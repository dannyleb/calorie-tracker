import { useEffect, useState } from 'preact/hooks';
import { scaleNutrients } from '../../shared/types';
import { savedFoods, setFavorite, type SavedFood } from '../lib/db';
import { describeAmount, fmtValue } from '../lib/format';
import { recipeName, recipeServingFood, type Recipe } from '../lib/recipes';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

export function RecentSheet({
  onPick,
  onPickRecipe,
  onClose,
  recipes = [],
  title = 'Recent & favorites',
  hint = 'Tap a food to add it with the amount you used last time.',
}: {
  onPick: (f: SavedFood) => void;
  /** When set, recipes are listed first and tapping one logs a serving. */
  onPickRecipe?: (r: Recipe) => void;
  onClose: () => void;
  recipes?: Recipe[];
  title?: string;
  hint?: string;
}) {
  const [foods, setFoods] = useState<SavedFood[] | null>(null);
  const [q, setQ] = useState('');

  const load = () => savedFoods().then(setFoods);
  useEffect(() => {
    load();
  }, []);

  const query = q.trim().toLowerCase();
  const matches = (name: string, brand?: string) =>
    !query || name.toLowerCase().includes(query) || Boolean(brand?.toLowerCase().includes(query));

  const liveRecipes = onPickRecipe ? recipes.filter((r) => r.ingredients.length && matches(recipeName(r))) : [];
  // Servings of current recipes are listed under Recipes, not repeated here.
  const recipeNames = new Set(recipes.map((r) => recipeName(r).toLowerCase()));
  const list = (foods ?? []).filter(
    (f) =>
      matches(f.food.name, f.food.brand) &&
      !(onPickRecipe && f.food.source === 'recipe' && recipeNames.has(f.food.name.toLowerCase())),
  );
  const total = (foods?.length ?? 0) + liveRecipes.length;

  return (
    <Sheet title={title} onClose={onClose} footer={<button class="secondary-btn" onClick={onClose}>Done</button>}>
      {total > 6 && (
        <label class="search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search" maxLength={100} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
      )}

      {liveRecipes.length > 0 && (
        <>
          <h3 class="list-label">Recipes</h3>
          <ul class="recent-list">
            {liveRecipes.map((r) => {
              const serving = recipeServingFood(r);
              return (
                <li key={r.id}>
                  <button class="recent-main" onClick={() => onPickRecipe!(r)}>
                    <span class="recent-name">{recipeName(r)}</span>
                    <span class="recent-sub muted">
                      1 serving · {fmtValue('calories', serving.perUnit.calories)} kcal
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {list.length > 0 && <h3 class="list-label">Foods</h3>}
        </>
      )}

      {foods && total === 0 && <div class="empty">Foods you log show up here so you can add them again with one tap.</div>}
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
      <p class="hint">{liveRecipes.length ? 'Recipes add one serving. Foods use the amount you had last time.' : hint}</p>
    </Sheet>
  );
}
