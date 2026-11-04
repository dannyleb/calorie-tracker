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

export async function readJson<T>(request: Request, maxBytes: number): Promise<T> {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'That upload is too large.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'That upload is too large.');
  try {
    return JSON.parse(text) as T;
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
