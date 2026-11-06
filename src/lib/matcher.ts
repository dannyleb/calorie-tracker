// Matches what the user says ("2 slices of toast and a banana") against foods
// they've logged before, on the phone, with no AI. Conservative on purpose:
// a part is matched only when the food name matches exactly (ignoring plurals,
// size words and filler) and the amount can be worked out with certainty.
// Everything else is left for the AI.

import type { FoodItem } from '../../shared/types';
import type { SavedFood } from './db';
import { normalizePhrase } from './memory';
import { recipeServingFood, type Recipe } from './recipes';

export interface Candidate {
  food: FoodItem;
  /** Amount to use when the user doesn't say one. */
  defaultQty: number;
  lastUsed: number;
}

export interface MatchedPart {
  phrase: string;
  food: FoodItem;
  qty: number;
}

export interface MatchResult {
  matched: MatchedPart[];
  unmatched: string[];
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, half: 0.5, quarter: 0.25, couple: 2, dozen: 12,
};
const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

const UNITS: Record<string, string> = {
  g: 'g', gr: 'g', gram: 'g', grams: 'g',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  ml: 'ml',
  cup: 'cup', cups: 'cup',
  slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece',
  serving: 'serving', servings: 'serving', portion: 'serving', portions: 'serving',
  bowl: 'bowl', bowls: 'bowl',
  glass: 'glass', glasses: 'glass',
  can: 'can', cans: 'can',
  bottle: 'bottle', bottles: 'bottle',
  bar: 'bar', bars: 'bar',
  scoop: 'scoop', scoops: 'scoop',
  stick: 'stick', sticks: 'stick',
  handful: 'handful', handfuls: 'handful',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
};
const WEIGHT_UNITS = new Set(['g', 'oz', 'ml']);
/** Ignored when comparing names: "a large banana" is a banana. */
const IGNORED = new Set(['a', 'an', 'the', 'some', 'of', 'my', 'large', 'medium', 'small', 'big', 'little', 'jumbo', 'extra']);

