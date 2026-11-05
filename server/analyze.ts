import type Anthropic from '@anthropic-ai/sdk';
import { cleanText, sanitizeFood, type AnalyzeResponse, type FoodItem } from '../shared/types';
import { claudeJSON } from './claude';
import { resolveItem, type RawItem } from './foods';
import { HttpError, errorResponse, json, readJson, type Env } from './http';

const NUTRIENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'calories',
    'protein',
    'carbs',
    'fat',
    'satFat',
    'transFat',
    'cholesterol',
    'fiber',
    'solubleFiber',
    'sugar',
    'sodium',
  ],
  properties: {
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
    satFat: { type: 'number' },
    transFat: { type: 'number' },
    cholesterol: { type: 'number' },
    fiber: { type: 'number' },
    solubleFiber: { type: 'number' },
    sugar: { type: 'number' },
    sodium: { type: 'number' },
  },
};

const ANALYZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'note', 'items'],
  properties: {
    kind: { type: 'string', enum: ['food', 'nutrition_label', 'packaged_product', 'not_food'] },
    note: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'amount', 'grams', 'from_label', 'usda_query', 'confidence', 'nutrients'],
        properties: {
          name: { type: 'string' },
          amount: { type: 'string' },
          grams: { type: 'number' },
          from_label: { type: 'boolean' },
          usda_query: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          nutrients: NUTRIENT_SCHEMA,
        },
      },
    },
  },
};

const SYSTEM = `You are the food-recognition step of a personal nutrition tracker. The user is managing high LDL cholesterol, so saturated fat, trans fat, dietary cholesterol and fiber need to be as accurate as you can make them.

Identify what was eaten and fill the JSON schema.

How to handle each input:
- Food (raw fruit or vegetables, a plated meal, a snack, a drink): one item per distinct food. Estimate the edible portion in grams from visual cues such as plate size (a dinner plate is about 27 cm), cutlery, hands and packaging. With no size cues, assume a typical single portion. Exclude inedible parts (peel, bones, pits, shells) from grams.
- Nutrition Facts label: return one item with values copied exactly from the label for ONE serving. Set from_label=true, grams = the printed serving weight in grams (treat ml as grams), amount = the printed serving size such as "2/3 cup". Name it after the product if the name is visible; otherwise describe it ("Granola"). Use 0 for nutrients the label does not list, except estimate solubleFiber.
- Packaged product without a readable label: identify the product and estimate one typical serving.
- Not food: kind = "not_food", items = [], and say briefly in note what you see.

For every item:
- name: short and plain, e.g. "Banana", "Scrambled eggs", "Whole wheat toast".
- amount: a household measure for the portion, e.g. "1 medium", "1 cup", "2 slices". Do not repeat the grams here.
- nutrients: your best estimate for the stated grams. Units: calories in kcal; cholesterol and sodium in mg; everything else in g. solubleFiber is the soluble share of dietary fiber (0 if none).
- usda_query: for generic foods, a search string written the way USDA FoodData Central names foods, e.g. "Bananas, raw", "Egg, whole, cooked, scrambled", "Bread, whole-wheat, toasted", "Pizza, cheese, regular crust". Use "" for label items and branded products.
- confidence: how sure you are of both the food and the portion.

note: one short sentence only when useful (e.g. "Portion is an estimate, adjust if needed."); otherwise "".`;

const TEXT_PREFIX = `The user described what they ate, usually by voice dictation, so expect transcription errors. Quantities they state override typical portions. If they name a brand or restaurant item, estimate from what you know about it.\n\nWhat they said: `;

interface Body {
  image?: unknown; // base64 JPEG, no data: prefix
  text?: unknown;
}

const KINDS: AnalyzeResponse['kind'][] = ['food', 'nutrition_label', 'packaged_product', 'not_food'];
// A 1280 px JPEG from the app is ~0.2-0.5 MB of base64; 4 MB leaves plenty of room.
const MAX_BODY = 4_000_000;

export async function analyze(request: Request, env: Env): Promise<Response> {
  try {
    const body = await readJson<Body>(request, MAX_BODY);
    const text = cleanText(body.text, 1000);
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (typeof body.image === 'string' && body.image) {
      const data = body.image.replace(/^data:image\/jpeg;base64,/, '');
      // Whole string must be base64 and decode to a JPEG (starts with FF D8 FF -> "/9j/").
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || !data.startsWith('/9j/')) {
        throw new HttpError(400, 'Invalid image data.');
      }
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
      content.push({ type: 'text', text: text ? `Extra context from the user: ${text.slice(0, 500)}` : 'What is in this photo?' });
    } else if (text) {
      content.push({ type: 'text', text: TEXT_PREFIX + text });
    } else {
      throw new HttpError(400, 'Send a photo or a description.');
    }

    const raw = await claudeJSON<{ kind: AnalyzeResponse['kind']; note: string; items: RawItem[] }>(env, {
      system: SYSTEM,
      content,
      schema: ANALYZE_SCHEMA,
    });

    const rawItems = Array.isArray(raw.items) ? raw.items.slice(0, 12) : [];
    const resolved = await Promise.all(rawItems.map((it) => resolveItem(it, env.USDA_API_KEY)));
    const items = resolved.map(sanitizeFood).filter((f): f is FoodItem => f !== null);
    const result: AnalyzeResponse = {
      kind: KINDS.includes(raw.kind) ? raw.kind : 'food',
      note: cleanText(raw.note, 300),
      items,
    };
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
