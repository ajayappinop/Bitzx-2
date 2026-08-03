/**
 * Country list via Intl (no static 250-line file). City pools: per-country + global fallback.
 */

const FALLBACK_COUNTRIES = [
  'Afghanistan', 'Argentina', 'Australia', 'Austria', 'Bangladesh', 'Belgium', 'Brazil',
  'Canada', 'Chile', 'China', 'Colombia', 'Czechia', 'Denmark', 'Egypt', 'Finland', 'France',
  'Germany', 'Ghana', 'Greece', 'Hong Kong', 'Hungary', 'India', 'Indonesia', 'Ireland',
  'Israel', 'Italy', 'Japan', 'Kenya', 'Malaysia', 'Mexico', 'Netherlands', 'New Zealand',
  'Nigeria', 'Norway', 'Pakistan', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Romania',
  'Russia', 'Saudi Arabia', 'Singapore', 'South Africa', 'South Korea', 'Spain', 'Sweden',
  'Switzerland', 'Taiwan', 'Thailand', 'Turkey', 'Ukraine', 'United Arab Emirates',
  'United Kingdom', 'United States', 'Vietnam',
];

let _countryNamesCache = null;

/** @returns {string[]} */
export function listCountryNames() {
  if (_countryNamesCache) return _countryNamesCache;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      const codes = Intl.supportedValuesOf('region');
      const dn = new Intl.DisplayNames(['en'], { type: 'region' });
      _countryNamesCache = codes
        .filter((c) => /^[A-Z]{2}$/.test(c) && c !== 'ZZ' && c !== 'EU')
        .map((c) => dn.of(c))
        .filter((n) => n && !/^\d/.test(n))
        .sort((a, b) => a.localeCompare(b));
      if (_countryNamesCache.length > 50) return _countryNamesCache;
    }
  } catch {
    /* ignore */
  }
  _countryNamesCache = [...FALLBACK_COUNTRIES].sort((a, b) => a.localeCompare(b));
  return _countryNamesCache;
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Major cities by English country name (flexible matching). */
const CITIES_BY_COUNTRY_RAW = {
  India: [
    'Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Ahmedabad', 'Chennai', 'Kolkata', 'Pune',
    'Jaipur', 'Surat', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Thane', 'Bhopal', 'Patna',
    'Vadodara', 'Ghaziabad', 'Ludhiana', 'Coimbatore', 'Kochi', 'Visakhapatnam', 'Nashik',
  ],
  'United States': [
    'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio',
    'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville', 'Fort Worth', 'Columbus',
    'Charlotte', 'San Francisco', 'Indianapolis', 'Seattle', 'Denver', 'Boston', 'Miami',
    'Atlanta', 'Las Vegas', 'Portland', 'Detroit', 'Nashville', 'Memphis', 'Baltimore',
  ],
  'United Kingdom': [
    'London', 'Birmingham', 'Manchester', 'Glasgow', 'Liverpool', 'Leeds', 'Sheffield',
    'Edinburgh', 'Bristol', 'Cardiff', 'Belfast', 'Leicester', 'Coventry', 'Nottingham',
  ],
  Canada: [
    'Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Edmonton', 'Ottawa', 'Winnipeg',
    'Quebec City', 'Hamilton', 'Victoria', 'Halifax', 'Saskatoon', 'Regina',
  ],
  Australia: [
    'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast', 'Canberra',
    'Newcastle', 'Hobart', 'Darwin', 'Wollongong', 'Geelong',
  ],
  Germany: [
    'Berlin', 'Hamburg', 'Munich', 'Cologne', 'Frankfurt', 'Stuttgart', 'Düsseldorf',
    'Leipzig', 'Dortmund', 'Essen', 'Bremen', 'Nuremberg',
  ],
  France: [
    'Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Montpellier',
    'Bordeaux', 'Lille',
  ],
  'United Arab Emirates': [
    'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Al Ain',
  ],
  Singapore: ['Singapore'],
  Japan: ['Tokyo', 'Yokohama', 'Osaka', 'Nagoya', 'Sapporo', 'Fukuoka', 'Kobe', 'Kyoto'],
  Brazil: ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Fortaleza', 'Belo Horizonte'],
  Mexico: ['Mexico City', 'Guadalajara', 'Monterrey', 'Puebla', 'Tijuana', 'León'],
  Spain: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Zaragoza', 'Málaga'],
  Italy: ['Rome', 'Milan', 'Naples', 'Turin', 'Palermo', 'Genoa', 'Bologna', 'Florence'],
  China: ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Hangzhou', 'Wuhan'],
  'South Korea': ['Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon'],
  'South Africa': ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth'],
  Nigeria: ['Lagos', 'Abuja', 'Kano', 'Ibadan', 'Port Harcourt'],
  'Saudi Arabia': ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam'],
  Egypt: ['Cairo', 'Alexandria', 'Giza', 'Sharm El Sheikh'],
  Indonesia: ['Jakarta', 'Surabaya', 'Bandung', 'Medan', 'Bali'],
  Malaysia: ['Kuala Lumpur', 'George Town', 'Johor Bahru', 'Ipoh'],
  Thailand: ['Bangkok', 'Chiang Mai', 'Pattaya', 'Phuket'],
  Vietnam: ['Ho Chi Minh City', 'Hanoi', 'Da Nang', 'Hai Phong'],
  Philippines: ['Manila', 'Quezon City', 'Davao', 'Cebu'],
  Netherlands: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven'],
  Switzerland: ['Zurich', 'Geneva', 'Basel', 'Bern', 'Lausanne'],
  Poland: ['Warsaw', 'Kraków', 'Łódź', 'Wrocław', 'Poznań'],
  Turkey: ['Istanbul', 'Ankara', 'İzmir', 'Antalya', 'Bursa'],
  'New Zealand': ['Auckland', 'Wellington', 'Christchurch', 'Hamilton'],
  Ireland: ['Dublin', 'Cork', 'Limerick', 'Galway'],
  Portugal: ['Lisbon', 'Porto', 'Braga'],
  Belgium: ['Brussels', 'Antwerp', 'Ghent'],
  Austria: ['Vienna', 'Graz', 'Linz', 'Salzburg'],
};

