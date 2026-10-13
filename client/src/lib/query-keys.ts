/**
 * Every TanStack Query cache key in one place.
 *
 * Keys are arrays; invalidating a prefix refreshes everything under it. For example
 * `invalidateQueries({ queryKey: keys.alerts.all })` refreshes the alert list, the
 * notification menu and the alert summary at once.
 */
export const keys = {
  auth: {
    session: ['auth', 'session'] as const,
    config: ['auth', 'config'] as const,
  },

  shipments: {
    all: ['shipments'] as const,
    list: (params: object) => ['shipments', 'list', params] as const,
    inFlight: ['shipments', 'in-flight'] as const,
    map: ['shipments', 'map'] as const,
  },
  shipment: (id: string | undefined) => ['shipment', id] as const,
  shipmentEvents: (id: string | undefined) => ['shipment-events', id] as const,
  shipmentQuotes: (id: string | undefined) => ['shipment-quotes', id] as const,

  quoteRequest: (id: string | null) => ['quote-request', id] as const,
  billableWeight: (input: object) => ['billable-weight', input] as const,
  carriers: ['carriers'] as const,

  purchaseOrders: {
    all: ['purchase-orders'] as const,
    list: (params: object) => ['purchase-orders', 'list', params] as const,
  },
  purchaseOrder: (id: string | undefined) => ['purchase-order', id] as const,

  suppliers: {
    all: ['suppliers'] as const,
    list: (params: object) => ['suppliers', 'list', params] as const,
    activeOptions: ['suppliers', 'active-options'] as const,
  },
  supplier: (id: string | undefined) => ['supplier', id] as const,

  products: {
    all: ['products'] as const,
    list: (params: object) => ['products', 'list', params] as const,
    activeOptions: ['products', 'active-options'] as const,
  },

  alerts: {
    all: ['alerts'] as const,
    list: (params: object) => ['alerts', 'list', params] as const,
    menu: ['alerts', 'menu'] as const,
    summary: ['alerts', 'summary'] as const,
  },
  eventFeed: ['event-feed'] as const,

  analytics: {
    all: ['analytics'] as const,
    report: (name: string, filters: object) => ['analytics', name, filters] as const,
    dashboard: ['analytics', 'dashboard'] as const,
  },

  members: ['members'] as const,
};
