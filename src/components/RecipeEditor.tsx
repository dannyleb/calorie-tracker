import { useEffect, useRef, useState } from 'preact/hooks';
import type { FoodItem } from '../../shared/types';
import { analyzeText } from '../lib/api';
import { identifyPhoto } from '../lib/capture';
import { deleteRecipe, newId, saveRecipe } from '../lib/db';
import { describeAmount, fmtQty, fmtValue } from '../lib/format';
import {
  DEFAULT_SERVINGS,
  ingredientNutrients,
  rawGrams,
  recipeName,
  recipeServingFood,
  recipeTotal,
  type Ingredient,
  type Recipe,
} from '../lib/recipes';
import { Icon } from './Icon';
import { ItemEditor, NutrientLine } from './ItemEditor';
import { RecentSheet } from './RecentSheet';
import { Sheet } from './Sheet';
import { TextSheet } from './TextSheet';
import type { ToastState } from './Toast';

type EditorSheet =
  | null
  | { type: 'say' }
  | { type: 'recent' }
  | { type: 'ingredient'; id: string; hint?: string }
  | { type: 'working'; message: string; thumb?: string }
  | { type: 'error'; message: string; thumb?: string };

/** Persist only recipes that have something in them. */
const worthSaving = (r: Recipe) => Boolean(r.name.trim() || r.ingredients.length);

