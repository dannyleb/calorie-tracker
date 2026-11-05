import type { Env } from '../server/http';
import { handleApi } from '../server/router';
import { httpsRedirect, withSecurityHeaders } from '../server/security';

// Cloudflare Worker entry. Every request comes through here (run_worker_first in
// wrangler.jsonc) so security headers apply to the app and the API alike.
// /api/* goes to the server code; everything else is the built app in dist/.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const redirect = httpsRedirect(url);
    if (redirect) return redirect;
    const res = url.pathname.startsWith('/api/') ? await handleApi(request, env) : await env.ASSETS.fetch(request);
    return withSecurityHeaders(res);
  },
};
