export interface Env {
  /** Required. Anthropic API key (platform.claude.com). */
  ANTHROPIC_API_KEY?: string;
  /** Required. Shared passcode the app sends with every API request. */
  APP_PASSCODE?: string;
  /** Recommended. USDA FoodData Central key (free at api.data.gov). Without it, AI estimates are used. */
  USDA_API_KEY?: string;
  /** Optional. Defaults to claude-opus-5-5. */
  CLAUDE_MODEL?: string;
  /** Optional. low | medium | high. Defaults to low (fastest). */
  CLAUDE_EFFORT?: string;
  /** Optional. Route Claude calls through a proxy such as Cloudflare AI Gateway. */
  ANTHROPIC_BASE_URL?: string;
  /** The built app (dist/), bound in wrangler.jsonc. */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Per-IP request limiter, bound in wrangler.jsonc. Optional so the app still runs without it. */
  API_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  console.error(err);
  return json({ error: 'Something went wrong on the server. Try again.' }, 500);
}

/**
 * Read a JSON body, stopping as soon as it exceeds `maxBytes` (even when the
 * client doesn't declare a size), and only for JSON content types.
 */
export async function readJson<T>(request: Request, maxBytes: number): Promise<T> {
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Expected JSON.');
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'That upload is too large.');
  if (!request.body) throw new HttpError(400, 'Empty request body.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, 'That upload is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as T;
  } catch {
    throw new HttpError(400, 'Invalid request body.');
  }
}

/** Fetch with a timeout so a slow upstream can't hang the request. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
