import { describe, expect, it } from 'vitest';
import { offPer100g } from '../server/off';
import { handleApi } from '../server/router';
import { readJson, type Env } from '../server/http';
import { per100g } from '../server/usda';
import worker from '../worker/index';
import { cleanText, sanitizeFood } from '../shared/types';
import { sanitizeEntry, sanitizeSavedFood, sanitizeTargets } from '../src/lib/backup';
import { csvCell } from '../src/lib/csv';

const GOOD = 'correct horse battery staple';
const assets = { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) };
const env = (over: Partial<Env> = {}): Env => ({ APP_PASSCODE: GOOD, ASSETS: assets, ...over });
const req = (path: string, init: RequestInit & { pass?: string } = {}) =>
  new Request(`https://app.example${path}`, {
    ...init,
    headers: { ...(init.pass !== undefined ? { 'x-app-passcode': init.pass } : {}), ...((init.headers as object) ?? {}) },
  });

describe('passcode', () => {
  it('rejects requests when no passcode is configured', async () => {
    const res = await handleApi(req('/api/health', { pass: GOOD }), env({ APP_PASSCODE: undefined }));
    expect(res.status).toBe(503);
  });

  it('refuses to run with a short passcode', async () => {
    const res = await handleApi(req('/api/health', { pass: '1234' }), env({ APP_PASSCODE: '1234' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/at least 12/);
  });

  it('rejects a wrong or missing passcode', async () => {
    expect((await handleApi(req('/api/health', { pass: 'nope' }), env())).status).toBe(401);
    expect((await handleApi(req('/api/health'), env())).status).toBe(401);
  });

  it('accepts the right passcode', async () => {
    const res = await handleApi(req('/api/health', { pass: GOOD }), env());
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(GOOD);
  });

  it('checks the passcode before revealing which routes exist', async () => {
    expect((await handleApi(req('/api/secret-route'), env())).status).toBe(401);
  });
});

describe('rate limiting', () => {
  it('blocks callers over the limit before checking the passcode', async () => {
    let seen = '';
    const limiter = { limit: async ({ key }: { key: string }) => ((seen = key), { success: false }) };
    const res = await handleApi(
      req('/api/health', { pass: GOOD, headers: { 'cf-connecting-ip': '203.0.113.9' } }),
      env({ API_LIMITER: limiter }),
    );
    expect(res.status).toBe(429);
    expect(seen).toBe('203.0.113.9');
  });

  it('lets callers under the limit through', async () => {
    const res = await handleApi(req('/api/health', { pass: GOOD }), env({ API_LIMITER: { limit: async () => ({ success: true }) } }));
    expect(res.status).toBe(200);
  });

  it('only allows GET and POST', async () => {
    expect((await handleApi(req('/api/health', { method: 'DELETE', pass: GOOD }), env())).status).toBe(405);
  });
});

describe('request bodies', () => {
  const big = 'x'.repeat(5000);
  it('rejects non-JSON content types', async () => {
    const r = new Request('https://a/', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } });
    await expect(readJson(r, 100)).rejects.toMatchObject({ status: 415 });
  });

  it('stops reading at the size limit even without a declared length', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`{"a":"${big}"}`));
        c.close();
      },
    });
    const r = new Request('https://a/', {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'application/json' },
      // @ts-expect-error Node needs this for streaming bodies
      duplex: 'half',
    });
    await expect(readJson(r, 1000)).rejects.toMatchObject({ status: 413 });
  });

  it('rejects JSON that is not an object', async () => {
    const r = new Request('https://a/', { method: 'POST', body: '[1,2]', headers: { 'content-type': 'application/json' } });
    await expect(readJson(r, 100)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects images that are not base64 JPEG', async () => {
    const r = req('/api/analyze', {
      method: 'POST',
      pass: GOOD,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: 'PHN2Zz48L3N2Zz4=' }), // "<svg></svg>"
    });
    const res = await handleApi(r, env({ ANTHROPIC_API_KEY: 'k' }));
    expect(res.status).toBe(400);
  });
});

