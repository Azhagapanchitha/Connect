// Vedic birth chart (rasi chart) and Vimshottari dasa/bhukti.
// Sidereal zodiac with Lahiri ayanamsa, mean lunar node for Rahu/Ketu, whole-sign rasi placement.
const A = require('astronomy-engine');
const { find: findTimeZone } = require('geo-tz');
const db = require('./db');

const RASIS = ['Mesham', 'Rishabam', 'Mithunam', 'Kadagam', 'Simmam', 'Kanni', 'Thulam', 'Viruchigam', 'Dhanusu', 'Magaram', 'Kumbam', 'Meenam'];
const RASI_EN = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const NAKSHATRAS = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashirsha', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha',
  'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
];
// Vimshottari order starting from Ashwini's lord, with mahadasa lengths in years (total 120).
const DASA_LORDS = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'];
const DASA_YEARS = { Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7, Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17 };
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const NAK_SPAN = 360 / 27;

const PLANETS = [
  ['Sun', 'Su', A.Body.Sun], ['Moon', 'Mo', A.Body.Moon], ['Mars', 'Ma', A.Body.Mars], ['Mercury', 'Me', A.Body.Mercury],
  ['Jupiter', 'Ju', A.Body.Jupiter], ['Venus', 'Ve', A.Body.Venus], ['Saturn', 'Sa', A.Body.Saturn],
];

const norm = (d) => ((d % 360) + 360) % 360;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Lahiri (Chitrapaksha) ayanamsa: 23°51'11" at J2000, precessing ~50.29" a year.
const ayanamsa = (t) => 23.853056 + (t.tt / 365.25) * (50.2788 / 3600);

// Mean ascending lunar node (Meeus), tropical ecliptic of date.
function meanNode(t) {
  const T = t.tt / 36525;
  return norm(125.04452 - 1934.136261 * T + 0.0020708 * T * T + (T * T * T) / 450000);
}

// Tropical ascendant from local apparent sidereal time and latitude.
function ascendant(t, lat, lon) {
  const ramc = rad(norm(A.SiderealTime(t) * 15 + lon));
  const eps = rad(A.e_tilt(t).tobl);
  const asc = Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(rad(lat)) * Math.sin(eps)));
  return norm(deg(asc));
}

function placement(name, short, siderealLon, extra = {}) {
  const rasi = Math.floor(siderealLon / 30);
  const nak = Math.floor(siderealLon / NAK_SPAN);
  return {
    name, short, lon: Math.round(siderealLon * 100) / 100,
    rasi, rasiName: RASIS[rasi], rasiEn: RASI_EN[rasi], degInRasi: Math.round((siderealLon % 30) * 100) / 100,
    nakshatra: NAKSHATRAS[nak], pada: Math.floor((siderealLon % NAK_SPAN) / (NAK_SPAN / 4)) + 1, ...extra,
  };
}

// UTC offset (minutes) of an IANA zone at a given instant, e.g. Asia/Kolkata -> 330.
function offsetMinutes(timeZone, date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName').value; // "GMT+05:30" or "GMT"
  const m = part.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

// Local wall-clock birth time in a zone -> UTC Date (handles historical offsets and DST).
function localToUtc(date, time, timeZone) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let utc = wall - offsetMinutes(timeZone, new Date(wall)) * 60000;
  utc = wall - offsetMinutes(timeZone, new Date(utc)) * 60000;
  return new Date(utc);
}

const data = () => db.data;

