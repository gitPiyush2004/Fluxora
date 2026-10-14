# Fluxora demo guide — Shahi Exports (Demo)

A 20-minute, end-to-end walkthrough of Fluxora on the live site, told as one company's day.
**Shahi Exports (Demo)** is an apparel manufacturer with factories in **Faridabad** and **Bengaluru**.
It buys fabric, yarn and trims from suppliers abroad and in India, and exports finished garments to
retailers in the US, UK and Germany. You play its logistics manager.

> Only the workspace name refers to a real company. Every supplier, buyer, person, address, order
> and price is invented and labelled *(fictional)* or **Demo data** in the app.

**Live site:** https://fluxora-yeyl.onrender.com

---

## 0. Before you start (5 minutes, once)

1. **Wake the server.** The free Render plan sleeps after ~15 minutes without visitors. Open the site
   2 minutes before a demo; the first load takes ~50 seconds.
2. **Load the sample company** on the live database (your Atlas password in place of `YOUR_PASSWORD`):
   ```
   MONGODB_URI='mongodb+srv://piyushb191_db_user:YOUR_PASSWORD@fluxora.xrauyiw.mongodb.net/fluxora?retryWrites=true&w=majority' npm run seed -- piyushb191@gmail.com
   ```
   It creates **Shahi Exports (Demo)** with eight months of history and makes you its admin. Your own
   workspace is not touched. Re-running resets the sample — do it before each demo for a fresh story
   (visitors' changes are wiped too; they rejoin the demo at their next sign-in).
3. **Optional:** a second Google account, to show that another company sees none of this data.

## 1. The 30-second pitch

> A garment exporter juggles dozens of suppliers, half a dozen carriers and buyer deadlines across
> email, carrier portals and spreadsheets. Fluxora puts it in one place: purchase orders for fabric
> and trims, carrier comparison with explainable scoring, tracking with automatic exception alerts,
> and analytics on what freight really costs — for inbound materials and outbound exports.

## 2. Sign up and sign in — *access & accounts*

1. Open the site → **Don't have an account? Sign up** → *Create your account* → **Sign up with Google**.
2. No separate registration: the account and a personal workspace are created automatically.
3. **Anyone can explore the demo.** Every person who signs in — an interviewer with their own Google
   account, for example — finds **Shahi Exports (Demo)** in their organisation list as a *Member*, and
   lands in it on their first visit. Send them the link; they don't need you to set anything up.
4. Point out: Google identity is verified on the server, the session is an HttpOnly cookie, and every
   change is CSRF-protected.

## 3. The operations overview — *dashboard*

1. **Global lanes** globe: inbound arcs from Shanghai, Ningbo, Dhaka, Istanbul, Milan, Ho Chi Minh
   City and Tirupur into **Faridabad** and **Bengaluru**, and outbound arcs to **Los Angeles,
   Hamburg and London**. Red arcs are delayed or in exception. Click one to open the shipment.
2. KPI tiles: shipments in planning, in transit, delayed/exception, on-time deliveries, freight spend,
   average transit. *"Link up"* means live updates are connected.

## 4. Buy — *purchase orders for fabric and trims*

1. **Suppliers**: the fabric mill in Shanghai, zipper maker in Ningbo, denim mill in Dhaka, label
   printer in Istanbul, button maker in Milan, thread supplier in Ho Chi Minh City and the yarn
   spinner in Tirupur. One inactive packaging supplier shows how suppliers are retired, not deleted.
2. **Products**: the materials catalogue — cotton jersey and denim (per metre), cotton yarn (per kg,
   priced in INR), zippers, buttons (per gross), woven labels, thread cones, poly bags.
3. **Purchase Orders**: the list covers every status. Open the **zipper order** (Draft, *"SS27
   collection — awaiting colour approvals"*) → **Approve order** → **Mark ready to ship**.
4. Point out: orders move only along allowed steps
   (Draft → Approved → Ready to ship → Partially received → Received); only admins approve; every
   change is in the audit history; the **yarn order** is in INR with 5% GST.

## 5. Ship — *carrier comparison for an inbound order*

1. Open the **cotton jersey fabric order** (Ready to ship, from Shanghai). Half of it is already
   moving — see *Linked shipments* — and that shipment is **Delayed**: DSV reported it missed the
   vessel cut-off. Click **Create shipment** for the remaining quantity, enter the weight,
   *Create shipment*. Origin comes from the supplier, destination is the Faridabad unit.
2. **Carrier offers**: six carriers are asked in parallel. Show **Cheapest**, **Fastest** and
   **Best balanced**, and the explanation under each ("costs $X more than Y but arrives 2 days sooner").
3. Move the **Cost / Transit time / Reliability** sliders and watch the ranking change. Reliability
   counts only for carriers with enough delivered shipments — the history makes it real for DSV and
   Kuehne+Nagel.
4. The purple **Simulated** labels: prices are demonstration data until the company has carrier
   contracts; Fluxora never presents them as real.
5. Select the best-balanced offer → **Book shipment** → *Create simulated booking*.

The **Compare Carriers** page does the same for any lane without a PO — e.g. price a Faridabad →
London sample shipment for a buyer before committing.

## 6. Export — *finished garments to buyers*

1. **Shipments** → search *Los Angeles*: the **knitted T-shirts export** (24,000 pcs, Bengaluru →
   Pacific Coast Apparel's LA warehouse, sea freight) is in **Exception** — *held by US customs,
   commercial invoice and HTS codes requested*. Open it: lifecycle stepper, carrier, cost, expected
   delivery, and the timeline showing who reported the hold.
2. Also show *Hamburg* (denim jeans, pallets) and *London* (express cartons of shirts) — the same
   tool covers inbound materials and outbound exports.

## 7. Track — *shipments in motion*

1. On the shipment you booked in step 5 → **Simulate next event** a few times: Booked → Picked up →
   In transit… Each timeline event shows its source (Simulated / Carrier API / Entered by user).
2. **Real carrier data:** Shipments → **Track a shipment** → carrier **DSV** (the form says
   *"test-environment tracking"*) → tracking number `40257145990010760574` → New York, US →
   Copenhagen, DK → **Start tracking**. Fluxora calls DSV's API and the shipment jumps to its real
   status with events labelled **Carrier test environment**.
   *It will raise alerts: DSV's test shipments are from 2019, so the rules correctly flag it as stuck.*
3. **Carriers without an API:** the delayed fabric shipment, the customs hold and the **denim
   shipment from Dhaka** (no update for weeks) are tracked by hand. On the customs hold, use
   **Record update** → *In transit* → "Released by customs" — the red arc and its alert clear.

## 8. Catch problems early — *exceptions & alerts*

1. **Tracking & alerts**: the queue shows a shipment **more than a month past its expected delivery**
   (Critical), the stuck denim shipment, the customs hold and the delay — each with a recommended
   next action.
2. **Acknowledge** one ("we're on it"), **Resolve** another with a note. Alerts also auto-resolve when
   the condition clears.
3. **Settings → Alert rules**: thresholds are per company (e.g. stuck in transit after 7 days).

## 9. Receive — *closing the loop*

1. Open the **cotton yarn order** from Tirupur (Partially received) → **Receive goods** → enter the
   rest of the outstanding quantity → *Record receipt*: status becomes **Received**.
2. Point out: you can't receive more than is outstanding, and one order can arrive in several shipments.

## 10. Learn from the data — *analytics*

1. **Analytics**: freight spend by month (switch between USD, EUR and INR), on-time rate and average
   transit per carrier, cost per kg, purchase orders by status, and *potential savings* from cheaper
   offers that weren't picked.
2. Point out: everything is computed from recorded data, and sample sizes are shown so small numbers
   aren't over-trusted.

## 11. Teams and safety — *multi-tenancy & roles*

1. **Settings → Members**: the team (Ananya Rao, Logistics Manager — admin; Vikram Singh, Procurement
   Executive — member). Invite a colleague's Google email; they join at their first sign-in.
2. Members do day-to-day work but **cannot approve purchase orders or change settings**.
3. Visitors share the demo as members, but each also gets a private workspace that nobody else can
   see — switch to it from the account menu to show that every query is scoped to the active company.
   In the demo, visitors see the fictional team and themselves, never each other's emails.
4. **Settings → Carrier integrations** shows honestly which carriers are live, test-environment or simulated.
5. Theme toggle (sun/moon icon): light, dark or system.

---

## What is real and what is simulated

| Area | Status |
| --- | --- |
| Sign-in, workspaces, roles, invites | Real (Google OAuth, production) |
| Purchase orders, suppliers, products, shipments, alerts, analytics | Real features; the Shahi sample data is fictional |
| DSV tracking | Real API, DSV's **test environment** (test shipments) |
| DHL tracking | Real API, switches on when DHL approves the key (`DHL_TRACKING_API_KEY` in Render) |
| Carrier prices (all six) | **Simulated**, clearly labelled — real prices need carrier contracts |
| FedEx / UPS / DHL Express rates | Connections built from their API docs; need business accounts to switch on |
| Booking with carriers | Simulated, or recorded manually after booking with the carrier |

## Requirement checklist

| Original goal | Where to show it |
| --- | --- |
| Carrier comparison | Shipment → Carrier offers; Compare Carriers (step 5) |
| Shipments | Inbound and export shipments, lifecycle stepper (steps 5–6) |
| Tracking & alerts | Timeline, Track a shipment, Tracking & alerts (steps 7–8) |
| Purchase order ERP | Suppliers, Products, Purchase Orders, receipts (steps 4, 9) |
| Analytics | Analytics page (step 10) |
| Google sign-in / sign-up | Sign-in page (step 2) |
| Multi-tenancy & security | Roles, second account (step 11) |
| Globe UI, light & dark themes | Dashboard (step 3), theme toggle (step 11) |
| Tests, Docker, docs, deployment | GitHub Actions on every push; `docker compose up`; README; live on Render |

## Likely interview questions

- **How does ranking work?** Hard constraints filter offers first (weight, size, handling, deadline);
  the rest are scored 0–100 on cost, speed and reliability with adjustable weights. Missing data
  (e.g. reliability with too few deliveries) is excluded and the weights re-normalised, never guessed.
- **How do you stop double bookings?** An `Idempotency-Key` header plus an atomic lock on the shipment;
  a repeated request replays the first result.
- **How is one company's data kept from another?** The session carries the active organisation; every
  database query filters by it, and membership is re-checked on every request.
- **Why are prices simulated?** Carrier rate APIs require customer accounts. The adapter layer is ready
  (DHL, FedEx, UPS); the simulator is labelled everywhere so nothing fake is presented as real.
- **What happens when a carrier API is slow or down?** Each carrier has its own timeout; one failing
  carrier is reported and the others still return offers.
