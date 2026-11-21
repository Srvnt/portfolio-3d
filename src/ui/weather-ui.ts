import { SunClock, TimeChoice, WeatherState } from '../fx/weather';

export interface WeatherTarget {
  set(s: WeatherState): void;
  setClock(c: SunClock | null): void;
  setTime(t: TimeChoice): void;
  localTimeOfDay(): number | null;
}

export interface Place { name: string; lat: number; lon: number }
type Key = 'sun' | 'wind' | 'snow' | 'rain' | 'fog';
type Mode = 'live' | 'custom';

const CHIPS: { key: Key; label: string; icon: string }[] = [
  { key: 'sun', label: 'Sunny', icon: '☀️' },
  { key: 'wind', label: 'Windy', icon: '🌬️' },
  { key: 'snow', label: 'Snowy', icon: '❄️' },
  { key: 'rain', label: 'Rainy', icon: '🌧️' },
  { key: 'fog', label: 'Foggy', icon: '🌫️' },
];

const WMO: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail',
};

interface Current {
  temperature_2m: number; weather_code: number; cloud_cover: number;
  wind_speed_10m: number; visibility?: number; rain?: number; snowfall?: number;
}

export function fromOpenMeteo(c: Current): WeatherState {
  const code = c.weather_code;
  const rainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  const snowy = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const rain = rainy ? (code === 51 || code === 56 || code === 61 || code === 80 ? 0.45 : code === 65 || code === 82 || code >= 95 ? 1 : 0.75) : 0;
  const snow = snowy ? (code === 71 || code === 85 ? 0.55 : code === 75 || code === 86 ? 1 : 0.8) : 0;
  let fog = code === 45 || code === 48 ? 0.9 : 0;
  if (c.visibility !== undefined) fog = Math.max(fog, c.visibility < 1000 ? 0.75 : c.visibility < 4000 ? 0.35 : 0);
  let sun = 1 - Math.min(100, Math.max(0, c.cloud_cover)) / 100;
  if (rainy || snowy) sun = Math.min(sun, 0.25);
  const wind = Math.min(1, Math.max(0, (c.wind_speed_10m - 6) / 34));
  return { sun: Math.max(0.12, sun), wind, rain, snow, fog };
}

function customState(on: Set<Key>): WeatherState {
  return {
    sun: on.has('sun') ? 1 : 0.2,
    wind: on.has('wind') ? 0.9 : 0.1,
    snow: on.has('snow') ? 0.9 : 0,
    rain: on.has('rain') ? 0.9 : 0,
    fog: on.has('fog') ? 0.85 : 0,
  };
}

function iconsFor(s: WeatherState) {
  const out: string[] = [];
  if (s.sun > 0.6) out.push('☀️'); else if (s.rain < 0.1 && s.snow < 0.1) out.push('☁️');
  if (s.rain > 0.1) out.push('🌧️');
  if (s.snow > 0.1) out.push('❄️');
  if (s.wind > 0.45) out.push('🌬️');
  if (s.fog > 0.3) out.push('🌫️');
  return out.join('');
}

const STORE = 'portfolio-weather';

export class WeatherUI {
  private root = document.getElementById('weather')!;
  private pill = this.root.querySelector('.wx-pill') as HTMLButtonElement;
  private panel = this.root.querySelector('.wx-panel') as HTMLElement;
  private mode: Mode = 'live';
  private place: Place;
  private custom = new Set<Key>(['sun', 'wind']);
  private liveState: WeatherState | null = null;
  private liveText = '';
  private temp = '';
  private refresh = 0;
  private time: TimeChoice = 'auto';
  private placeLabel = '';
  private apply: (s: WeatherState) => void;

  constructor(private fx: WeatherTarget, defaultPlace: Place) {
    this.apply = (st) => fx.set(st);
    this.place = defaultPlace;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
      if (saved?.place?.name) this.place = saved.place;
      if (saved?.mode === 'custom' || saved?.mode === 'live') this.mode = saved.mode;
      if (Array.isArray(saved?.custom)) this.custom = new Set(saved.custom);
      if (['auto', 'day', 'dusk', 'night'].includes(saved?.time)) this.time = saved.time;
    } catch {}

