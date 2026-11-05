import { addInto, emptyNutrients, scaleNutrients, type FoodItem, type Nutrients } from '../../shared/types';

export interface Ingredient {
  id: string;
  /** Nutrients are per `food.unit`; `qty` is how many units the recipe uses. */
  food: FoodItem;
  qty: number;
}

export interface Recipe {
  id: string;
  name: string;
  servings: number;
  /** Optional weight of the finished dish, so servings can be logged by grams. */
  cookedGrams: number | null;
  ingredients: Ingredient[];
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_SERVINGS = 4;

export const recipeName = (r: Pick<Recipe, 'name'>) => r.name.trim() || 'Untitled recipe';

export function newRecipe(id: string): Recipe {
  const now = Date.now();
  return { id, name: '', servings: DEFAULT_SERVINGS, cookedGrams: null, ingredients: [], createdAt: now, updatedAt: now };
}

export function ingredientNutrients(i: Ingredient): Nutrients {
  return scaleNutrients(i.food.perUnit, i.qty);
}

/** Nutrients for the whole recipe. */
export function recipeTotal(r: Recipe): Nutrients {
  const total = emptyNutrients();
  for (const i of r.ingredients) addInto(total, ingredientNutrients(i));
  return total;
}

/** Raw weight of all ingredients, or null if any ingredient's weight is unknown. */
export function rawGrams(r: Recipe): number | null {
  let sum = 0;
  for (const i of r.ingredients) {
    if (!i.food.unitGrams) return null;
    sum += i.food.unitGrams * i.qty;
  }
  return r.ingredients.length ? sum : null;
}

/**
 * One serving of the recipe as a loggable food. The log keeps this snapshot,
 * so editing the recipe later doesn't rewrite past days.
 */
export function recipeServingFood(r: Recipe): FoodItem {
  const servings = Math.max(1, r.servings);
  const total = recipeTotal(r);
  const grams = r.cookedGrams || rawGrams(r);
  const unitGrams = grams ? grams / servings : null;
  const n = r.ingredients.length;
  return {
    name: recipeName(r),
    unit: `1 serving (of ${servings})${unitGrams ? ` · ${Math.round(unitGrams)} g` : ''}`,
    unitGrams,
    perUnit: scaleNutrients(total, 1 / servings),
    source: 'recipe',
    sourceDetail: `Recipe · ${n} ingredient${n === 1 ? '' : 's'}${r.cookedGrams ? ' · by cooked weight' : ''}`,
  };
}
