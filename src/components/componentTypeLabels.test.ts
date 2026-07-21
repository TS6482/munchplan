import { describe, expect, it } from 'vitest';
import { COMPONENT_TYPE_LABELS } from './componentTypeLabels';

describe('COMPONENT_TYPE_LABELS', () => {
  it('maps each component type to its Czech label', () => {
    expect(COMPONENT_TYPE_LABELS).toEqual({
      full: 'samostatné jídlo',
      main: 'hlavní jídlo',
      side: 'příloha',
      salad: 'salát',
    });
  });
});
