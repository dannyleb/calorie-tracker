import {
  cleanText,
  sanitizeFood,
  type AmountResponse,
  type AnalyzeMode,
  type AnalyzeResponse,
  type BarcodeResponse,
  type FoodItem,
} from '../../shared/types';
import { loadSettings } from './settings';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const passcode = loadSettings().passcode;
  if (!passcode) throw new ApiError('Set your passcode in Settings to use AI features.', 401);
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-app-passcode': passcode, ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new ApiError(body?.error || `Server error (${res.status}).`, res.status);
  if (body === null) {
    // e.g. the static site answered instead of the API (mid-deploy or misconfigured)
    throw new ApiError("The server didn't answer as expected. If you just deployed, wait a minute and try again.", res.status);
  }
  return body as T;
}

// Server data is re-validated here before it is shown or saved (defense in depth).
function cleanAnalyze(r: AnalyzeResponse): AnalyzeResponse {
  const out: AnalyzeResponse = {
    kind: r.kind,
    note: cleanText(r.note, 300),
    items: (Array.isArray(r.items) ? r.items : []).map(sanitizeFood).filter((f): f is FoodItem => f !== null),
  };
  const name = cleanText(r.recipeName, 100);
  if (name) out.recipeName = name;
  const servings = Number(r.servings);
  if (Number.isInteger(servings) && servings >= 1 && servings <= 100) out.servings = servings;
  return out;
}

export const analyzePhoto = (image: string, mode: AnalyzeMode = 'log', note?: string) =>
  call<AnalyzeResponse>('/api/analyze', { method: 'POST', body: JSON.stringify({ image, text: note, mode }) }).then(cleanAnalyze);

export const analyzeText = (text: string, mode: AnalyzeMode = 'log') =>
  call<AnalyzeResponse>('/api/analyze', { method: 'POST', body: JSON.stringify({ text, mode }) }).then(cleanAnalyze);

export const lookupBarcode = (code: string) =>
  call<BarcodeResponse>(`/api/barcode?code=${encodeURIComponent(code)}`).then((r) => {
    const food = r.found ? sanitizeFood(r.food) : null;
    return food ? { found: true, code, food } : { found: false, code };
  });

export const parseAmount = (food: FoodItem, text: string) =>
  call<AmountResponse>('/api/amount', {
    method: 'POST',
    body: JSON.stringify({ name: food.name, unit: food.unit, unitGrams: food.unitGrams, text }),
  }).then((r) => {
    const m = Number(r.multiplier);
    if (!Number.isFinite(m) || m <= 0 || m > 1000) throw new ApiError("Couldn't understand that amount.", 422);
    return { multiplier: m, note: cleanText(r.note, 120) };
  });

export const health = () => call<{ ok: boolean; model: string; anthropic: boolean; usda: boolean }>('/api/health');
