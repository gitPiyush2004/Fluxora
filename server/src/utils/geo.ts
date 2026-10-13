/**
 * Minimal country reference data used for validation, routing zones and the
 * simulator. Region assignment drives simulated zone pricing only.
 */
export type Region = 'EUROPE' | 'NORTH_AMERICA' | 'SOUTH_AMERICA' | 'ASIA' | 'MIDDLE_EAST' | 'OCEANIA' | 'AFRICA';

export const COUNTRIES: Record<string, { name: string; region: Region }> = {
  US: { name: 'United States', region: 'NORTH_AMERICA' },
  CA: { name: 'Canada', region: 'NORTH_AMERICA' },
  MX: { name: 'Mexico', region: 'NORTH_AMERICA' },
  BR: { name: 'Brazil', region: 'SOUTH_AMERICA' },
  AR: { name: 'Argentina', region: 'SOUTH_AMERICA' },
  CL: { name: 'Chile', region: 'SOUTH_AMERICA' },
  GB: { name: 'United Kingdom', region: 'EUROPE' },
  IE: { name: 'Ireland', region: 'EUROPE' },
  DE: { name: 'Germany', region: 'EUROPE' },
  FR: { name: 'France', region: 'EUROPE' },
  NL: { name: 'Netherlands', region: 'EUROPE' },
  BE: { name: 'Belgium', region: 'EUROPE' },
  ES: { name: 'Spain', region: 'EUROPE' },
  IT: { name: 'Italy', region: 'EUROPE' },
  PL: { name: 'Poland', region: 'EUROPE' },
  SE: { name: 'Sweden', region: 'EUROPE' },
  DK: { name: 'Denmark', region: 'EUROPE' },
  CH: { name: 'Switzerland', region: 'EUROPE' },
  AT: { name: 'Austria', region: 'EUROPE' },
  PT: { name: 'Portugal', region: 'EUROPE' },
  TR: { name: 'Türkiye', region: 'EUROPE' },
  AE: { name: 'United Arab Emirates', region: 'MIDDLE_EAST' },
  SA: { name: 'Saudi Arabia', region: 'MIDDLE_EAST' },
  IL: { name: 'Israel', region: 'MIDDLE_EAST' },
  IN: { name: 'India', region: 'ASIA' },
  CN: { name: 'China', region: 'ASIA' },
  HK: { name: 'Hong Kong', region: 'ASIA' },
  JP: { name: 'Japan', region: 'ASIA' },
  KR: { name: 'South Korea', region: 'ASIA' },
  SG: { name: 'Singapore', region: 'ASIA' },
  VN: { name: 'Vietnam', region: 'ASIA' },
  TH: { name: 'Thailand', region: 'ASIA' },
  MY: { name: 'Malaysia', region: 'ASIA' },
  ID: { name: 'Indonesia', region: 'ASIA' },
  BD: { name: 'Bangladesh', region: 'ASIA' },
  PK: { name: 'Pakistan', region: 'ASIA' },
  AU: { name: 'Australia', region: 'OCEANIA' },
  NZ: { name: 'New Zealand', region: 'OCEANIA' },
  ZA: { name: 'South Africa', region: 'AFRICA' },
  EG: { name: 'Egypt', region: 'AFRICA' },
  NG: { name: 'Nigeria', region: 'AFRICA' },
  KE: { name: 'Kenya', region: 'AFRICA' },
  MA: { name: 'Morocco', region: 'AFRICA' },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES) as [string, ...string[]];

export type RouteZone = 'DOMESTIC' | 'REGIONAL' | 'INTERCONTINENTAL';

export function routeZone(originCountry: string, destinationCountry: string): RouteZone {
  if (originCountry === destinationCountry) return 'DOMESTIC';
  const a = COUNTRIES[originCountry]?.region;
  const b = COUNTRIES[destinationCountry]?.region;
  if (a && b && a === b) return 'REGIONAL';
  return 'INTERCONTINENTAL';
}
