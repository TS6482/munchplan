import { describe, expect, it } from 'vitest';
import type { Plans, WeekPlan } from '../types';
import { dinnerWeek } from '../testing/fixtures';
import { isInRotationWindow, lastCookedWeek, weeksSinceCooked } from './rotation';

function planWith(recipeId: string): WeekPlan {
  return dinnerWeek({ mon: recipeId });
}

describe('lastCookedWeek', () => {
  it('returns null when the recipe was never cooked', () => {
    const plans: Plans = {};
    expect(lastCookedWeek('r1', plans, '2026-W30')).toBeNull();
  });

  it('finds the week strictly before the target where the recipe was cooked', () => {
    const plans: Plans = { '2026-W28': planWith('r1') };
    expect(lastCookedWeek('r1', plans, '2026-W30')).toBe('2026-W28');
  });

  it('does not count the target week itself', () => {
    const plans: Plans = { '2026-W30': planWith('r1') };
    expect(lastCookedWeek('r1', plans, '2026-W30')).toBeNull();
  });

  it('does not count a future week', () => {
    const plans: Plans = { '2026-W31': planWith('r1') };
    expect(lastCookedWeek('r1', plans, '2026-W30')).toBeNull();
  });

  it('picks the most recent qualifying week among several', () => {
    const plans: Plans = {
      '2026-W25': planWith('r1'),
      '2026-W28': planWith('r1'),
      '2026-W26': planWith('r1'),
    };
    expect(lastCookedWeek('r1', plans, '2026-W30')).toBe('2026-W28');
  });

  it('compares weeks chronologically (not lexicographically) across a year boundary', () => {
    const plans: Plans = {
      '2025-W51': planWith('r1'),
      '2025-W52': planWith('r1'),
    };
    expect(lastCookedWeek('r1', plans, '2026-W01')).toBe('2025-W52');
  });
});

describe('weeksSinceCooked', () => {
  it('is Infinity when never cooked before the target week', () => {
    const plans: Plans = {};
    expect(weeksSinceCooked('r1', plans, '2026-W30')).toBe(Infinity);
  });

  it('computes the week difference via mondayOf', () => {
    const plans: Plans = { '2026-W28': planWith('r1') };
    expect(weeksSinceCooked('r1', plans, '2026-W30')).toBe(2);
  });

  it('looks back across a year boundary', () => {
    const plans: Plans = { '2025-W51': planWith('r1') };
    expect(weeksSinceCooked('r1', plans, '2026-W01')).toBe(2);
  });
});

describe('isInRotationWindow', () => {
  it('is true (hidden) when cooked exactly N weeks ago', () => {
    const plans: Plans = { '2026-W28': planWith('r1') };
    expect(isInRotationWindow('r1', plans, '2026-W30', 2)).toBe(true);
  });

  it('is false (visible) when cooked N+1 weeks ago', () => {
    const plans: Plans = { '2026-W27': planWith('r1') };
    expect(isInRotationWindow('r1', plans, '2026-W30', 2)).toBe(false);
  });

  it('is false (visible) when never cooked', () => {
    const plans: Plans = {};
    expect(isInRotationWindow('r1', plans, '2026-W30', 2)).toBe(false);
  });

  it('is always false when rotationWeeks is 0', () => {
    const plans: Plans = { '2026-W29': planWith('r1') };
    expect(isInRotationWindow('r1', plans, '2026-W30', 0)).toBe(false);
  });

  it('does not count the target week own assignment', () => {
    const plans: Plans = { '2026-W30': planWith('r1') };
    expect(isInRotationWindow('r1', plans, '2026-W30', 2)).toBe(false);
  });

  it('does not count an assignment in a future week only', () => {
    const plans: Plans = { '2026-W31': planWith('r1') };
    expect(isInRotationWindow('r1', plans, '2026-W30', 2)).toBe(false);
  });

  it('hides across a year boundary lookback within the window', () => {
    const plans: Plans = { '2025-W51': planWith('r1') };
    expect(isInRotationWindow('r1', plans, '2026-W01', 2)).toBe(true);
  });

  it('shows across a year boundary lookback outside the window', () => {
    const plans: Plans = { '2025-W51': planWith('r1') };
    expect(isInRotationWindow('r1', plans, '2026-W01', 1)).toBe(false);
  });

  it('picks the most recent qualifying week among multiple', () => {
    const plans: Plans = {
      '2026-W25': planWith('r1'),
      '2026-W29': planWith('r1'),
    };
    expect(isInRotationWindow('r1', plans, '2026-W30', 2)).toBe(true);
  });
});
