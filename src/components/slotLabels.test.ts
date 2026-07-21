import { describe, expect, it } from 'vitest';
import { SLOT_LABELS, SLOT_ACCUSATIVE } from './slotLabels';

describe('SLOT_LABELS', () => {
  it('maps each slot to its Czech label', () => {
    expect(SLOT_LABELS).toEqual({
      breakfast: 'snídaně',
      lunch: 'oběd',
      dinner: 'večeře',
      snack: 'svačiny',
    });
  });
});

describe('SLOT_ACCUSATIVE', () => {
  it('maps each slot to its Czech accusative form for warning copy', () => {
    expect(SLOT_ACCUSATIVE).toEqual({
      breakfast: 'pro snídani',
      lunch: 'pro oběd',
      dinner: 'pro večeři',
      snack: 'pro svačinu',
    });
  });
});
