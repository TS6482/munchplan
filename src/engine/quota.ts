import type { DietRule } from '../types';
import { normalizeName } from './normalize';

/** Per-rule evaluation of a set of planned recipe categories against a diet rule. */
export interface QuotaStatus {
  category: string;
  count: number;
  min?: number;
  max?: number;
  metMin: boolean;
  atMax: boolean;
}

function countCategory(category: string, plannedCategories: string[]): number {
  const target = normalizeName(category);
  return plannedCategories.filter((c) => normalizeName(c) === target).length;
}

/** Evaluates every rule against the currently planned categories. */
export function evaluateQuotas(plannedCategories: string[], rules: DietRule[]): QuotaStatus[] {
  return rules.map((rule) => {
    const count = countCategory(rule.category, plannedCategories);
    return {
      category: rule.category,
      count,
      min: rule.min,
      max: rule.max,
      metMin: rule.min == null || count >= rule.min,
      atMax: rule.max != null && count >= rule.max,
    };
  });
}

/**
 * True if `category` is already at (or over) its max rule, i.e. adding one
 * more recipe of that category would exceed the quota. Categories with no
 * matching rule, or a rule with no max, are unconstrained (always false).
 */
export function wouldExceedMax(category: string, plannedCategories: string[], rules: DietRule[]): boolean {
  const target = normalizeName(category);
  const rule = rules.find((r) => normalizeName(r.category) === target);
  if (!rule || rule.max == null) return false;
  return countCategory(category, plannedCategories) >= rule.max;
}

/** Categories with a min rule that the current plan hasn't reached yet. */
export function unmetMinCategories(plannedCategories: string[], rules: DietRule[]): string[] {
  return rules
    .filter((rule) => rule.min != null && countCategory(rule.category, plannedCategories) < rule.min)
    .map((rule) => rule.category);
}
