import type { ServiceLevel } from '../../../modules/shipments/shipment.rules.js';
import { CURRENCY_EXPONENT, SUPPORTED_CURRENCIES, type Currency } from '../../../utils/money.js';
import { carrierFetch } from '../http.js';
import { CarrierError, type NormalizedQuote, type ShipmentRequest } from '../types.js';

/**
 * DHL Express – MyDHL API rating (GET /rates).
 * Docs: https://developer.dhl.com/api-reference/dhl-express-mydhl-api
 * Requires a DHL Express customer account and MyDHL API credentials (HTTP Basic).
 *
 * STATUS: implemented from DHL's published API reference and covered by mocked tests;
 * NOT verified against live credentials in this repository.
 */
export const DHL_EXPRESS_PROVIDER = 'dhl-express-mydhl';

interface MyDhlProduct {
  productName?: string;
  productCode?: string;
  totalPrice?: { currencyType?: string; priceCurrency?: string; price?: number }[];
  deliveryCapabilities?: { estimatedDeliveryDateAndTime?: string; totalTransitDays?: number | string };
  weight?: { volumetric?: number; provided?: number };
}

export class DhlExpressRatesClient {
  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly accountNumber: string,
    private readonly baseUrl: string,
  ) {}

  get isSandbox(): boolean {
    return /\/test\/?$/.test(this.baseUrl);
  }

  async getQuotes(req: ShipmentRequest, signal: AbortSignal): Promise<NormalizedQuote[]> {
    const params = new URLSearchParams({
      accountNumber: this.accountNumber,
      originCountryCode: req.origin.country,
      originCityName: req.origin.city,
      destinationCountryCode: req.destination.country,
      destinationCityName: req.destination.city,
      weight: String(req.actualWeightKg),
      length: String(req.lengthCm ?? 1),
      width: String(req.widthCm ?? 1),
      height: String(req.heightCm ?? 1),
      plannedShippingDate: req.shipDate.toISOString().slice(0, 10),
      isCustomsDeclarable: String(req.origin.country !== req.destination.country),
      unitOfMeasurement: 'metric',
    });
    if (req.origin.postalCode) params.set('originPostalCode', req.origin.postalCode);
    if (req.destination.postalCode) params.set('destinationPostalCode', req.destination.postalCode);

    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    const body = await carrierFetch<{ products?: MyDhlProduct[] }>(
      'DHL',
      `${this.baseUrl.replace(/\/$/, '')}/rates?${params.toString()}`,
      { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
      signal,
    );
    if (!body?.products) throw new CarrierError('DHL', 'VALIDATION', 'DHL returned no products for this route');

    const retrievedAt = new Date().toISOString();
    const limitations = [
      'Rated by DHL as a single piece using the total weight and one set of dimensions.',
      ...(this.isSandbox ? ['DHL test environment — prices are not bookable offers.'] : []),
    ];
    return body.products.flatMap((p): NormalizedQuote[] => {
      const price = p.totalPrice?.find((t) => t.currencyType === 'BILLC') ?? p.totalPrice?.[0];
      const currency = price?.priceCurrency as Currency | undefined;
      if (!price?.price || !currency || !SUPPORTED_CURRENCIES.includes(currency)) return [];
      const transit = p.deliveryCapabilities?.totalTransitDays;
      const level: ServiceLevel = /economy/i.test(p.productName ?? '') ? 'ECONOMY' : 'EXPRESS';
      return [
        {
          carrierCode: 'DHL',
          carrierName: 'DHL Express',
          serviceCode: p.productCode ?? 'UNKNOWN',
          serviceName: p.productName ?? 'DHL Express',
          serviceLevel: level,
          currency,
          totalMinor: Math.round(price.price * 10 ** CURRENCY_EXPONENT[currency]),
          breakdown: [],
          transitDays: transit != null ? Number(transit) : null,
          estimatedDeliveryDate: p.deliveryCapabilities?.estimatedDeliveryDateAndTime
            ? new Date(p.deliveryCapabilities.estimatedDeliveryDateAndTime).toISOString()
            : null,
          volumetricWeightKg: p.weight?.volumetric ?? null,
          provenance: {
            sourceType: this.isSandbox ? 'SANDBOX_QUOTE' : 'LIVE_QUOTE',
            provider: DHL_EXPRESS_PROVIDER,
            retrievedAt,
            isSimulated: false,
            limitations,
          },
        },
      ];
    });
  }
}
