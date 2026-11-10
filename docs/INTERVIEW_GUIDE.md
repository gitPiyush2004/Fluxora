# Fluxora interview guide

How to explain Fluxora to a company: the problem, what was built, the decisions behind it, and the
questions an interviewer is likely to ask. Everything here matches the code; file paths are given so
you can open the proof while you talk.

**Live:** https://fluxora-yeyl.onrender.com (the first load can take about 50 seconds while the free
server wakes up; open it before the interview starts). Works on a phone as well as a laptop.

---

## 1. The pitch, at three lengths

**One sentence.** Fluxora is a web app where a small importer or exporter raises a purchase order,
compares carriers, books and tracks the shipment, and is warned about delays, all on one record.

**30 seconds.** A garment exporter deals with dozens of suppliers, half a dozen carriers and buyer
deadlines across email, carrier websites and spreadsheets. Nothing links the order to the shipment
that carries it, so nobody notices a late shipment until the customer complains. Fluxora keeps the
purchase order, the carrier comparison, the booking, the tracking and the alerts on one record, and
then reports what freight really cost and which carriers delivered on time.

**2 minutes.** Add these four points to the 30-second version:

1. **Comparison you can trust.** One form prices a lane across six carriers at once. Offers that
   miss the deadline, the budget or the cargo limits are set aside with the reason; the rest are
   scored on cost, speed and the company's own on-time history, and every score is explained.
2. **Problems surface on their own.** Rules watch for missed delivery dates, shipments stuck in one
   status, carrier-reported delays and tracking that goes quiet. Each alert says what to do next and
   clears itself when the problem does.
3. **Built like a real product.** Google sign-in, separate workspaces per company with admin and
   member roles, live updates over WebSockets, 108 server tests, 25 client tests and 7 browser tests,
   CI on every push, deployed on Render with MongoDB Atlas.
4. **Honest about its data.** Carrier rate APIs need business contracts, so prices come from a
   simulator and every one of them carries a "Sample" tag. Nothing generated is shown as a carrier quote.

---

## 2. The problem

**Who has it.** Small and mid-sized companies that buy from suppliers abroad and ship goods
themselves: garment exporters, retailers importing stock, small manufacturers. They are too small
for an enterprise ERP or a transport management system, so the work lives in email and spreadsheets.

**What goes wrong.**

| Pain | What it looks like day to day |
| --- | --- |
| The order and the shipment are not connected | The purchase order is in a spreadsheet, the booking is in an email, the tracking is on the carrier's website. Answering "where is PO 12?" means checking three places. |
| Choosing a carrier is slow and inconsistent | Someone opens each carrier's website, types the same shipment in again, and picks by habit. Nobody can say afterwards why that carrier was chosen. |
| Delays are found late | A shipment sits in customs for a week and the first person to notice is the customer. |
| No numbers | Nobody knows what was spent on freight last quarter or which carrier is actually on time. |

**What Fluxora does about each.**

| Pain | Fluxora's answer | Where to show it |
| --- | --- | --- |
| Disconnected records | A shipment is created from the purchase order and stays linked both ways | Purchase order → "Create shipment" |
| Slow, inconsistent carrier choice | One comparison across six carriers, with eligibility rules and an explained score | Compare carriers |
| Late discovery of delays | Four alert rules run on every tracking event and on a schedule | Tracking & alerts |
| No numbers | Spend, on-time rate, transit time and carrier performance, each with the count it is based on | Analytics |

Say this plainly if asked: Fluxora is a portfolio project. It has no paying customers, and carrier
prices are sample data. What is real is the engineering: the workflow, the rules, the security model,
the tests and the deployment.

---

## 3. What was built

The story the landing page tells, which is also the best demo order:

**Order → Approve → Compare → Book → Track → Alerts → Receive**, then **Analytics**.

| Area | In one line |
| --- | --- |
| Purchase orders | Suppliers, products, orders with lines; Draft → Approved (admin only) → Ready to ship → Received |
| Carrier comparison | Parallel quotes, hard constraints, weighted ranking, explanations |
| Shipments | A fixed lifecycle the server enforces; booking that cannot happen twice |
| Tracking | Carrier events normalised into one timeline, pushed live to open browsers |
| Alerts | Four rules, de-duplicated, with a recommended next action; auto-resolve |
| Analytics | Per-currency spend, on-time rate, transit time, carrier table, hypothetical savings |
| Accounts | Google sign-in, organisations, admin and member roles, invites |
| Interface | 3D globe of shipment lanes, light and dark themes, phone layout, opening logo splash |