// Free-text birth place -> { lat, lon, label, timeZone }, via OpenStreetMap Nominatim; cached in the data file.
const pending = new Map();
async function geocode(place) {
  const key = place.trim().toLowerCase();
  if (!key) return null;
  data().places ||= {};
  if (data().places[key] !== undefined) return data().places[key];
  if (!pending.has(key)) {
    pending.set(key, (async () => {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'JothidaConnect/1.0 (birth chart place lookup)' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Place lookup failed (${res.status})`);
      const [hit] = await res.json();
      const found = hit ? {
        lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name,
        timeZone: findTimeZone(Number(hit.lat), Number(hit.lon))[0] || 'UTC',
      } : null;
      data().places[key] = found; // cache misses too, so a bad place isn't looked up on every chat
      db.save();
      return found;
    })().finally(() => pending.delete(key)));
  }
  return pending.get(key);
}
// Vimshottari mahadasas from birth, each with its bhuktis (antardasas).
function vimshottari(moonLon, birth) {
  const nak = Math.floor(moonLon / NAK_SPAN);
  const firstLord = nak % 9;
  const elapsedFrac = (moonLon % NAK_SPAN) / NAK_SPAN;
  // The first dasa started before birth; walk back by the elapsed part so every period has true dates.
  let start = birth.getTime() - elapsedFrac * DASA_YEARS[DASA_LORDS[firstLord]] * YEAR_MS;
  const dasas = [];
  for (let i = 0; i < 9; i++) {
    const lord = DASA_LORDS[(firstLord + i) % 9];
    const years = DASA_YEARS[lord];
    const end = start + years * YEAR_MS;
    let bStart = start;
    const bhuktis = [];
    for (let j = 0; j < 9; j++) {
      const sub = DASA_LORDS[(firstLord + i + j) % 9];
      const bEnd = bStart + ((years * DASA_YEARS[sub]) / 120) * YEAR_MS;
      bhuktis.push({ lord: sub, start: new Date(bStart).toISOString(), end: new Date(bEnd).toISOString() });
      bStart = bEnd;
    }
    dasas.push({ lord, years, start: new Date(start).toISOString(), end: new Date(end).toISOString(), bhuktis });
    start = end;
  }
  return { balance: { lord: DASA_LORDS[firstLord], years: Math.round((1 - elapsedFrac) * DASA_YEARS[DASA_LORDS[firstLord]] * 100) / 100 }, dasas };
}

// Full chart for a customer's stored birth details. Missing place -> no lagna; missing time -> noon, flagged.
async function chartFor({ birthDate, birthTime, birthPlace }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || '')) return { error: 'The client has not added a valid date of birth.' };
  const warnings = [];
  let time = birthTime;
  if (!/^\d{2}:\d{2}$/.test(time || '')) { time = '12:00'; warnings.push('Birth time missing: chart cast for 12:00 noon, lagna not shown.'); }

  let place = null;
  try { place = birthPlace ? await geocode(birthPlace) : null; } catch (e) { warnings.push(`Could not look up the birth place (${e.message}).`); }
  if (!place) warnings.push(birthPlace ? `Birth place "${birthPlace}" not found: assumed India time, lagna not shown.` : 'Birth place missing: assumed India time, lagna not shown.');

  const timeZone = place?.timeZone || 'Asia/Kolkata';
  const utc = localToUtc(birthDate, time, timeZone);
  const timeKnown = /^\d{2}:\d{2}$/.test(birthTime || '');
  const { ayanamsa, lagna, planets, moon } = castChart(utc, timeKnown ? place : null);

  return {
    input: { birthDate, birthTime: birthTime || null, birthPlace: birthPlace || null },
    place: place && { label: place.label, lat: place.lat, lon: place.lon },
    timeZone,
    utc: utc.toISOString(),
    ayanamsa,
    rasi: { index: moon.rasi, name: moon.rasiName, en: moon.rasiEn },
    nakshatra: { name: moon.nakshatra, pada: moon.pada },
    lagna,
    planets,
    dasa: vimshottari(moon.lon, utc),
    warnings,
  };
}

// Planet, node and lagna positions for an instant; lagna only when a place { lat, lon } is given.
function castChart(utc, place) {
  const t = A.MakeTime(utc);
  const ayan = ayanamsa(t);
  const sid = (tropical) => norm(tropical - ayan);

  const planets = PLANETS.map(([name, short, body]) => {
    const lon = body === A.Body.Moon ? A.EclipticGeoMoon(t).lon : A.Ecliptic(A.GeoVector(body, t, true)).elon;
    let retro = false;
    if (body !== A.Body.Sun && body !== A.Body.Moon) {
      const later = A.Ecliptic(A.GeoVector(body, t.AddDays(1), true)).elon;
      retro = norm(later - lon) > 180; // moved backwards over the next day
    }
    return placement(name, short, sid(lon), { retro });
  });
  const rahu = sid(meanNode(t));
  planets.push(placement('Rahu', 'Ra', rahu, { retro: true }), placement('Ketu', 'Ke', norm(rahu + 180), { retro: true }));

  const lagna = place ? placement('Lagna', 'La', sid(ascendant(t, place.lat, place.lon))) : null;
  const moon = planets.find((p) => p.name === 'Moon');

  return { utc: utc.toISOString(), ayanamsa: Math.round(ayan * 10000) / 10000, lagna, planets, moon };
}

module.exports = { chartFor, castChart, vimshottari, localToUtc, RASIS, RASI_EN };
