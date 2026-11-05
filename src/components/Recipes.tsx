import { useEffect, useState } from 'preact/hooks';
import { allRecipes, newId } from '../lib/db';
import { fmtValue } from '../lib/format';
import { newRecipe, recipeName, recipeServingFood, type Recipe } from '../lib/recipes';
import { Icon } from './Icon';
import { RecipeEditor } from './RecipeEditor';
import type { ToastState } from './Toast';

export function Recipes({
  dayLabel,
  version,
  onLog,
  toast,
}: {
  dayLabel: string;
  version: number;
  /** Log servings of a recipe. `fromEditor` lets the app jump to Today afterwards. */
  onLog: (r: Recipe, servings: number, fromEditor: boolean) => void;
  toast: (t: Omit<ToastState, 'id'>) => void;
}) {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [editing, setEditing] = useState<Recipe | null>(null);

  const load = () => allRecipes().then(setRecipes);
  useEffect(() => {
    if (!editing) load();
  }, [editing, version]);

  if (editing) {
    return (
      <RecipeEditor
        key={editing.id}
        initial={editing}
        dayLabel={dayLabel}
        toast={toast}
        onBack={() => setEditing(null)}
        onLog={(r, servings) => onLog(r, servings, true)}
        onDeleted={(r) => {
          setEditing(null);
          toast({ message: `Deleted ${recipeName(r)}` });
        }}
      />
    );
  }

  return (
    <>
      <header class="page-head">
        <h1>Recipes</h1>
      </header>

      <button class="primary-btn new-recipe" onClick={() => setEditing(newRecipe(newId()))}>
        <Icon name="plus" size={20} /> New recipe
      </button>

      {recipes && recipes.length === 0 && (
        <div class="card empty">
          Build a recipe once, then log a serving with one tap.
          <br />
          <br />
          Say the ingredients and amounts ("2 cups flour, 1 cup sugar, 3 eggs…"), snap a package or barcode, or photograph a recipe card.
        </div>
      )}

      {recipes && recipes.length > 0 && (
        <section class="card log">
          <ul class="entries">
            {recipes.map((r) => {
              const s = recipeServingFood(r);
              const empty = r.ingredients.length === 0;
              return (
                <li key={r.id} class="recipe-row">
                  <button class="entry" onClick={() => setEditing(r)}>
                    <div class="entry-main">
                      <div class="entry-name">{recipeName(r)}</div>
                      <div class="entry-sub muted">
                        {empty
                          ? 'No ingredients yet'
                          : `${r.servings} servings · ${fmtValue('calories', s.perUnit.calories)} kcal · SF ${fmtValue(
                              'satFat',
                              s.perUnit.satFat,
                            )}g · Ch ${fmtValue('cholesterol', s.perUnit.cholesterol)}mg each`}
                      </div>
                    </div>
                  </button>
                  {!empty && (
                    <button class="log-btn" onClick={() => onLog(r, 1, false)} aria-label={`Log a serving of ${recipeName(r)}`}>
                      <Icon name="plus" size={18} /> Log
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {recipes && recipes.length > 0 && (
        <p class="hint">"Log" adds one serving to {dayLabel === 'Today' ? 'today' : dayLabel}. Tap a recipe to edit it or log a different amount.</p>
      )}
    </>
  );
}
