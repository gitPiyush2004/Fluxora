# API reference — `/api/v1`

**Conventions**

* JSON everywhere. Success: `{ "data": ..., "meta"?: ... }`. Lists return `meta: { page, pageSize, total, totalPages }`.
* Errors: `{ "error": { "code", "message", "details"?, "requestId" } }` — codes: `BAD_REQUEST`, `VALIDATION_ERROR` (422, `details: [{path, message}]`), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `CSRF_INVALID` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INVALID_TRANSITION` (409), `RATE_LIMITED` (429), `PROVIDER_ERROR` (502), `NOT_SUPPORTED` (422), `SERVICE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500).
* **Auth**: HttpOnly session cookie `fluxora.sid`. **CSRF**: every non-GET request must send `X-CSRF-Token` (from `GET /auth/csrf`, or the `csrfToken` returned by sign-in / session endpoints).
* Pagination: `page` (≥1), `pageSize` (1–100). Sorting: `sortBy` (allowlisted per endpoint) + `sortDir=asc|desc`. Multi-value filters are comma-separated (`status=IN_TRANSIT,DELAYED`).
* All resources are scoped to the caller's active organisation; IDs from other organisations return 404.
* Amounts are integer minor units (`totalMinor: 12500` = 125.00). Dates are ISO-8601.

## Health

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness (`{status:"ok"}`) |
| GET | `/health/ready` | Readiness: MongoDB / Redis checks + carrier integration modes (503 when degraded) |

