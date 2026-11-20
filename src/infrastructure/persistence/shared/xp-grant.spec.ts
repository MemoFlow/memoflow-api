import { computeXpGrant, utcDateString } from './xp-grant';
import { DAILY_XP_CAP } from './xp-level.constants';

describe('computeXpGrant', () => {
  const today = '2026-11-20';

  it('grants the full delta while under the cap', () => {
    expect(
      computeXpGrant({ delta: 50, xpToday: 0, xpTodayDate: today, today }),
    ).toEqual({ granted: 50, xpToday: 50 });
  });

  it('grants only the remaining room when the delta crosses the cap', () => {
    expect(
      computeXpGrant({ delta: 100, xpToday: 250, xpTodayDate: today, today }),
    ).toEqual({ granted: 50, xpToday: DAILY_XP_CAP });
  });

  it('grants nothing once the cap is reached', () => {
    expect(
      computeXpGrant({ delta: 25, xpToday: 300, xpTodayDate: today, today }),
    ).toEqual({ granted: 0, xpToday: 300 });
  });

  it('never grants a negative amount if xpToday somehow exceeds the cap', () => {
    expect(
      computeXpGrant({ delta: 25, xpToday: 999, xpTodayDate: today, today })
        .granted,
    ).toBe(0);
  });

  it('resets the daily counter when the stored date is not today', () => {
    expect(
      computeXpGrant({
        delta: 100,
        xpToday: 300,
        xpTodayDate: '2026-11-19',
        today,
      }),
    ).toEqual({ granted: 100, xpToday: 100 });
    expect(
      computeXpGrant({ delta: 100, xpToday: 300, xpTodayDate: null, today }),
    ).toEqual({ granted: 100, xpToday: 100 });
  });

  it('has a daily cap of 300', () => {
    expect(DAILY_XP_CAP).toBe(300);
  });
});

describe('utcDateString', () => {
  it('formats in UTC regardless of the local zone', () => {
    expect(utcDateString(new Date('2026-11-20T23:59:59.000Z'))).toBe(
      '2026-11-20',
    );
    expect(utcDateString(new Date('2026-11-21T00:00:00.000Z'))).toBe(
      '2026-11-21',
    );
  });
});