Stack: React 19, TypeScript, Vite, Tailwind CSS, TanStack Query on the client; Node.js, Express 5,
MongoDB (Mongoose), Socket.IO, Zod on the server. One API and one single-page app in one repository
(a "modular monolith"), about 16,700 lines of code and about 70 API endpoints.

---

## 4. How a request flows (the architecture answer)

1. The browser calls `/api/...` on the same origin as the page, so the session cookie is sent
   automatically and no cross-origin setup is needed.
2. Middleware runs in order: security headers, rate limit, session, CSRF check.
3. `requireAuth` loads the user and re-checks their membership of the organisation **on every
   request**. It produces `req.auth = { userId, organizationId, role }`.
4. The route validates the input with Zod and calls a service function.
5. The service reads and writes MongoDB through Mongoose models. Every query includes
   `organizationId` taken from `req.auth`, never from the request body.
6. After a write the server emits a Socket.IO event to that organisation's room. Open browsers
   refetch the affected lists.

Each server module has the same four files: `*.routes.ts`, `*.schemas.ts` (Zod), `*.service.ts` and
`*.model.ts`. Business rules with no database access live in pure files (`recommendation.ts`,
`eligibility.ts`, `exception-rules.ts`, `shipment.rules.ts`, `money.ts`), which is why they are easy
to unit-test.

---

## 5. Eight problems worth telling

Each one is a short story: the problem, what was decided, why, and where the code is.

### 5.1 Ranking offers when some data is missing

- **Problem.** The score uses cost, transit time and reliability. Reliability comes from the
  company's own delivered shipments, and a new company has none. Treating "unknown" as 0 punishes a
  carrier unfairly; treating it as 100 rewards it for having no history.
- **Decision.** A metric is used only if every offer in the group has it. Otherwise it is left out
  for that comparison and the remaining weights are scaled back up to 100%. The screen says which
  metric was excluded and why.
- **Also.** Hard constraints run first (deadline, budget, weight, size, special handling), prices in
  different currencies are never compared, and ties break in a fixed order so the same input always
  gives the same ranking.
- **Code.** `server/src/modules/quotes/recommendation.ts`, `server/src/modules/carriers/eligibility.ts`.

### 5.2 Booking must never happen twice

- **Problem.** A double-click, a retry after a timeout, or two people pressing "Book" at once could
  book the same shipment twice.
- **Decision.** The client sends an `Idempotency-Key` header. The server stores a booking record per
  key (a unique index rejects a second one), then takes a lock on the shipment with one atomic
  `findOneAndUpdate` that only succeeds while the shipment is still `QUOTED` and unlocked. A repeat of
  the same key replays the first result; a different request gets `409`.
- **Why not just disable the button?** The button guard exists (`client/src/lib/mutation.ts`), but a
  browser can never be the guarantee. The server check is.
- **Code.** `server/src/modules/shipments/shipment.service.ts`, `booking-record.model.ts`; sequence
  diagram in `docs/ARCHITECTURE.md`.

### 5.3 Keeping one company's data away from another

- **Problem.** Many companies share one database. A user must never read or change another
  company's records, even by guessing an id.
- **Decision.** Every organisation-owned document has `organizationId`. Services take it from the
  session and every lookup is `findOne({ _id, organizationId })`, so another tenant's id returns
  `404`, not `403` (it does not even confirm the record exists). Membership is re-checked on every
  request, so removing someone takes effect immediately. WebSocket connections use the same session
  and are placed in their organisation's room by the server; there is no "join room" message a
  client could abuse.
- **Proof.** `server/tests/integration/tenancy-alerts-analytics.test.ts` tries cross-tenant reads,
  writes and socket events and expects them to fail.

### 5.4 Money without rounding errors

- **Problem.** `0.1 + 0.2` is not `0.3` in JavaScript. Order totals built from floating-point
  numbers drift by a cent.
- **Decision.** Money is stored as whole numbers of the smallest unit (cents), quantities as
  thousandths. Totals are calculated on the server, rounding is explicit and tested, and amounts in
  different currencies are never added together or converted.
- **Code.** `server/src/utils/money.ts`, `server/tests/unit/money.test.ts`.

