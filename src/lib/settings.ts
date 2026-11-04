import type { NutrientKey } from '../../shared/types';

export type TargetKind = 'limit' | 'goal' | 'budget';

export interface TargetDef {
  key: NutrientKey;
  kind: TargetKind;
  hint: string;
}

/** Nutrients that have a daily target, in display order. */
export const TARGET_DEFS: TargetDef[] = [
  { key: 'calories', kind: 'budget', hint: 'Daily calorie budget.' },
  { key: 'satFat', kind: 'limit', hint: 'AHA: under 6% of calories, about 13 g at 2,000 kcal.' },
  { key: 'cholesterol', kind: 'limit', hint: 'TLC diet for high LDL: under 200 mg.' },
  { key: 'fiber', kind: 'goal', hint: 'Total fiber goal. 25–35 g is typical.' },
  { key: 'solubleFiber', kind: 'goal', hint: 'TLC diet: 10–25 g soluble fiber (oats, beans, psyllium). Mostly estimated.' },
  { key: 'sodium', kind: 'limit', hint: 'Under 2,300 mg; AHA ideal is 1,500 mg.' },
];

export type Targets = Partial<Record<NutrientKey, number>>;

export const DEFAULT_TARGETS: Targets = {
  calories: 2000,
  satFat: 13,
  cholesterol: 200,
  fiber: 30,
  solubleFiber: 10,
  sodium: 2300,
};

export interface Settings {
  targets: Targets;
  passcode: string;
}

const KEY = 'food-log-settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return { targets: { ...DEFAULT_TARGETS, ...(s.targets ?? {}) }, passcode: s.passcode ?? '' };
    }
  } catch {
    /* storage unavailable */
  }
  return { targets: { ...DEFAULT_TARGETS }, passcode: '' };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function targetKind(key: NutrientKey): TargetKind | undefined {
  return TARGET_DEFS.find((d) => d.key === key)?.kind;
}
