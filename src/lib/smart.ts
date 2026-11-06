// "Say it" with memory: answer from what's already known before paying for AI.
//   1. Exact phrase said before -> reuse that answer.
//   2. Every part matches a food you've logged -> build it locally.
//   3. Some parts match -> AI only for the rest.
//   4. Otherwise -> AI.

import type { AnalyzeMode } from '../../shared/types';
import { analyzeText } from './api';
import { allRecipes, savedFoods } from './db';
import { buildCandidates, matchText } from './matcher';
import { countSavedCall, recallText, type RememberedAnalysis } from './memory';

export type AnswerSource = 'memory' | 'matched' | 'mixed' | 'ai';

export interface SmartAnswer extends RememberedAnalysis {
  source: AnswerSource;
}

export async function analyzeTextSmart(text: string, mode: AnalyzeMode, force = false): Promise<SmartAnswer> {
  if (!force) {
    const remembered = await recallText(mode, text);
    if (remembered) {
      countSavedCall();
      return { ...remembered, note: 'Same as last time you said this. No AI used.', source: 'memory' };
    }

    let match = null;
    try {
      const [foods, recipes] = await Promise.all([savedFoods(), allRecipes()]);
      match = matchText(text, buildCandidates(foods, recipes, mode === 'recipe'));
    } catch {
      /* fall through to AI */
    }

    if (match && match.matched.length) {
      const known = match.matched.map((m) => ({ food: m.food, qty: m.qty }));
      if (!match.unmatched.length) {
        countSavedCall();
        return { items: known, note: 'Matched to foods you’ve logged before. No AI used.', source: 'matched' };
      }
      const res = await analyzeText(match.unmatched.join(', '), mode);
      const n = known.length;
      return {
        items: [...known, ...res.items.map((food) => ({ food, qty: 1 }))],
        note: [`${n} item${n === 1 ? '' : 's'} matched to your foods; AI handled the rest.`, res.note].filter(Boolean).join(' '),
        recipeName: res.recipeName,
        servings: res.servings,
        source: 'mixed',
      };
    }
  }

  const res = await analyzeText(text, mode);
  return {
    items: res.items.map((food) => ({ food, qty: 1 })),
    note: res.note,
    recipeName: res.recipeName,
    servings: res.servings,
    source: 'ai',
  };
}
