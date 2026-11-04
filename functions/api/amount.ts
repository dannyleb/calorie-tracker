import type { AmountResponse } from '../../shared/types';
import { claudeJSON } from '../_lib/claude';
import { HttpError, errorResponse, json, readJson, type Env } from '../_lib/http';

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
  name?: string;
  unit?: string;
  unitGrams?: number | null;
  text?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await readJson<Body>(request, 10_000);
    const text = body.text?.trim().slice(0, 300);
    if (!text) throw new HttpError(400, 'Say or type an amount.');
    const ref = `${body.name ?? 'Food'}, reference portion = ${body.unit ?? '1 serving'}${
      body.unitGrams ? ` (${Math.round(body.unitGrams)} g)` : ''
    }`;
    const out = await claudeJSON<AmountResponse>(env, {
      system: SYSTEM,
      content: [{ type: 'text', text: `Food: ${ref}\nUser said: "${text}"` }],
      schema: SCHEMA,
    });
    const m = Number(out.multiplier);
    if (!Number.isFinite(m) || m <= 0 || m > 100) throw new HttpError(422, "Couldn't understand that amount.");
    return json({ multiplier: m, note: out.note ?? '' } satisfies AmountResponse);
  } catch (err) {
    return errorResponse(err);
  }
};
