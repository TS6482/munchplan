/**
 * Normalizes an ingredient/item name for comparison: NFD-decompose, strip
 * combining marks (diacritics), lowercase, trim.
 */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}
