import { describe, expect, it } from 'vitest';
import { normalizeName } from './normalize';

describe('normalizeName', () => {
  it('lowercases', () => {
    expect(normalizeName('Mouka')).toBe('mouka');
  });

  it('trims and strips diacritics', () => {
    expect(normalizeName('Kuřecí ')).toBe('kureci');
  });

  it('strips diacritics from a multi-mark word', () => {
    expect(normalizeName('žampióny')).toBe('zampiony');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeName('')).toBe('');
  });

  it('treats decomposed (NFD) input the same as precomposed input', () => {
    // "Kuřecí" typed as NFD: base letters followed by combining marks
    const decomposed = 'Kuřecí'.normalize('NFD');
    expect(normalizeName(decomposed)).toBe(normalizeName('Kuřecí'));
    expect(normalizeName(decomposed)).toBe('kureci');
  });
});
