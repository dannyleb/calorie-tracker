import { amount } from './amount';
import { analyze } from './analyze';
import { checkPasscode } from './auth';
import { barcode } from './barcode';
import { health } from './health';
import { json, type Env } from './http';

/** Handles every /api/* request: rate limit, then passcode, then route. */
export async function handleApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  // Limit every caller (right passcode or not) per IP. This caps passcode
  // guessing and how fast a leaked passcode could spend AI credit.
  if (env.API_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const { success } = await env.API_LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  }

  const denied = await checkPasscode(request, env);
  if (denied) return denied;

  const { pathname } = new URL(request.url);
  const route = `${request.method} ${pathname.replace(/\/+$/, '')}`;
  switch (route) {
    case 'POST /api/analyze':
      return analyze(request, env);
    case 'GET /api/barcode':
      return barcode(request, env);
    case 'POST /api/amount':
      return amount(request, env);
    case 'GET /api/health':
      return health(env);
    default:
      return json({ error: 'Not found.' }, 404);
  }
}
