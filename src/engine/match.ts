import { normalizeName } from './normalize';

/** Exact match on normalized names. Empty strings never match. */
export function exactMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === '' || nb === '') return false;
  return na === nb;
}

/**
 * Substring match in either direction on normalized names, e.g. sale
 * "kuřecí" matches ingredient "kuřecí stehna" and vice versa.
 * Empty strings never match.
 */
export function saleMatch(saleName: string, ingredientName: string): boolean {
  const sale = normalizeName(saleName);
  const ingredient = normalizeName(ingredientName);
  if (sale === '' || ingredient === '') return false;
  return ingredient.includes(sale) || sale.includes(ingredient);
}

/**
 * One-direction substring match: a blocked term excludes any ingredient
 * whose normalized name contains it ("houby" also blocks "sušené houby"),
 * but the reverse does not hold. Empty strings never match.
 */
export function blockedMatch(blockedTerm: string, ingredientName: string): boolean {
  const blocked = normalizeName(blockedTerm);
  const ingredient = normalizeName(ingredientName);
  if (blocked === '' || ingredient === '') return false;
  return ingredient.includes(blocked);
}

/**
 * Stable identity key for a shopping-list line: normalized name + normalized
 * unit. Never includes amount. Used by steps 7/14 to persist per-week check
 * states across plan rebuilds.
 */
export function itemKey(name: string, unit?: string): string {
  return `${normalizeName(name)}|${normalizeName(unit ?? '')}`;
}
