import { describe, expect, it } from 'vitest';
import type { MealEntry, WeekPlan } from '../types';
import { emptyDayPlan, emptyWeekPlan, entriesOfDay, slotIsEmpty, weekPrimaryRecipeIds, weekRecipeIds } from './planModel';

function entry(overrides: Partial<MealEntry> & { id: string; recipeIds: string[] }): MealEntry {
  return { source: 'manual', ...overrides };
}

describe('emptyDayPlan', () => {
  it('returns all four slots empty', () => {
    expect(emptyDayPlan()).toEqual({ breakfast: [], lunch: [], dinner: [], snack: [] });
  });
});

describe('emptyWeekPlan', () => {
  it('returns all 7 days empty', () => {
    const week = emptyWeekPlan();
    expect(Object.keys(week.days)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    for (const day of Object.values(week.days)) {
      expect(day).toEqual(emptyDayPlan());
    }
  });
});

describe('entriesOfDay', () => {
  it('returns every entry across all four slots in SLOT_ORDER', () => {
    const day = {
      breakfast: [entry({ id: 'b1', recipeIds: ['r1'] })],
      lunch: [],
      dinner: [entry({ id: 'd1', recipeIds: ['r2'] }), entry({ id: 'd2', recipeIds: ['r3'] })],
      snack: [entry({ id: 's1', recipeIds: ['r4'] })],
    };
    expect(entriesOfDay(day).map((e) => e.id)).toEqual(['b1', 'd1', 'd2', 's1']);
  });

  it('returns [] for an empty day', () => {
    expect(entriesOfDay(emptyDayPlan())).toEqual([]);
  });
});

describe('weekRecipeIds', () => {
  it('collects every recipeId of every entry of every slot, duplicates preserved', () => {
    const week: WeekPlan = emptyWeekPlan();
    week.days.mon.dinner = [entry({ id: 'e1', recipeIds: ['r1'] })];
    week.days.mon.lunch = [entry({ id: 'e2', recipeIds: ['r1'] })]; // same recipe, different slot
    week.days.wed.dinner = [entry({ id: 'e3', recipeIds: ['r2', 'r2'] })]; // multi-recipe entry, duplicate id inside
    expect(weekRecipeIds(week).sort()).toEqual(['r1', 'r1', 'r2', 'r2']);
  });

  it('returns [] for a week with no entries', () => {
    expect(weekRecipeIds(emptyWeekPlan())).toEqual([]);
  });
});

describe('weekPrimaryRecipeIds (feature 004 step 3)', () => {
  it('collects only the FIRST recipeId of every entry, duplicates preserved', () => {
    const week: WeekPlan = emptyWeekPlan();
    week.days.mon.dinner = [entry({ id: 'e1', recipeIds: ['main1', 'side1'] })];
    week.days.mon.lunch = [entry({ id: 'e2', recipeIds: ['main1'] })]; // same primary, different slot
    week.days.wed.dinner = [entry({ id: 'e3', recipeIds: ['main2', 'side2', 'salad2'] })];
    expect(weekPrimaryRecipeIds(week).sort()).toEqual(['main1', 'main1', 'main2']);
  });

  it('skips an entry with an empty recipeIds array defensively', () => {
    const week: WeekPlan = emptyWeekPlan();
    week.days.mon.dinner = [entry({ id: 'e1', recipeIds: [] })];
    expect(weekPrimaryRecipeIds(week)).toEqual([]);
  });

  it('returns [] for a week with no entries', () => {
    expect(weekPrimaryRecipeIds(emptyWeekPlan())).toEqual([]);
  });
});

describe('slotIsEmpty', () => {
  it('is true when the week is undefined', () => {
    expect(slotIsEmpty(undefined, 'mon', 'dinner')).toBe(true);
  });

  it('is true for an empty slot', () => {
    expect(slotIsEmpty(emptyWeekPlan(), 'mon', 'dinner')).toBe(true);
  });

  it('is false once the slot holds an entry', () => {
    const week = emptyWeekPlan();
    week.days.mon.dinner = [entry({ id: 'e1', recipeIds: ['r1'] })];
    expect(slotIsEmpty(week, 'mon', 'dinner')).toBe(false);
  });
});
