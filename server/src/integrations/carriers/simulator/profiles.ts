import type { RouteZone } from '../../../utils/geo.js';
import type { ServiceLevel, ShipmentType, SpecialHandling } from '../../../modules/shipments/shipment.rules.js';
import type { CarrierCode } from '../types.js';

/**
 * ILLUSTRATIVE simulation profiles.
 *
 * These numbers are invented for demonstration purposes. They are NOT the carriers'
 * tariffs, service catalogues, limits or performance, and every quote produced from
 * them is labelled sourceType=SIMULATED / isSimulated=true.
 */
export interface SimService {
  code: string;
  name: string;
  level: ServiceLevel;
  shipmentTypes: ShipmentType[];
  maxWeightPerPackageKg: number;
  maxTotalWeightKg: number;
  maxLengthCm: number;
  specialHandling: SpecialHandling[];
  divisor: number;
  roundingKg: number;
  /** USD, per shipment. */
  base: Record<RouteZone, number>;
  /** USD per billable kg. */
  perKg: Record<RouteZone, number>;
  /** Business days. */
  transitDays: Record<RouteZone, number>;
  minChargeUsd: number;
}

export interface SimProfile {
  code: CarrierCode;
  name: string;
  priceFactor: number;
  supportsCancellation: boolean;
  services: SimService[];
}

const PARCEL: ShipmentType[] = ['PARCEL', 'BOX'];
const FREIGHT: ShipmentType[] = ['BOX', 'PALLET', 'FREIGHT'];

