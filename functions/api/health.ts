import { modelFor } from '../_lib/claude';
import { json, type Env } from '../_lib/http';

// Reached only after the passcode check in _middleware.ts, so a 200 here means
// the passcode is right. Reports which keys are configured (never their values).
export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  json({
    ok: true,
    model: modelFor(env),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    usda: Boolean(env.USDA_API_KEY),
  });
