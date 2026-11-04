import { amount } from './amount';
import { analyze } from './analyze';
import { checkPasscode } from './auth';
import { barcode } from './barcode';
import { health } from './health';
import { json, type Env } from './http';

/** Handles every /api/* request. */
export async function handleApi(request: Request, env: Env): Promise<Response> {
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