export const SIM_PROFILES: SimProfile[] = [
  {
    code: 'DHL',
    name: 'DHL',
    priceFactor: 1.06,
    supportsCancellation: true,
    services: [
      {
        code: 'SIM-DHL-EXP', name: 'Express', level: 'EXPRESS', shipmentTypes: PARCEL,
        maxWeightPerPackageKg: 70, maxTotalWeightKg: 1000, maxLengthCm: 120, specialHandling: ['FRAGILE', 'DANGEROUS_GOODS'],
        divisor: 5000, roundingKg: 0.5,
        base: { DOMESTIC: 18, REGIONAL: 32, INTERCONTINENTAL: 55 }, perKg: { DOMESTIC: 2.1, REGIONAL: 4.6, INTERCONTINENTAL: 9.4 },
        transitDays: { DOMESTIC: 1, REGIONAL: 2, INTERCONTINENTAL: 3 }, minChargeUsd: 25,
      },
      {
        code: 'SIM-DHL-ECO', name: 'Economy Parcel', level: 'ECONOMY', shipmentTypes: PARCEL,
        maxWeightPerPackageKg: 70, maxTotalWeightKg: 1000, maxLengthCm: 120, specialHandling: ['FRAGILE'],
        divisor: 5000, roundingKg: 0.5,
        base: { DOMESTIC: 9, REGIONAL: 18, INTERCONTINENTAL: 32 }, perKg: { DOMESTIC: 1.2, REGIONAL: 2.6, INTERCONTINENTAL: 5.2 },
        transitDays: { DOMESTIC: 3, REGIONAL: 5, INTERCONTINENTAL: 8 }, minChargeUsd: 12,
      },
    ],
  },
  {
    code: 'FEDEX',
    name: 'FedEx',
    priceFactor: 1.03,
    supportsCancellation: true,
    services: [
      {
        code: 'SIM-FDX-PRI', name: 'Priority', level: 'EXPRESS', shipmentTypes: PARCEL,
        maxWeightPerPackageKg: 68, maxTotalWeightKg: 1000, maxLengthCm: 274, specialHandling: ['FRAGILE', 'DANGEROUS_GOODS', 'OVERSIZED'],
        divisor: 5000, roundingKg: 0.5,
        base: { DOMESTIC: 17, REGIONAL: 34, INTERCONTINENTAL: 58 }, perKg: { DOMESTIC: 2.0, REGIONAL: 4.4, INTERCONTINENTAL: 9.0 },
        transitDays: { DOMESTIC: 1, REGIONAL: 2, INTERCONTINENTAL: 3 }, minChargeUsd: 24,
      },
      {
        code: 'SIM-FDX-STD', name: 'Standard', level: 'STANDARD', shipmentTypes: PARCEL,
        maxWeightPerPackageKg: 68, maxTotalWeightKg: 1000, maxLengthCm: 274, specialHandling: ['FRAGILE', 'OVERSIZED'],
        divisor: 5000, roundingKg: 0.5,
        base: { DOMESTIC: 11, REGIONAL: 24, INTERCONTINENTAL: 41 }, perKg: { DOMESTIC: 1.5, REGIONAL: 3.3, INTERCONTINENTAL: 6.6 },
        transitDays: { DOMESTIC: 2, REGIONAL: 4, INTERCONTINENTAL: 5 }, minChargeUsd: 15,
      },
    ],
  },
  {
    code: 'UPS',
    name: 'UPS',
    priceFactor: 1.0,
    supportsCancellation: true,
    services: [
      {
        code: 'SIM-UPS-EXP', name: 'Worldwide Express', level: 'EXPRESS', shipmentTypes: PARCEL,
        maxWeightPerPackageKg: 70, maxTotalWeightKg: 1000, maxLengthCm: 274, specialHandling: ['FRAGILE', 'DANGEROUS_GOODS'],
        divisor: 5000, roundingKg: 0.5,
        base: { DOMESTIC: 16, REGIONAL: 33, INTERCONTINENTAL: 56 }, perKg: { DOMESTIC: 1.9, REGIONAL: 4.5, INTERCONTINENTAL: 9.2 },
        transitDays: { DOMESTIC: 1, REGIONAL: 2, INTERCONTINENTAL: 3 }, minChargeUsd: 23,
      },
      {
        code: 'SIM-UPS-STD', name: 'Standard', level: 'STANDARD', shipmentTypes: PARCEL,
        maxWeightPerPackageKg: 70, maxTotalWeightKg: 1000, maxLengthCm: 274, specialHandling: ['FRAGILE'],
        divisor: 5000, roundingKg: 0.5,
        base: { DOMESTIC: 10, REGIONAL: 22, INTERCONTINENTAL: 39 }, perKg: { DOMESTIC: 1.4, REGIONAL: 3.1, INTERCONTINENTAL: 6.3 },
        transitDays: { DOMESTIC: 2, REGIONAL: 4, INTERCONTINENTAL: 6 }, minChargeUsd: 14,
      },
    ],
  },
  {
    code: 'DSV',
    name: 'DSV',
    priceFactor: 0.97,
    supportsCancellation: true,
    services: [
      {
        code: 'SIM-DSV-AIR', name: 'Air Freight', level: 'EXPRESS', shipmentTypes: FREIGHT,
        maxWeightPerPackageKg: 1500, maxTotalWeightKg: 20000, maxLengthCm: 300, specialHandling: ['FRAGILE', 'DANGEROUS_GOODS', 'TEMPERATURE_CONTROLLED', 'OVERSIZED'],
        divisor: 6000, roundingKg: 1,
        base: { DOMESTIC: 95, REGIONAL: 160, INTERCONTINENTAL: 240 }, perKg: { DOMESTIC: 1.1, REGIONAL: 2.4, INTERCONTINENTAL: 4.1 },
        transitDays: { DOMESTIC: 2, REGIONAL: 3, INTERCONTINENTAL: 5 }, minChargeUsd: 120,
      },
      {
        code: 'SIM-DSV-ROAD', name: 'Road Groupage', level: 'STANDARD', shipmentTypes: FREIGHT,
        maxWeightPerPackageKg: 1200, maxTotalWeightKg: 24000, maxLengthCm: 400, specialHandling: ['FRAGILE', 'DANGEROUS_GOODS', 'OVERSIZED', 'LIFTGATE'],
        divisor: 3000, roundingKg: 1,
        base: { DOMESTIC: 70, REGIONAL: 120, INTERCONTINENTAL: 210 }, perKg: { DOMESTIC: 0.32, REGIONAL: 0.55, INTERCONTINENTAL: 1.4 },
        transitDays: { DOMESTIC: 3, REGIONAL: 6, INTERCONTINENTAL: 14 }, minChargeUsd: 85,
      },
      {
        code: 'SIM-DSV-SEA', name: 'Sea LCL', level: 'ECONOMY', shipmentTypes: ['PALLET', 'FREIGHT'],
        maxWeightPerPackageKg: 2000, maxTotalWeightKg: 26000, maxLengthCm: 1200, specialHandling: ['DANGEROUS_GOODS', 'OVERSIZED'],
        divisor: 1000, roundingKg: 1,
        base: { DOMESTIC: 180, REGIONAL: 260, INTERCONTINENTAL: 380 }, perKg: { DOMESTIC: 0.12, REGIONAL: 0.18, INTERCONTINENTAL: 0.26 },
        transitDays: { DOMESTIC: 8, REGIONAL: 14, INTERCONTINENTAL: 30 }, minChargeUsd: 250,
      },
    ],
  },
  {
    code: 'KUEHNE_NAGEL',
    name: 'Kuehne+Nagel',
    priceFactor: 1.0,
    supportsCancellation: true,
    services: [
      {
        code: 'SIM-KN-AIR', name: 'Air Priority', level: 'EXPRESS', shipmentTypes: FREIGHT,
        maxWeightPerPackageKg: 1500, maxTotalWeightKg: 20000, maxLengthCm: 300, specialHandling: ['FRAGILE', 'DANGEROUS_GOODS', 'TEMPERATURE_CONTROLLED'],
        divisor: 6000, roundingKg: 1,
        base: { DOMESTIC: 105, REGIONAL: 170, INTERCONTINENTAL: 260 }, perKg: { DOMESTIC: 1.2, REGIONAL: 2.5, INTERCONTINENTAL: 4.3 },
        transitDays: { DOMESTIC: 2, REGIONAL: 3, INTERCONTINENTAL: 4 }, minChargeUsd: 130,
      },
      {
        code: 'SIM-KN-ROAD', name: 'Road Standard', level: 'STANDARD', shipmentTypes: FREIGHT,
        maxWeightPerPackageKg: 1200, maxTotalWeightKg: 24000, maxLengthCm: 400, specialHandling: ['FRAGILE', 'TEMPERATURE_CONTROLLED', 'LIFTGATE'],
        divisor: 3000, roundingKg: 1,
        base: { DOMESTIC: 78, REGIONAL: 130, INTERCONTINENTAL: 225 }, perKg: { DOMESTIC: 0.34, REGIONAL: 0.58, INTERCONTINENTAL: 1.5 },
        transitDays: { DOMESTIC: 3, REGIONAL: 5, INTERCONTINENTAL: 12 }, minChargeUsd: 90,
      },
      {
        code: 'SIM-KN-SEA', name: 'Sea Consolidation', level: 'ECONOMY', shipmentTypes: ['PALLET', 'FREIGHT'],
        maxWeightPerPackageKg: 2000, maxTotalWeightKg: 26000, maxLengthCm: 1200, specialHandling: ['DANGEROUS_GOODS', 'TEMPERATURE_CONTROLLED', 'OVERSIZED'],
        divisor: 1000, roundingKg: 1,
        base: { DOMESTIC: 190, REGIONAL: 270, INTERCONTINENTAL: 360 }, perKg: { DOMESTIC: 0.13, REGIONAL: 0.19, INTERCONTINENTAL: 0.25 },
        transitDays: { DOMESTIC: 7, REGIONAL: 13, INTERCONTINENTAL: 28 }, minChargeUsd: 260,
      },
    ],
  },
  {
    code: 'CEVA',
    name: 'CEVA Logistics',
    priceFactor: 0.95,
    supportsCancellation: false,
    services: [
      {
        code: 'SIM-CEVA-AIR', name: 'Air Standard', level: 'EXPRESS', shipmentTypes: FREIGHT,
        maxWeightPerPackageKg: 1000, maxTotalWeightKg: 15000, maxLengthCm: 300, specialHandling: ['FRAGILE', 'TEMPERATURE_CONTROLLED'],
        divisor: 6000, roundingKg: 1,
        base: { DOMESTIC: 90, REGIONAL: 150, INTERCONTINENTAL: 230 }, perKg: { DOMESTIC: 1.15, REGIONAL: 2.3, INTERCONTINENTAL: 4.0 },
        transitDays: { DOMESTIC: 2, REGIONAL: 4, INTERCONTINENTAL: 6 }, minChargeUsd: 110,
      },
      {
        code: 'SIM-CEVA-GND', name: 'Ground Freight', level: 'STANDARD', shipmentTypes: FREIGHT,
        maxWeightPerPackageKg: 1200, maxTotalWeightKg: 24000, maxLengthCm: 400, specialHandling: ['FRAGILE', 'OVERSIZED', 'LIFTGATE'],
        divisor: 3000, roundingKg: 1,
        base: { DOMESTIC: 65, REGIONAL: 115, INTERCONTINENTAL: 200 }, perKg: { DOMESTIC: 0.3, REGIONAL: 0.52, INTERCONTINENTAL: 1.35 },
        transitDays: { DOMESTIC: 4, REGIONAL: 7, INTERCONTINENTAL: 16 }, minChargeUsd: 80,
      },
    ],
  },
];

/** Illustrative multipliers used ONLY to express simulated prices in the requested currency. */
export const SIM_CURRENCY_FACTORS: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, INR: 83, CNY: 7.2, JPY: 150, AED: 3.67, SGD: 1.35, AUD: 1.52, CAD: 1.36,
};

export const SURCHARGES_USD: Record<SpecialHandling, number> = {
  DANGEROUS_GOODS: 95,
  TEMPERATURE_CONTROLLED: 150,
  FRAGILE: 20,
  OVERSIZED: 80,
  LIFTGATE: 55,
};

export const FUEL_SURCHARGE_RATE = 0.14;
/** Insurance premium as a fraction of declared cargo value (simulated). */
export const INSURANCE_RATE = 0.006;
export const INSURANCE_MIN_USD = 15;