const COUNTRY_KEY_MAP = new Map(
  Object.keys(CITIES_BY_COUNTRY_RAW).map((k) => [norm(k), CITIES_BY_COUNTRY_RAW[k]]),
);

const GLOBAL_MAJOR_CITIES = Array.from(
  new Set(Object.values(CITIES_BY_COUNTRY_RAW).flat()),
).sort((a, b) => a.localeCompare(b));

/** @param {string} countryName */
export function cityPoolForCountry(countryName) {
  const n = norm(countryName);
  if (!n) return GLOBAL_MAJOR_CITIES;
  for (const [key, cities] of COUNTRY_KEY_MAP) {
    if (key === n || key.includes(n) || n.includes(key)) return cities;
  }
  return GLOBAL_MAJOR_CITIES;
}

/**
 * @param {string} query
 * @param {number} limit
 * @returns {string[]}
 */
export function suggestCountries(query, limit = 48) {
  const q = norm(query);
  const all = listCountryNames();
  if (!q) return all.slice(0, limit);
  const starts = [];
  const rest = [];
  for (const c of all) {
    const cn = norm(c);
    if (cn.startsWith(q)) starts.push(c);
    else if (cn.includes(q)) rest.push(c);
  }
  return [...starts, ...rest].slice(0, limit);
}

/**
 * @param {string} countryName
 * @param {string} query
 * @param {number} limit
 * @returns {string[]}
 */
export function suggestCities(countryName, query, limit = 48) {
  const q = norm(query);
  const pool = cityPoolForCountry(countryName);
  if (!q) return pool.slice(0, limit);
  const starts = [];
  const rest = [];
  for (const c of pool) {
    const cn = norm(c);
    if (cn.startsWith(q)) starts.push(c);
    else if (cn.includes(q)) rest.push(c);
  }
  return [...starts, ...rest].slice(0, limit);
}

/** Common short forms accepted alongside Intl country names */
const COUNTRY_ALIAS_OK = new Set([
  'uk',
  'uae',
  'usa',
  'us',
  'great britain',
  'britain',
  'england',
  'scotland',
  'wales',
  'south korea',
  'north korea',
  'russia',
  'vietnam',
  'czech republic',
  'ivory coast',
  'the netherlands',
  'holland',
  'russian federation',
]);

/** @param {string} name */
export function isKnownCountryName(name) {
  const n = norm(name);
  if (!n) return false;
  if (COUNTRY_ALIAS_OK.has(n)) return true;
  return listCountryNames().some((c) => norm(c) === n);
}
