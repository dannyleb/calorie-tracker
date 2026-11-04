import type { Env } from '../server/http';
import { handleApi } from '../server/router';

// Cloudflare Worker entry. /api/* goes to the server code; everything else is
// the built app in dist/, served by Cloudflare's static assets (see wrangler.jsonc).
export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
