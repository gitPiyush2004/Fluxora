/**
 * Country reference data + approximate coordinates used only for map visualisation.
 * Cities not in the table fall back to the country centroid.
 */
export const COUNTRIES: Record<string, { name: string; lat: number; lng: number }> = {
  US: { name: 'United States', lat: 39.8, lng: -98.6 },
  CA: { name: 'Canada', lat: 56.1, lng: -106.3 },
  MX: { name: 'Mexico', lat: 23.6, lng: -102.5 },
  BR: { name: 'Brazil', lat: -14.2, lng: -51.9 },
  AR: { name: 'Argentina', lat: -38.4, lng: -63.6 },
  CL: { name: 'Chile', lat: -35.7, lng: -71.5 },
  GB: { name: 'United Kingdom', lat: 54.0, lng: -2.0 },
  IE: { name: 'Ireland', lat: 53.4, lng: -8.2 },
  DE: { name: 'Germany', lat: 51.2, lng: 10.4 },
  FR: { name: 'France', lat: 46.2, lng: 2.2 },
  NL: { name: 'Netherlands', lat: 52.1, lng: 5.3 },
  BE: { name: 'Belgium', lat: 50.5, lng: 4.5 },
  ES: { name: 'Spain', lat: 40.5, lng: -3.7 },
  IT: { name: 'Italy', lat: 41.9, lng: 12.6 },
  PL: { name: 'Poland', lat: 51.9, lng: 19.1 },
  SE: { name: 'Sweden', lat: 60.1, lng: 18.6 },
  DK: { name: 'Denmark', lat: 56.3, lng: 9.5 },
  CH: { name: 'Switzerland', lat: 46.8, lng: 8.2 },
  AT: { name: 'Austria', lat: 47.5, lng: 14.6 },
  PT: { name: 'Portugal', lat: 39.4, lng: -8.2 },
  TR: { name: 'Türkiye', lat: 39.0, lng: 35.2 },
  AE: { name: 'United Arab Emirates', lat: 23.4, lng: 53.8 },
  SA: { name: 'Saudi Arabia', lat: 23.9, lng: 45.1 },
  IL: { name: 'Israel', lat: 31.0, lng: 34.9 },
  IN: { name: 'India', lat: 20.6, lng: 78.96 },
  CN: { name: 'China', lat: 35.9, lng: 104.2 },
  HK: { name: 'Hong Kong', lat: 22.3, lng: 114.2 },
  JP: { name: 'Japan', lat: 36.2, lng: 138.3 },
  KR: { name: 'South Korea', lat: 35.9, lng: 127.8 },
  SG: { name: 'Singapore', lat: 1.35, lng: 103.8 },
  VN: { name: 'Vietnam', lat: 14.1, lng: 108.3 },
  TH: { name: 'Thailand', lat: 15.9, lng: 100.99 },
  MY: { name: 'Malaysia', lat: 4.2, lng: 101.98 },
  ID: { name: 'Indonesia', lat: -0.8, lng: 113.9 },
  BD: { name: 'Bangladesh', lat: 23.7, lng: 90.4 },
  PK: { name: 'Pakistan', lat: 30.4, lng: 69.3 },
  AU: { name: 'Australia', lat: -25.3, lng: 133.8 },
  NZ: { name: 'New Zealand', lat: -40.9, lng: 174.9 },
  ZA: { name: 'South Africa', lat: -30.6, lng: 22.9 },
  EG: { name: 'Egypt', lat: 26.8, lng: 30.8 },
  NG: { name: 'Nigeria', lat: 9.1, lng: 8.7 },
  KE: { name: 'Kenya', lat: -0.02, lng: 37.9 },
  MA: { name: 'Morocco', lat: 31.8, lng: -7.1 },
};

export const COUNTRY_OPTIONS = Object.entries(COUNTRIES)
  .map(([code, c]) => ({ value: code, label: `${c.name} (${code})` }))
  .sort((a, b) => a.label.localeCompare(b.label));

