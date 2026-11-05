import { sanitizeFood, type BarcodeResponse } from '../shared/types';
import { foodFromFdc, foodFromOff } from './foods';
import { HttpError, errorResponse, json, type Env } from './http';
import { findOff } from './off';
import { findBranded } from './usda';

export async function barcode(request: Request, env: Env): Promise<Response> {
  try {
    const code = new URL(request.url).searchParams.get('code')?.trim() ?? '';
    if (!/^\d{6,14}$/.test(code)) throw new HttpError(400, 'That barcode does not look valid.');

    if (env.USDA_API_KEY) {
      try {
        const hit = await findBranded(code, env.USDA_API_KEY);
        const food = hit && sanitizeFood(foodFromFdc(hit));
        if (food) return json({ found: true, code, food } satisfies BarcodeResponse);
      } catch (err) {
        console.warn('USDA barcode lookup failed', err);
      }
    }

    try {
      const p = await findOff(code);
      const food = p && sanitizeFood(foodFromOff(p));
      if (food) return json({ found: true, code, food } satisfies BarcodeResponse);
    } catch (err) {
      console.warn('Open Food Facts lookup failed', err);
    }

    return json({ found: false, code } satisfies BarcodeResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
