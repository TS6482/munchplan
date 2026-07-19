import { describe, expect, it } from 'vitest';
import {
  blockedListAdd,
  blockedListRemove,
  parseRepoInput,
  parseRotationWeeks,
  validateConfig,
  validateDietRule,
} from './settingsLogic';

describe('validateConfig', () => {
  it('accepts all fields filled', () => {
    expect(validateConfig({ owner: 'TS6482', repo: 'munchplan-data', token: 'ghp_abc' })).toEqual({ ok: true });
  });

  it('rejects empty owner', () => {
    const result = validateConfig({ owner: '', repo: 'munchplan-data', token: 'ghp_abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.owner).toBeTruthy();
  });

  it('rejects empty repo', () => {
    const result = validateConfig({ owner: 'TS6482', repo: '', token: 'ghp_abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.repo).toBeTruthy();
  });

  it('rejects empty token', () => {
    const result = validateConfig({ owner: 'TS6482', repo: 'munchplan-data', token: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.token).toBeTruthy();
  });

  it('rejects whitespace-only fields', () => {
    const result = validateConfig({ owner: '   ', repo: 'munchplan-data', token: 'ghp_abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.owner).toBeTruthy();
  });

  it('reports all missing fields at once', () => {
    const result = validateConfig({ owner: '', repo: '', token: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.owner).toBeTruthy();
      expect(result.errors.repo).toBeTruthy();
      expect(result.errors.token).toBeTruthy();
    }
  });
});

describe('parseRepoInput', () => {
  it('splits a combined "owner/repo" string', () => {
    expect(parseRepoInput('TS6482/munchplan-data')).toEqual({ owner: 'TS6482', repo: 'munchplan-data' });
  });

  it('treats a plain name as repo only', () => {
    expect(parseRepoInput('munchplan-data')).toEqual({ repo: 'munchplan-data' });
  });

  it('trims whitespace around parts', () => {
    expect(parseRepoInput('  TS6482 / munchplan-data  ')).toEqual({ owner: 'TS6482', repo: 'munchplan-data' });
  });
});

describe('validateDietRule', () => {
  it('accepts only-min', () => {
    expect(validateDietRule('ryba', '1', '')).toEqual({ ok: true, min: 1 });
  });

  it('accepts only-max', () => {
    expect(validateDietRule('maso', '', '2')).toEqual({ ok: true, max: 2 });
  });

  it('accepts both min and max when min <= max', () => {
    expect(validateDietRule('maso', '1', '2')).toEqual({ ok: true, min: 1, max: 2 });
  });

  it('rejects min > max', () => {
    const result = validateDietRule('maso', '3', '2');
    expect(result.ok).toBe(false);
  });

  it('rejects negative numbers', () => {
    const result = validateDietRule('maso', '-1', '2');
    expect(result.ok).toBe(false);
  });

  it('rejects non-integer values', () => {
    const result = validateDietRule('maso', '1.5', '2');
    expect(result.ok).toBe(false);
  });

  it('rejects when neither min nor max is set', () => {
    const result = validateDietRule('maso', '', '');
    expect(result.ok).toBe(false);
  });

  it('rejects empty category', () => {
    const result = validateDietRule('', '1', '2');
    expect(result.ok).toBe(false);
  });
});

describe('parseRotationWeeks', () => {
  it('parses a valid integer', () => {
    expect(parseRotationWeeks('2')).toEqual({ ok: true, weeks: 2 });
  });

  it('parses zero', () => {
    expect(parseRotationWeeks('0')).toEqual({ ok: true, weeks: 0 });
  });

  it('rejects negative numbers', () => {
    expect(parseRotationWeeks('-1').ok).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(parseRotationWeeks('abc').ok).toBe(false);
  });

  it('rejects decimal input', () => {
    expect(parseRotationWeeks('2.5').ok).toBe(false);
  });
});

describe('blockedListAdd', () => {
  it('adds a new item', () => {
    expect(blockedListAdd([], 'Houby')).toEqual(['Houby']);
  });

  it('dedupes by normalized name, keeping the existing display spelling', () => {
    expect(blockedListAdd(['Houby'], 'houby')).toEqual(['Houby']);
  });

  it('dedupes ignoring diacritics/case in the other direction too', () => {
    expect(blockedListAdd(['houby'], 'Houby')).toEqual(['houby']);
  });

  it('ignores empty/whitespace input', () => {
    expect(blockedListAdd(['Houby'], '  ')).toEqual(['Houby']);
  });
});

describe('blockedListRemove', () => {
  it('removes by normalized name', () => {
    expect(blockedListRemove(['Houby', 'Cibule'], 'houby')).toEqual(['Cibule']);
  });

  it('is a no-op when name is not present', () => {
    expect(blockedListRemove(['Houby'], 'cibule')).toEqual(['Houby']);
  });
});
