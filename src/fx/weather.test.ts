import { describe, expect, it } from 'vitest';
import { SunClock, sunPosition, timeOfDay } from './weather';

const H = 3_600_000;
const clock: SunClock = { utcOffset: 0, sunrise: 8 * H, sunset: 16 * H, isDay: true };

describe('day and night', () => {
  it('reads local time from the UTC offset', () => {
    const now = Date.UTC(2026, 0, 1, 10, 30);
    expect(timeOfDay({ ...clock, utcOffset: 7200 }, now)).toBe(12.5 * H);
    expect(timeOfDay({ ...clock, utcOffset: -36000 }, now)).toBe(0.5 * H);
  });

  it('puts the sun on the horizon at sunrise and sunset', () => {
    expect(sunPosition(clock, 'auto', 8 * H).el).toBeCloseTo(0);
    expect(sunPosition(clock, 'auto', 8 * H).p).toBeCloseTo(0);
    expect(sunPosition(clock, 'auto', 16 * H).el).toBeCloseTo(0);
    expect(sunPosition(clock, 'auto', 16 * H).p).toBeCloseTo(1);
  });

  it('peaks at midday, lower on short days', () => {
    expect(sunPosition(clock, 'auto', 12 * H).el).toBeCloseTo(0.5);
    const winter: SunClock = { ...clock, sunrise: 9.5 * H, sunset: 14.5 * H };
    expect(sunPosition(winter, 'auto', 12 * H).el).toBeCloseTo(0.3125);
    const summer: SunClock = { ...clock, sunrise: 3 * H, sunset: 23 * H };
    expect(sunPosition(summer, 'auto', 13 * H).el).toBeCloseTo(0.9);
  });

  it('is deepest night halfway between sunset and sunrise', () => {
    expect(sunPosition(clock, 'auto', 0).el).toBeCloseTo(-0.8);
    expect(sunPosition(clock, 'auto', 20 * H).el).toBeLessThan(0);
  });

  it('handles midnight sun and polar night', () => {
    expect(sunPosition({ ...clock, sunrise: null, sunset: null, isDay: true }, 'auto', 0).el).toBeGreaterThan(0);
    expect(sunPosition({ ...clock, sunrise: null, sunset: null, isDay: false }, 'auto', 12 * H).el).toBeLessThan(0);
  });

  it('honours a pinned time of day', () => {
    expect(sunPosition(clock, 'night', 12 * H).el).toBeLessThan(0);
    expect(sunPosition(clock, 'day', 0).el).toBeGreaterThan(0.5);
    expect(Math.abs(sunPosition(clock, 'dusk', 0).el)).toBeLessThan(0.1);
  });

  it('falls back to daytime before any clock is known', () => {
    expect(sunPosition(null, 'auto', null).el).toBeGreaterThan(0.5);
  });
});