    this.pill.addEventListener('click', () => this.togglePanel());
    this.root.querySelectorAll<HTMLButtonElement>('.wx-tabs button').forEach((b) =>
      b.addEventListener('click', () => this.setMode(b.dataset.mode as Mode)));
    const chips = this.root.querySelector('.wx-chips')!;
    for (const ch of CHIPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wx-chip';
      b.dataset.key = ch.key;
      b.innerHTML = `<span>${ch.icon}</span>${ch.label}`;
      b.addEventListener('click', () => {
        if (this.custom.has(ch.key)) this.custom.delete(ch.key); else this.custom.add(ch.key);
        this.mode = 'custom';
        this.sync();
      });
      chips.appendChild(b);
    }
    const form = this.root.querySelector('.wx-search') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = (form.querySelector('input') as HTMLInputElement).value.trim();
      if (q) this.search(q);
    });
    this.root.querySelector('.wx-close')!.addEventListener('click', () => this.togglePanel(false));
    this.root.querySelectorAll<HTMLButtonElement>('.wx-time button').forEach((b) =>
      b.addEventListener('click', () => { this.time = b.dataset.time as TimeChoice; this.sync(); }));
    window.setInterval(() => this.updateClock(), 15_000);
    this.sync();
    if (this.mode === 'custom') this.fetchLive();
  }

  show() { this.root.hidden = false; }

  private togglePanel(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.pill.setAttribute('aria-expanded', String(open));
  }

  private setMode(mode: Mode) {
    this.mode = mode;
    this.sync();
  }

  private save() {
    try { localStorage.setItem(STORE, JSON.stringify({ mode: this.mode, place: this.place, custom: [...this.custom], time: this.time })); } catch {}
  }

  private sync() {
    this.save();
    this.root.querySelectorAll<HTMLButtonElement>('.wx-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === this.mode));
    this.root.querySelectorAll<HTMLButtonElement>('.wx-chip').forEach((b) => b.classList.toggle('on', this.custom.has(b.dataset.key as Key)));
    (this.root.querySelector('.wx-live') as HTMLElement).hidden = this.mode !== 'live';
    (this.root.querySelector('.wx-custom') as HTMLElement).hidden = this.mode !== 'custom';
    const time = this.mode === 'live' ? 'auto' : this.time;
    this.fx.setTime(time);
    this.root.querySelectorAll<HTMLButtonElement>('.wx-time button').forEach((b) => b.classList.toggle('on', b.dataset.time === this.time));
    clearInterval(this.refresh);
    if (this.mode === 'custom') {
      const s = customState(this.custom);
      this.apply(s);
      this.setPill(iconsFor(s), 'Custom', '');
    } else {
      if (this.liveState) { this.apply(this.liveState); this.setPill(iconsFor(this.liveState), this.place.name, this.temp); }
      this.fetchLive();
      this.refresh = window.setInterval(() => this.fetchLive(), 15 * 60 * 1000);
    }
  }

  private setPill(icons: string, place: string, temp: string) {
    (this.pill.querySelector('.wx-icons') as HTMLElement).textContent = icons || '☁️';
    this.placeLabel = place.split(',')[0];
    (this.pill.querySelector('.wx-place') as HTMLElement).textContent = this.placeLabel;
    (this.pill.querySelector('.wx-temp') as HTMLElement).textContent = temp;
    this.updateClock();
  }

  private updateClock() {
    const el = this.pill.querySelector('.wx-time-now') as HTMLElement;
    const pinned = this.mode === 'custom' && this.time !== 'auto';
    if (pinned) { el.textContent = { day: '☀ Day', dusk: '🌇 Sunset', night: '🌙 Night' }[this.time as 'day' | 'dusk' | 'night']; return; }
    const tod = this.fx.localTimeOfDay();
    if (tod === null) { el.textContent = ''; return; }
    const h = Math.floor(tod / 3_600_000), m = Math.floor((tod % 3_600_000) / 60_000);
    el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private async fetchLive() {
    const now = this.root.querySelector('.wx-now') as HTMLElement;
    now.textContent = `Fetching weather for ${this.place.name}…`;
    const p = this.place;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}` +
        '&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,visibility,rain,snowfall,is_day' +
        '&daily=sunrise,sunset&forecast_days=1&timezone=auto';
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const c = data.current as Current & { is_day?: number };
      if (this.place !== p) return;
      const tod = (iso?: string | null) => (iso ? ((Date.parse(`${iso}Z`) % 86_400_000) + 86_400_000) % 86_400_000 : null);
      this.fx.setClock({
        utcOffset: data.utc_offset_seconds ?? 0,
        sunrise: tod(data.daily?.sunrise?.[0]),
        sunset: tod(data.daily?.sunset?.[0]),
        isDay: c.is_day !== 0,
      });
      this.updateClock();
      if (this.mode !== 'live') return;
      this.liveState = fromOpenMeteo(c);
      this.temp = `${Math.round(c.temperature_2m)}°C`;
      this.liveText = `${WMO[c.weather_code] ?? 'Weather'} · ${this.temp} · wind ${Math.round(c.wind_speed_10m)} km/h`;
      now.textContent = `${p.name}: ${this.liveText}`;
      this.apply(this.liveState);
      this.setPill(iconsFor(this.liveState), p.name, this.temp);
    } catch {
      now.textContent = "Couldn't reach the weather service. Showing clear skies.";
      if (this.mode !== 'live') return;
      this.apply({ sun: 1, wind: 0.15, rain: 0, snow: 0, fog: 0 });
      this.setPill('☀️', p.name, '');
    }
  }

  private async search(q: string) {
    const list = this.root.querySelector('.wx-results') as HTMLElement;
    list.textContent = 'Searching…';
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
      const data = await res.json();
      list.textContent = '';
      const results = (data.results ?? []) as { name: string; country?: string; admin1?: string; latitude: number; longitude: number }[];
      if (!results.length) { list.textContent = 'No places found.'; return; }
      for (const r of results) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
        b.addEventListener('click', () => {
          this.place = { name: [r.name, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude };
          this.liveState = null;
          list.textContent = '';
          this.mode = 'live';
          this.sync();
        });
        li.appendChild(b);
        list.appendChild(li);
      }
    } catch {
      list.textContent = 'Search failed. Check your connection.';
    }
  }
}
