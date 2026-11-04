// Fast, offline parsing of simple amounts. Anything this can't handle goes to the AI.

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  half: 0.5, quarter: 0.25, third: 1 / 3, double: 2, triple: 3,
};

const UNICODE_FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

function parseNumber(s: string): number | null {
  s = s.trim();
  for (const [ch, v] of Object.entries(UNICODE_FRACTIONS)) {
    if (s === ch) return v;
    if (s.endsWith(ch)) {
      const whole = parseNumber(s.slice(0, -1));
      return whole === null ? null : whole + v;
    }
  }
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/); // 1 1/2
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\/(\d+)$/); // 1/2
  if (m) return Number(m[1]) / Number(m[2]);
  m = s.match(/^\d*\.?\d+$/);
  if (m) return Number(s);
  if (s in WORDS) return WORDS[s];
  m = s.match(/^(one|two|three|four|five|a|an)\s+and\s+a\s+half$/);
  if (m) return WORDS[m[1]] + 0.5;
  return null;
}

/**
 * Returns a multiplier of the reference unit, or null if the text needs the AI.
 * Handles: "2", "1.5", "1/2", "½", "half", "2x", "x2", "2 servings", "150 g", "5 oz".
 */
export function parseAmountLocal(text: string, unitGrams: number | null): number | null {
  const s = text.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ');
  if (!s) return null;

  let m = s.match(/^(.+?)\s*(g|gr|gram|grams)$/);
  if (m && unitGrams) {
    const g = parseNumber(m[1]);
    return g && g > 0 ? g / unitGrams : null;
  }
  m = s.match(/^(.+?)\s*(oz|ounce|ounces)$/);
  if (m && unitGrams) {
    const oz = parseNumber(m[1]);
    return oz && oz > 0 ? (oz * 28.35) / unitGrams : null;
  }

  const stripped = s
    .replace(/^x\s*/, '')
    .replace(/\s*(x|times|servings?|portions?|of (it|them|those|that))$/, '')
    .replace(/^(a|an) (half|third|quarter)$/, '$2')
    .trim();
  const v = parseNumber(stripped);
  return v && v > 0 && v <= 100 ? v : null;
}
