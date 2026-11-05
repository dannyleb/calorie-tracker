import { cleanText, num, type AmountResponse } from '../shared/types';
import { claudeJSON } from './claude';
import { HttpError, errorResponse, json, readJson, type Env } from './http';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['multiplier', 'note'],
  properties: {
    multiplier: { type: 'number' },
    note: { type: 'string' },
  },
};

const SYSTEM = `You convert a spoken or typed portion into a multiplier of a reference portion for a food log.
Return multiplier = (amount the user describes) / (reference portion). Use standard densities and typical sizes when units differ (cups vs grams, "a handful", "a big bowl").
note: a few words showing the conversion, e.g. "1/2 cup ≈ 41 g". If the request is not an amount, return multiplier 1 and say so in note.`;

interface Body {
  name?: unknown;
  unit?: unknown;
  unitGrams?: unknown;
  text?: unknown;
}

export async function amount(request: Request, env: Env): Promise<Response> {
  try {
    const body = await readJson<Body>(request, 10_000);
    const text = cleanText(body.text, 200);
    if (!text) throw new HttpError(400, 'Say or type an amount.');
    const grams = Math.min(num(body.unitGrams), 5000);
    const ref = `${cleanText(body.name, 100) || 'Food'}, reference portion = ${cleanText(body.unit, 120) || '1 serving'}${
      grams ? ` (${Math.round(grams)} g)` : ''
    }`;
    const out = await claudeJSON<AmountResponse>(env, {
      system: SYSTEM,
      content: [{ type: 'text', text: `Food: ${ref}\nUser said: "${text}"` }],
      schema: SCHEMA,
    });
    const m = Number(out.multiplier);
    if (!Number.isFinite(m) || m <= 0 || m > 100) throw new HttpError(422, "Couldn't understand that amount.");
    return json({ multiplier: m, note: cleanText(out.note, 120) } satisfies AmountResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
