import { describe, expect, it } from 'vitest';
import { blockedMatch, exactMatch, itemKey, saleMatch } from './match';

describe('exactMatch', () => {
  it('matches case- and diacritics-insensitively', () => {
    expect(exactMatch('Sůl', 'sul')).toBe(true);
  });

  it('does not match unrelated names', () => {
    expect(exactMatch('mouka', 'cukr')).toBe(false);
  });

  it('guards empty vs empty', () => {
    expect(exactMatch('', '')).toBe(false);
  });
});

describe('saleMatch', () => {
  it('matches when the sale name is a substring of the ingredient name', () => {
    expect(saleMatch('kuřecí', 'kuřecí stehna')).toBe(true);
  });

  it('matches when the ingredient name is a substring of the sale name', () => {
    expect(saleMatch('kuřecí stehna', 'kuřecí')).toBe(true);
  });

  it('does not match when neither is a substring of the other', () => {
    // "cukr" is NOT a substring of "cuketa": c-u-k-r vs c-u-k-e-t-a
    expect(saleMatch('cukr', 'cuketa')).toBe(false);
  });

  it('guards empty sale name', () => {
    expect(saleMatch('', 'mouka')).toBe(false);
  });

  it('guards empty ingredient name', () => {
    expect(saleMatch('mouka', '')).toBe(false);
  });
});

describe('blockedMatch', () => {
  it('matches identical terms', () => {
    expect(blockedMatch('houby', 'houby')).toBe(true);
  });

  it('matches when the blocked term is a prefix-substring of the ingredient', () => {
    expect(blockedMatch('houby', 'sušené houby')).toBe(true);
  });

  it('matches when the blocked term is a substring anywhere in the ingredient', () => {
    expect(blockedMatch('houby', 'houby shiitake')).toBe(true);
  });

  it('is one-direction only: a longer blocked term does not block a shorter ingredient', () => {
    expect(blockedMatch('sušené houby', 'houby')).toBe(false);
  });

  it('guards empty blocked term', () => {
    expect(blockedMatch('', 'x')).toBe(false);
  });
});

describe('itemKey', () => {
  it('combines normalized name and unit with a separator', () => {
    expect(itemKey('Mouka hladká', 'g')).toBe('mouka hladka|g');
  });

  it('uses an empty unit segment when no unit is given', () => {
    expect(itemKey('Sůl')).toBe('sul|');
  });

  it('is stable: same inputs produce the same key', () => {
    expect(itemKey('Mouka hladká', 'g')).toBe(itemKey('Mouka hladká', 'g'));
  });
});
