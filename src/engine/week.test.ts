import { describe, expect, it } from 'vitest';
import { ISO_DAYS, addWeeks, currentWeek, dateOfDay, daysOf, mondayOf, nextWeek, weekKeyOf } from './week';

describe('weekKeyOf', () => {
  it('resolves a mid-year date (Wed inside a Mon-started week)', () => {
    expect(weekKeyOf(new Date('2026-07-15'))).toBe('2026-W29');
  });

  it('assigns a late-December date to next ISO year W01 (year-boundary lookahead)', () => {
    expect(weekKeyOf(new Date('2025-12-29'))).toBe('2026-W01');
  });

  it('assigns a Sunday to the week started the preceding Monday', () => {
    // 2026-01-04 is a Sunday, belonging to the week that began 2025-12-29.
    expect(weekKeyOf(new Date('2026-01-04'))).toBe('2026-W01');
  });

  it('resolves a January date into the previous ISO year W53 (53-week year)', () => {
    expect(weekKeyOf(new Date('2027-01-01'))).toBe('2026-W53');
  });

  it('resolves a date inside the CET->CEST transition week regardless of local timezone', () => {
    // 2026-03-29 is the EU spring-forward date; internal math must use
    // UTC-noon so the local machine's timezone can't shift the calendar day.
    expect(weekKeyOf(new Date('2026-03-29'))).toBe('2026-W13');
  });
});

describe('mondayOf', () => {
  it('returns the UTC Monday for a week key', () => {
    const monday = mondayOf('2026-W01');
    expect(monday.getUTCFullYear()).toBe(2025);
    expect(monday.getUTCMonth()).toBe(11); // December
    expect(monday.getUTCDate()).toBe(29);
  });

  it('round-trips with weekKeyOf for an ordinary week', () => {
    expect(weekKeyOf(mondayOf('2026-W29'))).toBe('2026-W29');
  });

  it('round-trips with weekKeyOf across a year boundary', () => {
    expect(weekKeyOf(mondayOf('2026-W01'))).toBe('2026-W01');
  });

  it('round-trips with weekKeyOf for a 53-week year', () => {
    expect(weekKeyOf(mondayOf('2026-W53'))).toBe('2026-W53');
  });

  it('throws on a malformed week key (missing zero-padding)', () => {
    expect(() => mondayOf('2026-W1')).toThrow();
  });

  it('throws on a malformed week key (not the YYYY-Www shape at all)', () => {
    expect(() => mondayOf('not-a-week')).toThrow();
  });
});

describe('addWeeks', () => {
  it('looks back across a year boundary via date arithmetic, not string decrement', () => {
    expect(addWeeks('2026-W01', -2)).toBe('2025-W51');
  });

  it('advances from a 53-week year into next year W01', () => {
    expect(addWeeks('2026-W53', 1)).toBe('2027-W01');
  });

  it('advances by +1 across a mid-year boundary', () => {
    expect(addWeeks('2026-W29', 1)).toBe('2026-W30');
  });

  it('looks back by -1 across a mid-year boundary', () => {
    expect(addWeeks('2026-W30', -1)).toBe('2026-W29');
  });
});

describe('currentWeek / nextWeek', () => {
  it('derives current week from an injected now', () => {
    // 2026-07-19 is a Sunday, the last day of 2026-W29.
    expect(currentWeek(new Date('2026-07-19'))).toBe('2026-W29');
  });

  it('derives next week from an injected now', () => {
    expect(nextWeek(new Date('2026-07-19'))).toBe('2026-W30');
  });
});

describe('daysOf', () => {
  it('returns 7 ISO dates Mon through Sun', () => {
    expect(daysOf('2026-W29')).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
    ]);
  });
});

describe('ISO_DAYS', () => {
  it('is the Mon->Sun day-key order', () => {
    expect(ISO_DAYS).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });
});

describe('dateOfDay', () => {
  it('returns the ISO date for a given day within a week', () => {
    expect(dateOfDay('2026-W29', 'wed')).toBe('2026-07-15');
    expect(dateOfDay('2026-W29', 'sun')).toBe('2026-07-19');
  });
});
