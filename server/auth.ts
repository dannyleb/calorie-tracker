import { json, type Env } from './http';

// Every /api/* request must carry the passcode set in APP_PASSCODE.
// This keeps strangers from spending your Anthropic credit if they find the URL.
// Together with the per-IP rate limit (router.ts), a passcode of 12+ characters
// can't practically be guessed.

export const MIN_PASSCODE_LENGTH = 12;

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

/** Returns an error response if the passcode is missing or wrong, otherwise null. */
export async function checkPasscode(request: Request, env: Env): Promise<Response | null> {
  const expected = env.APP_PASSCODE;
  if (!expected) {
    return json({ error: 'Server not set up: add the APP_PASSCODE secret in Cloudflare.' }, 503);
  }
  if (expected.length < MIN_PASSCODE_LENGTH) {
    return json(
      {
        error: `APP_PASSCODE is too short to be safe. In Cloudflare, change it to at least ${MIN_PASSCODE_LENGTH} characters (3–4 random words works well), then enter the new one here.`,
      },
      503,
    );
  }
  const given = (request.headers.get('x-app-passcode') || '').slice(0, 512);
  if (!(await safeEqual(given, expected))) {
    return json({ error: 'Wrong or missing passcode. Set it in Settings.' }, 401);
  }
  return null;
}