const CITIES: Record<string, [number, number]> = {
  'shenzhen|CN': [22.54, 114.06], 'shanghai|CN': [31.23, 121.47], 'ningbo|CN': [29.87, 121.54], 'guangzhou|CN': [23.13, 113.26],
  'tirupur|IN': [11.11, 77.34], 'bengaluru|IN': [12.97, 77.59], 'faridabad|IN': [28.41, 77.32], 'mumbai|IN': [19.08, 72.88], 'chennai|IN': [13.08, 80.27], 'delhi|IN': [28.61, 77.21],
  'porto|PT': [41.15, -8.61], 'lisbon|PT': [38.72, -9.14], 'rotterdam|NL': [51.92, 4.48], 'amsterdam|NL': [52.37, 4.9], 'venlo|NL': [51.37, 6.17],
  'monterrey|MX': [25.69, -100.32], 'mexico city|MX': [19.43, -99.13], 'ho chi minh city|VN': [10.82, 106.63], 'hanoi|VN': [21.03, 105.85],
  'newark|US': [40.74, -74.17], 'new york|US': [40.71, -74.01], 'los angeles|US': [34.05, -118.24], 'chicago|US': [41.88, -87.63], 'memphis|US': [35.15, -90.05],
  'houston|US': [29.76, -95.37], 'seattle|US': [47.61, -122.33], 'miami|US': [25.76, -80.19], 'atlanta|US': [33.75, -84.39],
  'london|GB': [51.51, -0.13], 'leeds|GB': [53.8, -1.55], 'manchester|GB': [53.48, -2.24], 'berlin|DE': [52.52, 13.4], 'hamburg|DE': [53.55, 9.99],
  'leipzig|DE': [51.34, 12.37], 'frankfurt|DE': [50.11, 8.68], 'munich|DE': [48.14, 11.58], 'paris|FR': [48.86, 2.35], 'lyon|FR': [45.76, 4.84],
  'zaragoza|ES': [41.65, -0.89], 'madrid|ES': [40.42, -3.7], 'barcelona|ES': [41.39, 2.17], 'milan|IT': [45.46, 9.19], 'antwerp|BE': [51.22, 4.4], 'gothenburg|SE': [57.71, 11.97],
  'copenhagen|DK': [55.68, 12.57], 'warsaw|PL': [52.23, 21.01], 'istanbul|TR': [41.01, 28.98], 'dubai|AE': [25.2, 55.27], 'jebel ali|AE': [25.01, 55.06],
  'singapore|SG': [1.29, 103.85], 'hong kong|HK': [22.32, 114.17], 'tokyo|JP': [35.68, 139.69], 'busan|KR': [35.18, 129.08], 'seoul|KR': [37.57, 126.98],
  'bangkok|TH': [13.76, 100.5], 'jakarta|ID': [-6.21, 106.85], 'dhaka|BD': [23.81, 90.41], 'karachi|PK': [24.86, 67.0], 'sydney|AU': [-33.87, 151.21],
  'melbourne|AU': [-37.81, 144.96], 'auckland|NZ': [-36.85, 174.76], 'são paulo|BR': [-23.55, -46.63], 'sao paulo|BR': [-23.55, -46.63], 'santos|BR': [-23.96, -46.33],
  'buenos aires|AR': [-34.6, -58.38], 'santiago|CL': [-33.45, -70.67], 'toronto|CA': [43.65, -79.38], 'vancouver|CA': [49.28, -123.12],
  'johannesburg|ZA': [-26.2, 28.05], 'durban|ZA': [-29.86, 31.02], 'cairo|EG': [30.04, 31.24], 'lagos|NG': [6.52, 3.38], 'nairobi|KE': [-1.29, 36.82], 'casablanca|MA': [33.57, -7.59],
};

export function coordsFor(city: string | undefined, country: string): { lat: number; lng: number } {
  const hit = city ? CITIES[`${city.trim().toLowerCase()}|${country}`] : undefined;
  if (hit) return { lat: hit[0], lng: hit[1] };
  const c = COUNTRIES[country];
  return c ? { lat: c.lat, lng: c.lng } : { lat: 0, lng: 0 };
}

export function countryName(code: string | undefined): string {
  return (code && COUNTRIES[code]?.name) || code || '—';
}

export function placeLabel(p: { city?: string; country?: string } | undefined): string {
  if (!p) return '—';
  return [p.city, p.country].filter(Boolean).join(', ');
}
