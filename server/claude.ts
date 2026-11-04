import Anthropic from '@anthropic-ai/sdk';
import { HttpError, type Env } from './http';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const EFFORTS = ['low', 'medium', 'high'] as const;
type Effort = (typeof EFFORTS)[number];

export function modelFor(env: Env): string {
  return env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL;
}

function effortFor(env: Env): Effort {
  const e = env.CLAUDE_EFFORT?.trim() as Effort | undefined;
  return e && EFFORTS.includes(e) ? e : 'low';
}

// Server-side refusal fallback ("default" form) is offered on these model families.
// If Claude's safety filter declines a request, the API retries on a suitable model
// instead of failing. Haiku has no server-side fallback.
function supportsDefaultFallback(model: string): boolean {
  return /^claude-(opus-5|fable-5|sonnet-5-5|mythos-5)/.test(model);
}

/**
 * One Claude call that must return JSON matching `schema` (structured outputs).
 */
export async function claudeJSON<T>(
  env: Env,
  opts: {
    system: string;
    content: Anthropic.Beta.BetaContentBlockParam[];
    schema: Record<string, unknown>;
  },
): Promise<T> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, 'Server not set up: add the ANTHROPIC_API_KEY secret in Cloudflare.');
  }
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
    maxRetries: 1,
    timeout: 60_000,
  });
  const model = modelFor(env);
  const fallback = supportsDefaultFallback(model);

  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: opts.system,
      messages: [{ role: 'user', content: opts.content }],
      output_config: { effort: effortFor(env), format: { type: 'json_schema', schema: opts.schema } },
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new HttpError(502, 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.');
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      throw new HttpError(502, 'The Anthropic API key lacks access to this model.');
    }
    if (err instanceof Anthropic.NotFoundError) {
      throw new HttpError(502, `Model "${model}" not found. Check CLAUDE_MODEL.`);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, 'AI rate limit or spend limit reached. Try again shortly.');
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new HttpError(502, `AI request rejected: ${err.message}`);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new HttpError(504, 'Could not reach the AI service. Try again.');
    }
    if (err instanceof Anthropic.APIError) {
      throw new HttpError(502, `AI service error (${err.status ?? 'unknown'}). Try again.`);
    }
    throw err;
  }

  if (res.stop_reason === 'refusal') {
    throw new HttpError(422, 'The AI declined this one. Try another photo or type what you ate.');
  }
  if (res.stop_reason === 'max_tokens') {
    throw new HttpError(502, 'The AI response was cut off. Try again.');
  }
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, 'The AI returned an unreadable answer. Try again.');
  }
}