export function RecipeEditor({
  initial,
  dayLabel,
  onBack,
  onLog,
  onDeleted,
  toast,
}: {
  initial: Recipe;
  dayLabel: string;
  onBack: () => void;
  onLog: (r: Recipe, servings: number) => void;
  onDeleted: (r: Recipe) => void;
  toast: (t: Omit<ToastState, 'id'>) => void;
}) {
  const [r, setR] = useState<Recipe>(initial);
  const [sheet, setSheet] = useState<EditorSheet>(null);
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [logQty, setLogQty] = useState(1);
  const [saved, setSaved] = useState(true);
  const servingsTouched = useRef(initial.ingredients.length > 0 || initial.servings !== DEFAULT_SERVINGS);
  const latest = useRef(r);
  const deleted = useRef(false);
  const job = useRef(0);
  latest.current = r;

  // Autosave shortly after each change, and on the way out.
  useEffect(() => {
    if (r === initial) return;
    setSaved(false);
    const t = setTimeout(async () => {
      if (worthSaving(r) && !deleted.current) await saveRecipe(r);
      setSaved(true);
    }, 400);
    return () => clearTimeout(t);
  }, [r]);
  useEffect(
    () => () => {
      if (latest.current !== initial && worthSaving(latest.current) && !deleted.current) saveRecipe(latest.current);
    },
    [],
  );

  const update = (patch: Partial<Recipe>) => setR((prev) => ({ ...prev, ...patch, updatedAt: Date.now() }));

  function addFoods(foods: FoodItem[], meta: { recipeName?: string; servings?: number; note?: string } = {}) {
    const added: Ingredient[] = foods.map((food) => ({ id: newId(), food, qty: 1 }));
    setR((prev) => {
      const next: Recipe = { ...prev, ingredients: [...prev.ingredients, ...added], updatedAt: Date.now() };
      if (!prev.name.trim() && meta.recipeName) next.name = meta.recipeName;
      if (!servingsTouched.current && meta.servings) next.servings = meta.servings;
      return next;
    });
    if (meta.servings) servingsTouched.current = true;
    setFresh(new Set(added.map((a) => a.id)));
    setNote(meta.note ?? '');
    return added;
  }

  async function onSay(text: string) {
    const id = ++job.current;
    setSheet({ type: 'working', message: 'Working out ingredients…' });
    try {
      const res = await analyzeText(text, 'recipe');
      if (job.current !== id) return;
      if (!res.items.length) {
        setSheet({ type: 'error', message: res.note || "Couldn't find any ingredients in that. Try listing them with amounts." });
        return;
      }
      addFoods(res.items, { recipeName: res.recipeName, servings: res.servings, note: res.note });
      setSheet(null);
      toast({ message: `Added ${res.items.length} ingredient${res.items.length === 1 ? '' : 's'}` });
    } catch (err) {
      if (job.current === id) setSheet({ type: 'error', message: (err as Error).message });
    }
  }

  async function onPhoto(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const id = ++job.current;
    let thumb: string | undefined;
    try {
      const res = await identifyPhoto(file, 'recipe', (message, t) => {
        thumb = t ?? thumb;
        if (job.current === id) setSheet({ type: 'working', message, thumb });
      });
      if (job.current !== id) return;
      if (!res.items.length) {
        setSheet({ type: 'error', message: res.note || 'No ingredient found in that photo.', thumb });
        return;
      }
      const added = addFoods(res.items, { recipeName: res.recipeName, servings: res.servings, note: res.note });
      // A single product (barcode or label) is one serving: ask how much the recipe uses.
      const one = added.length === 1 ? added[0] : null;
      if (one && (res.barcode || one.food.source === 'label' || one.food.source === 'barcode')) {
        setSheet({ type: 'ingredient', id: one.id, hint: 'How much does the recipe use? Say or type it, e.g. "2 cups" or "500 g".' });
      } else {
        setSheet(null);
        toast({ message: `Added ${added.length} ingredient${added.length === 1 ? '' : 's'}` });
      }
    } catch (err) {
      if (job.current === id) setSheet({ type: 'error', message: (err as Error).message, thumb });
    }
  }

  function removeIngredient(ing: Ingredient) {
    const index = latest.current.ingredients.findIndex((i) => i.id === ing.id);
    update({ ingredients: latest.current.ingredients.filter((i) => i.id !== ing.id) });
    setSheet(null);
    toast({
      message: `Removed ${ing.food.name}`,
      actionLabel: 'Undo',
      onAction: () =>
        setR((prev) => {
          const list = [...prev.ingredients];
          list.splice(Math.min(index, list.length), 0, ing);
          return { ...prev, ingredients: list, updatedAt: Date.now() };
        }),
    });
  }

  const closeSheet = () => {
    job.current++;
    setSheet(null);
  };

  const total = recipeTotal(r);
  const serving = recipeServingFood(r);
  const grams = rawGrams(r);
  const editing = sheet?.type === 'ingredient' ? r.ingredients.find((i) => i.id === sheet.id) : undefined;
  const isNew = initial.ingredients.length === 0 && !initial.name;

  return (
    <div class="recipe-editor">
      <header class="editor-head">
        <button class="back-btn" onClick={onBack}>
          <Icon name="left" size={20} /> Recipes
        </button>
        <span class="muted save-state">{worthSaving(r) ? (saved ? 'Saved' : 'Saving…') : ''}</span>
      </header>

      <section class="card">
        <input
          class="title-input"
          type="text"
          placeholder="Recipe name"
          aria-label="Recipe name"
          maxLength={100}
          value={r.name}
          onInput={(e) => update({ name: (e.target as HTMLInputElement).value })}
        />
        <div class="row-between">
          <span>Servings</span>
          <div class="stepper" aria-label="Servings">
            <button
              onClick={() => {
                servingsTouched.current = true;
                update({ servings: Math.max(1, r.servings - 1) });
              }}
              aria-label="Fewer servings"
              disabled={r.servings <= 1}
            >
              <Icon name="minus" size={18} />
            </button>
            <span class="stepper-value">{r.servings}</span>
            <button
              onClick={() => {
                servingsTouched.current = true;
                update({ servings: Math.min(100, r.servings + 1) });
              }}
              aria-label="More servings"
            >
              <Icon name="plus" size={18} />
            </button>
          </div>
        </div>
        <label class="row-between cooked">
          <span>
            Cooked weight <span class="muted">(optional)</span>
          </span>
          <span class="grams-input">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              placeholder={grams ? String(Math.round(grams)) : '—'}
              value={r.cookedGrams ?? ''}
              onChange={(e) => {
                const v = parseFloat((e.target as HTMLInputElement).value);
                update({ cookedGrams: Number.isFinite(v) && v > 0 ? Math.min(v, 100000) : null });
              }}
            />
            g
          </span>
        </label>
        <p class="hint">Weigh the finished dish to log servings by grams. Cooking changes weight (water loss), so this beats the raw total.</p>
      </section>

      <section class="card log">
        <h3 class="section-label pad-top">
          Ingredients{r.ingredients.length ? ` (${r.ingredients.length})` : ''}
        </h3>
        {note && <p class="hint">{note}</p>}
        {r.ingredients.length === 0 ? (
          <div class="empty">
            Tap <b>Say ingredients</b> and list everything with amounts:
            <br />
            "2 cups flour, 1 cup sugar, 3 eggs, a stick of butter, a teaspoon of salt"
            <br />
            <br />
            Or snap a package, its barcode, or a recipe card or screenshot.
          </div>
        ) : (
          <ul class="entries">
            {r.ingredients.map((i) => {
              const n = ingredientNutrients(i);
              return (
                <li key={i.id} class={fresh.has(i.id) ? 'fresh' : ''}>
                  <button class="entry" onClick={() => setSheet({ type: 'ingredient', id: i.id })}>
                    <div class="entry-main">
                      <div class="entry-name">
                        {i.food.name}
                        {i.food.brand && <span class="muted"> · {i.food.brand}</span>}
                      </div>
                      <div class="entry-sub muted">
                        {describeAmount(i.food, i.qty)}
                        {i.food.confidence === 'low' ? ' · check amount' : ''}
                      </div>
                    </div>
                    <div class="entry-nums">
                      <div class="entry-kcal">{fmtValue('calories', n.calories)}</div>
                      <div class="entry-sub muted">kcal</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {r.ingredients.length > 0 && (
        <>
          <section class="card">
            <h3 class="section-label">Per serving</h3>
            <NutrientLine food={serving} qty={1} />
            <p class="hint">
              Whole recipe: {fmtValue('calories', total.calories)} kcal · sat fat {fmtValue('satFat', total.satFat)} g · cholesterol{' '}
              {fmtValue('cholesterol', total.cholesterol)} mg
              {serving.unitGrams ? ` · ${Math.round(serving.unitGrams)} g per serving` : ''}
            </p>
          </section>

          <section class="card log-recipe">
            <div class="row-between">
              <span>Servings eaten</span>
              <div class="stepper" aria-label="Servings to log">
                <button onClick={() => setLogQty(Math.max(0.5, logQty - 0.5))} aria-label="Less" disabled={logQty <= 0.5}>
                  <Icon name="minus" size={18} />
                </button>
                <span class="stepper-value">{fmtQty(logQty)}</span>
                <button onClick={() => setLogQty(Math.min(20, logQty + 0.5))} aria-label="More">
                  <Icon name="plus" size={18} />
                </button>
              </div>
            </div>
            <button class="primary-btn" onClick={() => onLog(latest.current, logQty)}>
              Log to {dayLabel === 'Today' ? 'today' : dayLabel}
            </button>
          </section>
        </>
      )}

      {!isNew || worthSaving(r) ? (
        <button
          class="danger-btn delete-recipe"
          onClick={async () => {
            if (!confirm(`Delete "${recipeName(r)}"? Days you already logged keep their entries.`)) return;
            job.current++;
            deleted.current = true;
            await deleteRecipe(r.id);
            onDeleted(r);
          }}
        >
          <Icon name="trash" size={20} /> Delete recipe
        </button>
      ) : null}

      <div class="addbar recipe-bar">
        <button class="add-camera" onClick={() => setSheet({ type: 'say' })}>
          <Icon name="mic" size={24} />
          <span>Say ingredients</span>
        </button>
        <label class="add-btn" aria-label="Photo of an ingredient, barcode or recipe">
          <Icon name="camera" />
          <span>Photo</span>
          <input type="file" accept="image/*" onChange={onPhoto} />
        </label>
        <button class="add-btn" onClick={() => setSheet({ type: 'recent' })}>
          <Icon name="clock" />
          <span>Recent</span>
        </button>
      </div>

      {sheet?.type === 'say' && (
        <TextSheet
          title="Add ingredients"
          placeholder={'e.g. 2 cups flour, 1 cup sugar, 3 eggs, 1 stick butter, 1 teaspoon salt\n\nYou can also paste a whole recipe.'}
          hint="Tap the keyboard mic and list everything with amounts. You can add more anytime."
          submitLabel="Add ingredients"
          maxLength={4000}
          rows={6}
          onSubmit={onSay}
          onClose={closeSheet}
        />
      )}

      {sheet?.type === 'recent' && (
        <RecentSheet
          title="Add from recent"
          hint="Tap foods to add them as ingredients, then set amounts."
          onClose={closeSheet}
          onPick={(f) => {
            addFoods([f.food]);
            toast({ message: `Added ${f.food.name}` });
          }}
        />
      )}

      {(sheet?.type === 'working' || sheet?.type === 'error') && (
        <Sheet
          title={sheet.type === 'working' ? 'Working' : "Couldn't add that"}
          onClose={closeSheet}
          footer={
            sheet.type === 'error' ? (
              <button class="secondary-btn" onClick={() => setSheet({ type: 'say' })}>
                Type or say it instead
              </button>
            ) : undefined
          }
        >
          {sheet.thumb && (
            <div class="thumb-wrap">
              <img class="thumb" src={sheet.thumb} alt="Your photo" />
              {sheet.type === 'working' && <div class="scan-line" />}
            </div>
          )}
          {sheet.type === 'working' ? (
            <div class="working">
              <span class="spinner" aria-hidden="true" /> {sheet.message}
            </div>
          ) : (
            <div class="error-box">{sheet.message}</div>
          )}
        </Sheet>
      )}

      {sheet?.type === 'ingredient' && editing && (
        <Sheet
          title="Ingredient"
          onClose={closeSheet}
          footer={
            <div class="foot-row">
              <button class="danger-btn" onClick={() => removeIngredient(editing)}>
                <Icon name="trash" size={20} /> Remove
              </button>
              <button class="primary-btn" onClick={closeSheet}>
                Done
              </button>
            </div>
          }
        >
          {sheet.hint && <p class="hint strong-hint">{sheet.hint}</p>}
          <ItemEditor
            food={editing.food}
            qty={editing.qty}
            onQty={(q) =>
              update({ ingredients: latest.current.ingredients.map((i) => (i.id === editing.id ? { ...i, qty: q } : i)) })
            }
          />
          {editing.food.sourceDetail && <p class="hint">Source: {editing.food.sourceDetail}</p>}
        </Sheet>
      )}
    </div>
  );
}