### 5.5 Six carriers behind one interface, and one of them is down

- **Problem.** Every carrier has a different API, login method and response shape, and any of them
  can be slow or offline.
- **Decision.** Each carrier is an adapter with the same interface (`getQuotes`, and optionally `bookShipment`,
  `getTracking` and `cancelBooking`).
  The quote service calls them in parallel, each with its own timeout (8 seconds by default). A
  carrier that fails is reported as failed and the others still return offers. Results are cached
  for 5 minutes, so repeating the same comparison does not call the carriers again.
- **Honesty rule.** Carriers without credentials are served by a simulator. Every quote and tracking
  event records its source (`LIVE_QUOTE`, `SANDBOX_QUOTE`, `SIMULATED`, ...) and the interface shows
  a "Sample" tag.
- **Code.** `server/src/integrations/carriers/` (one folder per carrier, `types.ts` for the
  interface), `server/src/modules/carriers/carrier.registry.ts`.

### 5.6 Alerts that do not repeat themselves

- **Problem.** The rules run on every tracking event and every five minutes. Without care the same
  late shipment would raise the same alert hundreds of times, or an alert a person resolved would
  come straight back.
- **Decision.** Each alert has a key that includes the occurrence (for example "stuck in In transit
  since this timestamp"). A partial unique index allows only one unresolved alert per key. A resolved
  occurrence is not raised again, a new occurrence is, and an alert whose condition has cleared is
  resolved automatically.
- **Code.** `server/src/modules/alerts/exception-rules.ts` (pure rules), `alert.service.ts`.

### 5.7 Live updates without stale screens

- **Problem.** When tracking changes, every open screen that shows that shipment should update
  without a page reload.
- **Decision.** The server emits a small event after the database write. The client does not patch
  its data from the event; it tells TanStack Query that the matching cache entries are out of date
  and they refetch. All cache keys come from one file, so the event and the screens always agree on
  what to refresh.
- **Code.** `client/src/providers/realtime.tsx`, `client/src/lib/query-keys.ts`,
  `server/src/sockets/`.

### 5.8 Making it work on a phone

- **Problem.** The app was built on a laptop. On a phone the dashboard was wider than the screen,
  the notifications menu ran off the left edge, table cells wrapped into unreadable stacks
  (`SHP-2026-` on one line, `000007` on the next), and iPhones zoomed the page whenever a field was
  tapped.
- **How it was found.** A script opened every page at 320, 375, 430 and 768 pixels wide and listed
  each element that crossed the edge of the screen. That turned "it looks off" into a list.
- **Root causes and fixes.**
  - CSS grid columns default to `auto`, which grows to fit the widest cell. One long line of text
    that is not allowed to wrap made the whole page wider. Fix: one rule in `index.css` makes a grid
    a single shrinkable column (`minmax(0, 1fr)`) until a `grid-cols-*` class says otherwise.
  - Tables: cells never wrap and the table scrolls inside its panel; on phones the route, supplier
    or SKU folds under the first column so the reference and the status fit on the first screen.
  - Menus are anchored to the header instead of their button on phones.
  - Inputs are 16px on phones, because iOS Safari zooms in on anything smaller.
  - The dashboard globe ignores touches on touch screens, so a swipe scrolls the page.
- **Kept fixed.** A browser test opens every main page at 375px and fails if anything is wider than
  the screen (`client/e2e/smoke.spec.ts`).
- **The opening splash.** The "F" logo on black is plain HTML and CSS in `client/index.html`, so it
  appears before any JavaScript has loaded. React fades it out once it knows whether the visitor is
  signed in, and never sooner than 1.1 seconds. It replaces the spinner a visitor would otherwise
  see first.

---

## 6. Trade-offs made on purpose

| Choice | Why | What it costs |
| --- | --- | --- |
| One deployable app, not microservices | One person, one product; modules already have clean boundaries and could be split later | Everything scales together |
| MongoDB | Orders with embedded lines, quote snapshots and carrier payloads are document-shaped; atomic single-document updates plus unique indexes cover the consistency the app needs | No multi-document transactions are used, so each operation is designed to be safe as one document update |
| Server sessions in a cookie, not JWTs in `localStorage` | Scripts cannot read an HttpOnly cookie, and a session can be revoked at once | Needs a session store and CSRF protection (both are in place) |
| Redis optional | Runs anywhere with just MongoDB; Redis adds a shared cache, shared rate limits and job queues when there is more than one server | Without Redis the app must run as a single instance |
| Simulator instead of pretending | Carrier contracts are not available to an individual; labelled sample data keeps the whole flow demonstrable | Prices are illustrative |
| Reads in hooks, writes in components | The component that triggers a write owns the toast, dialog and navigation that follow | Slightly longer components |

---

## 7. What is real and what is simulated

| Real | Simulated or limited |
| --- | --- |
| Sign-in, organisations, roles, invites | Carrier prices for all six carriers (tagged "Sample") |
| Purchase orders, shipments, alerts, analytics | Booking with a carrier (sample bookings, or recorded manually) |
| DSV tracking against DSV's test environment | DHL, FedEx and UPS adapters are written from the public documentation but have not been run with live credentials |
| Tests, CI, Docker, deployment | Kuehne+Nagel and CEVA need partner onboarding; they have no adapter |

Full detail: "Real APIs vs. simulation" and "Known limitations" in the README.

---

## 8. What would come next

1. Real booking and label APIs (DHL, FedEx, UPS) once business accounts exist.
2. Tracking by webhook instead of polling.
3. An exchange-rate source, so spend can be converted with the rate and date shown.
4. Email or Slack notifications for alerts.
5. Card layouts for the densest tables on phones, and an installable (PWA) version.

---

## 9. Numbers to remember

| | |
| --- | --- |
| Code | about 16,700 lines of TypeScript, CSS and HTML |
| API | about 70 endpoints in 13 server modules |
| Tests | 108 server, 25 client, 7 browser (one at phone width) |
| Carriers | 6: DHL, FedEx, UPS, DSV, Kuehne+Nagel, CEVA |
| Alert rules | 4 |
| Default score weights | cost 50, transit 30, reliability 20 |
| Deployment | Render (Singapore) and MongoDB Atlas; deploys only after CI passes |

---

## 10. Questions you will be asked

**What was the hardest part?**
Pick one story from section 5 and tell it start to finish. 5.1 (ranking with missing data) and 5.2
(double booking) are the strongest because each has a wrong answer that looks right.

**Why MongoDB and not PostgreSQL?**
The records are document-shaped and there are no multi-row transactions to protect: an order embeds
its lines, a comparison stores a snapshot of its offers. Consistency comes from atomic updates on one
document and unique indexes. With heavy cross-record reporting or multi-step financial transactions,
PostgreSQL would be the better choice.

**How would it scale?**
The API keeps no state in memory that matters once Redis is switched on (sessions are in MongoDB;
cache, rate limits and jobs move to Redis), so more instances can run behind a load balancer.
Socket.IO then needs its Redis adapter so events reach users on other instances. Indexes on
organisation-owned collections start with `organizationId`, so each query stays inside one tenant's data.

**How do you know it works?**
Pure rules have unit tests. The API has integration tests against an in-memory MongoDB, including
attempts to cross tenants and to book twice. Browser tests run the main flows end to end, one of them
at phone width. CI runs type checks, lint and tests on every push, and the site deploys only when
they pass.

**What happens when a carrier API is slow or down?**
Each carrier has its own timeout. A failed carrier is listed as failed and the others still return
offers.

**How is it secured?**
Google ID tokens are verified on the server. The session is an HttpOnly cookie. Every state-changing
request needs a CSRF token. Input is validated with Zod and keys containing `$` or `.` are dropped,
which blocks MongoDB operator injection. Rate limits are stricter on sign-in and on quote requests.
Role checks happen in the API, not just in the interface.

**Why are the prices not real?**
Carrier rate APIs are only available to businesses with an account. The adapters are written and the
simulator stands in, with every sample price labelled.

**What would you do differently?**
Start with the phone layout instead of adding it at the end (section 5.8 is what that cost), and
agree the table design for small screens before building eight tables.

**Why the 17,000-line limit?**
To keep the project small enough that every part of it can be explained. It forced simple, standard
patterns over clever ones.

---

## 11. Showing it

- **5 minutes:** the Zara (Demo) walkthrough at the top of `docs/DEMO_GUIDE.md`.
- **20 minutes:** the Shahi Exports (Demo) deep dive in the same file.
- **On a phone:** open the live link, wait for the logo to fade, tap **Try the demo**, open the menu
  (top left), and show Shipments and one shipment's Tracking timeline.