## Authentication & organisation

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/auth/config` | public | `{ googleClientId, devLoginEnabled, demoUsers[] }` |
| GET | `/auth/csrf` | public | `{ csrfToken }` for the current session |
| POST | `/auth/google` | public + CSRF | `{ credential }` (Google ID token). Verified server-side (signature, `iss`, `aud`, `exp`, verified email). Returns profile + new `csrfToken`; rotates the session id. |
| POST | `/auth/dev-login` | public + CSRF | `{ email }` of a seeded demo user. Only when `AUTH_DEV_LOGIN_ENABLED=true` (refused in production). |
| GET | `/auth/session` | public | Profile or `null` (never 401 — used at app start) |
| GET | `/auth/me` | user | Profile `{ user, organization (with settings), role, organizations[], csrfToken }` |
| POST | `/auth/switch-organization` | user | `{ organizationId }` — must be a member |
| POST | `/auth/logout` | any | Destroys the session, clears the cookie (204) |
| GET | `/organizations/current` | user | Organisation + settings |
| PATCH | `/organizations/current` | admin | `{ name?, settings? }` (partial deep-merge) |
| GET | `/organizations/current/carriers` | user | Carrier integration status |
| GET | `/organizations/current/members` | user | Members + pending invites |
| POST | `/organizations/current/invites` | admin | `{ email, role }` — existing users are added immediately; others join at first Google sign-in |
| DELETE | `/organizations/current/invites/:id` | admin | Revoke invite |
| PATCH | `/organizations/current/members/:userId` | admin | `{ role }` (cannot demote the last admin) |
| DELETE | `/organizations/current/members/:userId` | admin | Remove member (cannot remove the last admin) |

## Suppliers & products

| Method | Path | Description |
| --- | --- | --- |
| GET | `/suppliers` | `search`, `status=active\|inactive\|all`, `country`, `sortBy=name\|supplierRef\|country\|createdAt` |
| POST | `/suppliers` | Create (`supplierRef`, `name`, `email`, `country`, `city` required) |
| GET | `/suppliers/:id` | Supplier + recent purchase orders + activity |
| PATCH | `/suppliers/:id` | Partial update |
| PATCH | `/suppliers/:id/status` | `{ isActive }` (deactivate / activate) |
| GET | `/products` | `search`, `status`, `category`, `sortBy=name\|sku\|category\|defaultUnitCostMinor\|createdAt`; `meta.categories` |
| POST | `/products` | Create (`sku`, `name`, `unitOfMeasure`, `defaultUnitCostMinor`, `currency`) |
| GET | `/products/:id` · PATCH `/products/:id` · PATCH `/products/:id/status` | Read / update / (de)activate |

## Purchase orders

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/purchase-orders` | user | `search` (PO #, supplier, line text/SKU), `status`, `supplierId`, `from`, `to`, `sortBy=orderDate\|poNumber\|totalMinor\|expectedDeliveryDate\|status\|createdAt` |
| POST | `/purchase-orders` | user | `{ supplierId, orderDate, expectedDeliveryDate?, destination, currency, lines:[{productId?, description, quantity, unitOfMeasure?, unitPriceMinor}], taxRateBps, additionalChargesMinor, notes? }` — totals computed server-side; client totals ignored |
| GET | `/purchase-orders/:id` | user | Order + supplier + linked shipments + activity |
| PATCH | `/purchase-orders/:id` | user | Same body as create (+ optional `version`); DRAFT only |
| POST | `/purchase-orders/:id/approve` | **admin** | DRAFT → APPROVED (supplier must be active) |
| POST | `/purchase-orders/:id/ready-to-ship` | user | APPROVED → READY_TO_SHIP |
| POST | `/purchase-orders/:id/cancel` | **admin** | `{ reason? }` — blocked after any receipt or while linked shipments are active |
| POST | `/purchase-orders/:id/receive` | user | `{ lines:[{lineId, quantity}], note?, receivedAt? }` — quantities > 0 and ≤ outstanding; status → PARTIALLY_RECEIVED / RECEIVED |
| POST | `/purchase-orders/:id/shipments` | user | `{ spec:{shipmentType, packageCount, actualWeightKg, dims?, requiredDeliveryDate?, servicePreference?, …}, items:[{poLineId, quantity}] }` — READY_TO_SHIP / PARTIALLY_RECEIVED only; origin from supplier, destination from PO |

## Shipments

| Method | Path | Description |
| --- | --- | --- |
| GET | `/shipments` | `search`, `status`, `carrier`, `from`, `to` (created), `purchaseOrderId`, `sortBy=createdAt\|reference\|expectedDeliveryDate\|freightCostMinor\|status\|updatedAt` |
| GET | `/shipments/map` | Compact route list for the globe |
| POST | `/shipments` | `{ spec, contentsDescription?, notes?, items?, quoteId? }` — with `quoteId` (from `/quotes/compare`) the shipment is created from that comparison's stored spec and the offer is selected |
| GET | `/shipments/:id` | Shipment + linked PO + open alerts + event count |
| PATCH | `/shipments/:id` | `{ spec?, contentsDescription?, notes?, items? }` — spec only in DRAFT/QUOTED (clears a selected offer) |
| POST | `/shipments/:id/quotes` | Run a carrier comparison for this shipment (`{ weights?, carriers? }`) |
| GET | `/shipments/:id/quotes` | Latest comparison (or `null`) |
| POST | `/shipments/:id/quotes/rank` | `{ quoteRequestId, weights }` — deterministic re-ranking |
| POST | `/shipments/:id/select-quote` | `{ quoteId }` — must be eligible, unexpired, requested for this shipment after its last spec change |
| POST | `/shipments/:id/book` | **Header `Idempotency-Key` required.** `{ mode:"PROVIDER" }` or `{ mode:"MANUAL", bookingReference, trackingNumber?, expectedDeliveryDate? }`. 201 on success, 200 + `Idempotent-Replayed: true` on replay, 409 if already booked / in progress, 502 with provider message on failure (status unchanged). |
| POST | `/shipments/:id/cancel` | `{ reason? }` — DRAFT/QUOTED/BOOKED/EXCEPTION; booked shipments only if the provider/simulator supports cancellation (manual bookings: Fluxora-side only, with a warning) |
| GET | `/shipments/:id/events` | `order=asc\|desc`, pagination |
| POST | `/shipments/:id/events` | Manual update `{ status?, description, occurredAt?, city?, country? }` (valid transitions only) |
| POST | `/shipments/:id/refresh-tracking` | Pull tracking from the live API / simulator now |
| POST | `/shipments/:id/simulate-next` | Simulated tracking only: release the next scripted milestone now |

## Quotes / carrier comparison

| Method | Path | Description |
| --- | --- | --- |
| POST | `/quotes/compare` | `{ spec, weights?, carriers? }` → `{ quoteRequestId, request, weightEstimate, providers[], quotes[], recommendation, allSimulated }` |
| GET | `/quotes/requests/:id` | Re-open a comparison |
| POST | `/quotes/requests/:id/rank` | `{ weights }` → re-ranked response |
| POST | `/quotes/billable-weight` | `{ actualWeightKg, packageCount, lengthCm?, widthCm?, heightCm?, divisor? }` |
| GET | `/quotes/carriers` | Carrier integration status per capability |

`spec` = `{ origin:{city, country, postalCode?, name?, address?}, destination:{…}, shipmentType: PARCEL|BOX|PALLET|FREIGHT, packageCount, actualWeightKg, lengthCm?, widthCm?, heightCm?, requiredDeliveryDate?, servicePreference?: ECONOMY|STANDARD|EXPRESS, cargoValueMinor?, cargoCurrency?, insuranceRequired, specialHandling[], maxBudgetMinor?, currency }`

Each quote: `{ id, carrierCode, carrierName, serviceName, serviceLevel, currency, totalMinor, breakdown[], transitDays, estimatedDeliveryDate, provenance:{sourceType, provider, retrievedAt, isSimulated, validUntil, limitations[], fromCache}, eligibility:{eligible, reasons[]}, reliability:{onTimeRate?, sampleSize, minSamples}, isExpired }`.

## Alerts & tracking feed

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/alerts` | user | `status=UNRESOLVED\|OPEN\|ACKNOWLEDGED\|RESOLVED\|ALL`, `severity`, `type`, `shipmentId` |
| GET | `/alerts/summary` | user | Counts by status / severity |
| GET | `/alerts/feed/events` | user | Latest tracking events across the organisation (`limit`) |
| POST | `/alerts/:id/acknowledge` | user | OPEN → ACKNOWLEDGED |
| POST | `/alerts/:id/resolve` | user | `{ note? }` → RESOLVED |
| POST | `/alerts/scan` | admin | Run the exception scan now |

## Analytics

All accept `from`, `to` (default: last 365 days), `carrier`, `status` (shipment statuses), `poStatus`.

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/analytics/overview` | Shipment counts by status, freight spend per currency, average transit (with `eligibleCount`), on-time rate (with denominator), unresolved alerts, data provenance counts |
| GET | `/analytics/freight` | Monthly spend per currency; spend, shipments, billable kg and avg cost/kg per carrier & currency |
| GET | `/analytics/carriers` | Booked / delivered / cancelled, on-time rate (n), avg transit (n), shipments with exceptions |
| GET | `/analytics/purchase-orders` | Count and totals per status & currency, open commitments |
| GET | `/analytics/savings` | Hypothetical savings vs. cheapest eligible alternative (per currency) |
| GET | `/analytics/dashboard` | Recent shipments, upcoming deliveries, active alerts, recent POs |

## Socket.IO (`/socket.io`)

Authenticated with the session cookie; the server joins the socket to its organisation room. Events (emitted only after the database write succeeds):

| Event | Payload |
| --- | --- |
| `shipment:updated` | `{ id, reference, status, statusChangedAt, lastKnownLocation? }` |
| `shipment:event` | `{ shipmentId, reference, event }` |
| `alert:created` / `alert:updated` | Alert document |
| `purchase-order:updated` | `{ id, status }` |
