import type { AmountResponse, AnalyzeResponse, BarcodeResponse, FoodItem } from '../../shared/types';
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

export const analyzePhoto = (image: string, note?: string) =>
  call<AnalyzeResponse>('/api/analyze', { method: 'POST', body: JSON.stringify({ image, text: note }) });

export const analyzeText = (text: string) =>
  call<AnalyzeResponse>('/api/analyze', { method: 'POST', body: JSON.stringify({ text }) });

export const lookupBarcode = (code: string) => call<BarcodeResponse>(`/api/barcode?code=${encodeURIComponent(code)}`);

export const parseAmount = (food: FoodItem, text: string) =>
  call<AmountResponse>('/api/amount', {
    method: 'POST',
    body: JSON.stringify({ name: food.name, unit: food.unit, unitGrams: food.unitGrams, text }),
  });

export const health = () => call<{ ok: boolean; model: string; anthropic: boolean; usda: boolean }>('/api/health');