function singular(w: string): string {
  if (w.length <= 3 || w.endsWith('ss') || w.endsWith('us')) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(ches|shes|xes|sses|oes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** Comparable form of a food name. */
export function nameKey(s: string): string {
  return normalizePhrase(s)
    .split(' ')
    .filter((w) => w && !IGNORED.has(w))
    .map(singular)
    .join(' ');
}

function num(tok: string | undefined): number | null {
  if (!tok) return null;
  if (tok in FRACTIONS) return FRACTIONS[tok];
  const glued = tok.match(/^(\d+)([½¼¾⅓⅔])$/);
  if (glued) return Number(glued[1]) + FRACTIONS[glued[2]];
  if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok);
  const frac = tok.match(/^(\d+)\/(\d+)$/);
  if (frac && Number(frac[2])) return Number(frac[1]) / Number(frac[2]);
  return tok in NUMBER_WORDS ? NUMBER_WORDS[tok] : null;
}

export interface ParsedPart {
  count: number | null;
  unit: string | null;
  food: string;
}

/** "2 slices of toast" -> { count: 2, unit: 'slice', food: 'toast' } */
export function parsePart(part: string): ParsedPart {
  // "150g" -> "150 g"
  const tokens = normalizePhrase(part).replace(/(\d)(g|oz|ml)\b/g, '$1 $2').split(' ').filter(Boolean);
  let i = 0;
  let count: number | null = null;

  const first = num(tokens[0]);
  if (first !== null) {
    count = first;
    i = 1;
    const second = num(tokens[1]);
    // "1 1/2" (digits only), or word pairs like "a dozen" / "a half"
    if (second !== null && second < 1 && /^\d+$/.test(tokens[0]) && !(tokens[1] in NUMBER_WORDS)) {
      count = first + second;
      i = 2;
    } else if (second !== null && tokens[0] in NUMBER_WORDS && first === 1 && tokens[1] !== 'a') {
      count = second;
      i = 2;
    }
    // "half a ..." / "half of ..."
    if (tokens[i] === 'a' || tokens[i] === 'an') i++;
  }

  let unit: string | null = null;
  if (tokens[i] && tokens[i] in UNITS) {
    unit = UNITS[tokens[i]];
    i++;
  }
  if (tokens[i] === 'of') i++;
  return { count, unit, food: tokens.slice(i).join(' ') };
}

/** Leading count and unit of a food's unit text: "2 large eggs · 120 g" -> 2, null. */
function unitShape(unit: string): { count: number; noun: string | null } {
  const p = parsePart(unit);
  return { count: p.count ?? 1, noun: p.unit };
}

/** How many of the candidate's units the user means, or null if unsure. */
export function resolveQty(c: Candidate, p: ParsedPart): number | null {
  const grams = c.food.unitGrams;
  let q: number | null;
  if (p.count === null && p.unit === null) q = c.defaultQty;
  else if (p.unit === 'g') q = grams && p.count ? p.count / grams : null;
  else if (p.unit === 'oz') q = grams && p.count ? (p.count * 28.35) / grams : null;
  else if (p.unit === 'ml') q = null;
  else {
    const shape = unitShape(c.food.unit);
    const count = p.count ?? 1;
    if (p.unit) {
      const same = shape.noun === p.unit || (p.unit === 'serving' && (shape.noun === null || shape.noun === 'serving'));
      q = same ? count / shape.count : null;
    } else if (shape.noun && WEIGHT_UNITS.has(shape.noun)) {
      // A bare number against a weight-based unit is only safe when it is clearly grams.
      q = grams && count > 20 ? count / grams : null;
    } else {
      q = count / shape.count;
    }
  }
  return q !== null && Number.isFinite(q) && q > 0 && q <= 50 ? q : null;
}

/** Foods the user has logged, their recipes, and (for recipes) past ingredients. */
export function buildCandidates(foods: SavedFood[], recipes: Recipe[], includeIngredients: boolean): Map<string, Candidate> {
  const map = new Map<string, Candidate>();
  const add = (name: string, c: Candidate) => {
    const key = nameKey(name);
    if (!key) return;
    const prev = map.get(key);
    if (!prev || c.lastUsed > prev.lastUsed) map.set(key, c);
  };
  for (const f of foods) {
    const c = { food: f.food, defaultQty: f.lastQty, lastUsed: f.lastUsed };
    add(f.food.name, c);
    if (f.food.brand) add(`${f.food.brand} ${f.food.name}`, c);
  }
  for (const r of recipes) {
    if (!r.ingredients.length || !r.name.trim()) continue;
    add(r.name, { food: recipeServingFood(r), defaultQty: 1, lastUsed: r.updatedAt });
    if (includeIngredients) {
      for (const ing of r.ingredients) add(ing.food.name, { food: ing.food, defaultQty: ing.qty, lastUsed: r.updatedAt - 1 });
    }
  }
  return map;
}

function tryMatch(part: string, candidates: Map<string, Candidate>): MatchedPart | null {
  const p = parsePart(part);
  const c = candidates.get(nameKey(p.food));
  if (!c) return null;
  const qty = resolveQty(c, p);
  return qty === null ? null : { phrase: part.trim(), food: c.food, qty };
}

/** Split what was said into parts and match each one. */
export function matchText(text: string, candidates: Map<string, Candidate>): MatchResult {
  const result: MatchResult = { matched: [], unmatched: [] };
  if (!candidates.size) {
    result.unmatched.push(text.trim());
    return result;
  }
  const cleaned = text
    .replace(/^\s*(i\s+)?(just\s+)?(had|ate|eat|have|drank)\s+/i, '')
    .replace(/\b(one|two|three|four|five|\d+)\s+and\s+a\s+half\b/gi, (_, n: string) => `${(num(n.toLowerCase()) ?? 0) + 0.5}`);

  for (const chunk of cleaned.split(/[,;\n]+|\s[+&]\s/)) {
    if (!chunk.trim()) continue;
    // Whole chunk first, so a saved "Mac and cheese" isn't split in two.
    const whole = tryMatch(chunk, candidates);
    if (whole) {
      result.matched.push(whole);
      continue;
    }
    for (const sub of chunk.split(/\s+(?:and|with|plus)\s+/i)) {
      if (!sub.trim()) continue;
      const m = tryMatch(sub, candidates);
      if (m) result.matched.push(m);
      else result.unmatched.push(sub.trim());
    }
  }
  return result;
}
