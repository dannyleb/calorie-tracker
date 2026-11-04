import { modelFor } from './claude';
import { json, type Env } from './http';

// Reached only after the passcode check, so a 200 here means the passcode is
// right. Reports which keys are configured (never their values).
export const health = (env: Env): Response =>
  json({
    ok: true,
    model: modelFor(env),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    usda: Boolean(env.USDA_API_KEY),
  });
