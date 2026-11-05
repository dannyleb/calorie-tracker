// Security headers for every response (the app and the API).

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the barcode reader (WebAssembly) compile; no JS eval is allowed.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  // blob: for the photo preview
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Plain-HTTP request to a public host: redirect to HTTPS. */
export function httpsRedirect(url: URL): Response | null {
  if (url.protocol !== 'http:' || LOCAL_HOSTS.has(url.hostname)) return null;
  const to = new URL(url);
  to.protocol = 'https:';
  return Response.redirect(to.toString(), 301);
}