describe('worker', () => {
  it('adds security headers to app pages', async () => {
    const res = await worker.fetch(req('/'), env());
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('adds security headers to API responses', async () => {
    const res = await worker.fetch(req('/api/health'), env());
    expect(res.status).toBe(401);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('redirects plain HTTP to HTTPS', async () => {
    const res = await worker.fetch(new Request('http://app.example/x?y=1'), env());
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://app.example/x?y=1');
  });
});

describe('untrusted data', () => {
  it('drops impossible nutrient values from food databases', () => {
    const usda = per100g({ fdcId: 1, description: 'x', foodNutrients: [{ nutrientNumber: '208', value: 1e9, unitName: 'KCAL' }, { nutrientNumber: '601', value: 50, unitName: 'MG' }] });
    expect(usda.calories).toBeUndefined();
    expect(usda.cholesterol).toBe(50);
    const off = offPer100g({ nutriments: { 'energy-kcal_100g': 99999, 'sodium_100g': 0.5 } });
    expect(off.calories).toBeUndefined();
    expect(off.sodium).toBeCloseTo(500);
  });

  it('strips control characters and caps text length', () => {
    expect(cleanText('Ban\u0000ana\n\u2028<b>', 100)).toBe('Ban ana <b>');
    expect(cleanText('x'.repeat(500), 10)).toHaveLength(10);
    expect(cleanText(42, 10)).toBe('');
  });

  it('rebuilds foods from only valid fields', () => {
    const f = sanitizeFood({
      name: 'A'.repeat(300),
      unit: 5,
      unitGrams: 'lots',
      perUnit: { calories: '120', satFat: -3, cholesterol: 1e12, sodium: NaN },
      source: 'evil',
      confidence: 'certain',
      missing: ['satFat', 'constructor'],
      extra: 'dropped',
    })!;
    expect(f.name).toHaveLength(100);
    expect(f.unit).toBe('1 serving');
    expect(f.unitGrams).toBeNull();
    expect(f.perUnit.calories).toBe(120);
    expect(f.perUnit.satFat).toBe(0);
    expect(f.perUnit.cholesterol).toBe(20000);
    expect(f.source).toBe('ai');
    expect(f.confidence).toBeUndefined();
    expect(f.missing).toEqual(['satFat']);
    expect('extra' in f).toBe(false);
    expect(sanitizeFood({ name: '' })).toBeNull();
    expect(sanitizeFood('x')).toBeNull();
  });
});

describe('backup restore', () => {
  const good = { id: 'a1', date: '2026-11-04', ts: 1, qty: 1.5, food: { name: 'Banana', unit: '1 medium', unitGrams: 118, perUnit: { calories: 105 }, source: 'usda' } };

  it('keeps valid entries and rejects malformed ones', () => {
    expect(sanitizeEntry(good)?.food.perUnit.calories).toBe(105);
    expect(sanitizeEntry({ ...good, date: '2026-13-40' })).toBeNull();
    expect(sanitizeEntry({ ...good, date: '../../x' })).toBeNull();
    expect(sanitizeEntry({ ...good, qty: 1e9 })).toBeNull();
    expect(sanitizeEntry({ ...good, ts: 'now' })).toBeNull();
    expect(sanitizeEntry({ ...good, food: null })).toBeNull();
    expect(sanitizeEntry(null)).toBeNull();
  });

  it('sanitizes saved foods and targets', () => {
    expect(sanitizeSavedFood({ key: 'k', food: good.food, favorite: 'yes', lastQty: -1 })).toMatchObject({ favorite: false, lastQty: 1 });
    expect(sanitizeTargets({ satFat: 13, calories: 'lots', __proto__: { polluted: 1 }, bogus: 5 })).toEqual({ satFat: 13 });
  });
});

describe('CSV export', () => {
  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('Banana, raw')).toBe('"Banana, raw"');
    expect(csvCell(-5)).toBe('-5'); // real numbers stay numbers
  });
});
