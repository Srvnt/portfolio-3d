import { describe, expect, it } from 'vitest';
import { fromOpenMeteo } from './weather-ui';

const base = { temperature_2m: 10, weather_code: 0, cloud_cover: 0, wind_speed_10m: 0, visibility: 30000 };

describe('Open-Meteo to weather sliders', () => {
  it('turns a clear calm day into full sun', () => {
    expect(fromOpenMeteo(base)).toEqual({ sun: 1, wind: 0, rain: 0, snow: 0, fog: 0 });
  });

  it('dims the sun with cloud cover, never below a minimum', () => {
    expect(fromOpenMeteo({ ...base, weather_code: 2, cloud_cover: 50 }).sun).toBeCloseTo(0.5);
    expect(fromOpenMeteo({ ...base, weather_code: 3, cloud_cover: 100 }).sun).toBeCloseTo(0.12);
  });

  it('maps rain codes to rain strength and keeps the sky dull', () => {
    expect(fromOpenMeteo({ ...base, weather_code: 61 }).rain).toBeCloseTo(0.45);
    expect(fromOpenMeteo({ ...base, weather_code: 63 }).rain).toBeCloseTo(0.75);
    const heavy = fromOpenMeteo({ ...base, weather_code: 65 });
    expect(heavy.rain).toBe(1);
    expect(heavy.sun).toBeLessThanOrEqual(0.25);
    expect(fromOpenMeteo({ ...base, weather_code: 95 }).rain).toBe(1);
  });

  it('maps snow codes to snowfall', () => {
    expect(fromOpenMeteo({ ...base, weather_code: 71 }).snow).toBeCloseTo(0.55);
    expect(fromOpenMeteo({ ...base, weather_code: 73 }).snow).toBeCloseTo(0.8);
    expect(fromOpenMeteo({ ...base, weather_code: 86 }).snow).toBe(1);
    expect(fromOpenMeteo({ ...base, weather_code: 71 }).rain).toBe(0);
  });

  it('detects fog from the code or poor visibility', () => {
    expect(fromOpenMeteo({ ...base, weather_code: 45 }).fog).toBeCloseTo(0.9);
    expect(fromOpenMeteo({ ...base, visibility: 600 }).fog).toBeCloseTo(0.75);
    expect(fromOpenMeteo({ ...base, visibility: 3000 }).fog).toBeCloseTo(0.35);
  });

  it('scales wind from km/h', () => {
    expect(fromOpenMeteo({ ...base, wind_speed_10m: 23 }).wind).toBeCloseTo(0.5);
    expect(fromOpenMeteo({ ...base, wind_speed_10m: 60 }).wind).toBe(1);
  });
});
