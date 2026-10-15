import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowRight, Check, CheckCircle2, ClipboardList, GitCompareArrows, PackageCheck, Ticket, TriangleAlert, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { coordsFor } from '@/lib/geo';
import { useMutation } from '@/lib/mutation';
import { useAuth } from '@/providers/auth';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogoMark } from '@/components/layout/logo';
import { webglAvailable, type GlobeRoute } from '@/components/globe/globe-utils';

const OpsGlobe = lazy(() => import('@/components/globe/ops-globe'));

// Decorative apparel-trade lanes for the hero globe (no customer data before sign-in).
const LANES: GlobeRoute[] = [
  ['Dhaka', 'BD', 'Zaragoza', 'ES'], ['Istanbul', 'TR', 'Zaragoza', 'ES'], ['Faridabad', 'IN', 'Hamburg', 'DE'],
  ['Bengaluru', 'IN', 'London', 'GB'], ['Shanghai', 'CN', 'Rotterdam', 'NL'],
].map(([a, ac, b, bc], i): GlobeRoute => ({
  id: `lane-${i}`, label: `${a} → ${b}`, status: i === 0 ? 'DELAYED' : 'IN_TRANSIT',
  from: { ...coordsFor(a, ac!), name: a! }, to: { ...coordsFor(b, bc!), name: b! },
}));

/** Fades and lifts its content in once `on` turns true; `i` staggers siblings. */
function Reveal({ on, i = 0, className, children }: { on: boolean; i?: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn('transition-[opacity,translate] duration-500 ease-out', on ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0', className)} style={{ transitionDelay: on ? `${i * 90}ms` : '0ms' }}>
      {children}
    </div>
  );
}

/** A window of the app, as each chapter shows it. */
function Mock({ title, tag, children }: { title: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-float">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <span className="text-sm font-semibold">{title}</span>
        {tag}
      </div>
      <div className="p-4 text-sm">{children}</div>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0"><span className="text-muted">{label}</span><span className="text-right">{children}</span></div>
);

function OrderMock({ on }: { on: boolean }) {
  return (
    <Mock title="PO-2026-00002" tag={<Badge>Draft</Badge>}>
      <Reveal on={on}><Row label="Supplier">Dhaka Knit Garments Ltd</Row></Reveal>
      <Reveal on={on} i={1}><Row label="Deliver to">Distribution Centre, Zaragoza</Row></Reveal>
      <Reveal on={on} i={2} className="mt-3 rounded-lg bg-surface-2 p-3">
        <div className="flex justify-between gap-3"><span className="font-medium">Basic Cotton T-Shirt</span><span className="tabular">€19,200.00</span></div>
        <div className="mt-0.5 text-xs text-muted"><span className="font-mono">ZD-TEE-BSC</span> · 6,000 EA × €3.20</div>
      </Reveal>
      <Reveal on={on} i={3} className="mt-3 flex justify-between text-base font-semibold"><span>Total</span><span className="tabular">€19,200.00</span></Reveal>
    </Mock>
  );
}

function ApproveMock({ on }: { on: boolean }) {
  const steps = ['Draft', 'Approved', 'Ready to ship'];
  const log = ['Pablo Ruiz (Buyer) raised the order', 'Lucia Fernandez (Logistics Lead) approved it', 'The supplier marked it ready to ship'];
  return (
    <Mock title="PO-2026-00002" tag={<Badge tone={on ? 'info' : 'neutral'}>{on ? 'Ready to ship' : 'Draft'}</Badge>}>
      <div className="flex items-center">
        {steps.map((s, i) => (
          <div key={s} className={cn('flex items-center gap-2', i > 0 && 'flex-1')}>
            {i > 0 && <span className={cn('mx-2 h-px min-w-3 flex-1 transition-colors duration-500', on ? 'bg-accent' : 'bg-line')} style={{ transitionDelay: `${i * 300}ms` }} />}
            <span className={cn('grid h-6 w-6 place-items-center rounded-full border transition-colors duration-500', on ? 'border-accent bg-accent text-accent-fg' : 'border-line text-subtle')} style={{ transitionDelay: `${i * 300}ms` }}><Check className="h-3.5 w-3.5" /></span>
            <span className="text-xs whitespace-nowrap">{s}</span>
          </div>
        ))}
      </div>
      <ul className="mt-5 space-y-2.5">
        {log.map((l, i) => (
          <Reveal key={l} on={on} i={i * 3}><li className="flex items-center gap-2 text-[13px]"><CheckCircle2 className="h-4 w-4 text-success" />{l}</li></Reveal>
        ))}
      </ul>
    </Mock>
  );
}

const QUOTES = [
  { carrier: 'DSV', service: 'Sea LCL', cost: 1946, days: 34, best: true },
  { carrier: 'Kuehne+Nagel', service: 'Sea consolidation', cost: 2042, days: 31 },
  { carrier: 'CEVA', service: 'Sea LCL', cost: 2210, days: 33 },
  { carrier: 'DHL', service: 'Air freight', cost: 6480, days: 6 },
  { carrier: 'FedEx', service: 'International Priority', cost: 6920, days: 5 },
  { carrier: 'UPS', service: 'Worldwide Express', cost: 7150, days: 5 },
];

function QuotesMock({ on }: { on: boolean }) {
  return (
    <Mock title="Dhaka → Zaragoza · 6 offers" tag={<Badge>Sample rates</Badge>}>
      <ul className="space-y-1">
        {QUOTES.map((q, i) => (
          <li key={q.carrier} className={cn('grid grid-cols-[minmax(0,1fr)_40px_64px_32px] items-center gap-3 rounded-lg px-2 py-2 sm:grid-cols-[minmax(0,1fr)_88px_72px_40px]', q.best && on && 'bg-accent-soft')}>
            <span className="min-w-0 truncate"><span className="font-medium">{q.carrier}</span> <span className="hidden text-xs text-muted sm:inline">{q.service}</span></span>
            <span className="h-1.5 rounded-full bg-surface-3"><span className="block h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: on ? `${(q.cost / 7150) * 100}%` : '0%', transitionDelay: `${i * 90}ms` }} /></span>
            <span className="text-right tabular">€{q.cost.toLocaleString('en-US')}</span>
            <span className="text-right text-xs text-muted tabular">{q.days} d</span>
          </li>
        ))}
      </ul>
      <Reveal on={on} i={7} className="mt-3 flex items-center gap-2 text-[13px]"><Badge tone="accent">Best balanced</Badge>DSV meets the date at the lowest cost.</Reveal>
    </Mock>
  );
}

function BookMock({ on }: { on: boolean }) {
  return (
    <Mock title="SHP-2026-000008" tag={on ? <Badge tone="success" dot>Booked</Badge> : <Badge>Planned</Badge>}>
      {[['Carrier', 'DSV · Sea LCL'], ['Booking reference', 'DSV-BK-418265'], ['Tracking number', '4087 2213 5901'], ['Expected delivery', 'Nov 12, 2026'], ['Purchase order', 'PO-2026-00002']].map(([k, v], i) => (
        <Reveal key={k} on={on} i={i}><Row label={k!}><span className={i > 0 && i < 3 ? 'font-mono text-[13px]' : undefined}>{v}</span></Row></Reveal>
      ))}
      <p className="mt-3 text-xs text-subtle">Sample booking: the demo doesn’t contact the carrier.</p>
    </Mock>
  );
}

function TrackMock({ on }: { on: boolean }) {
  const events = [['Picked up', 'Dhaka · Oct 9'], ['Departed port', 'Chattogram · Oct 12'], ['Transshipped', 'Colombo · Oct 19'], ['In transit', 'Suez Canal · Oct 28']];
  return (
    <Mock title="SHP-2026-000008" tag={<Badge tone="accent" dot>In transit</Badge>}>
      <svg viewBox="0 0 400 60" className="mb-4 w-full" aria-hidden>
        <path d="M10 45 C 120 5, 280 5, 390 45" fill="none" stroke="var(--line-strong)" strokeWidth="2" strokeDasharray="4 5" />
        <path d="M10 45 C 120 5, 280 5, 390 45" fill="none" stroke="var(--accent)" strokeWidth="2.5" pathLength={100} strokeDasharray="100" strokeDashoffset={on ? 30 : 100} className="transition-[stroke-dashoffset] duration-[1600ms] ease-out" />
        <circle cx="10" cy="45" r="4" fill="var(--accent)" /><circle cx="390" cy="45" r="4" fill="var(--fg-subtle)" />
        <text x="10" y="58" fontSize="10" fill="var(--fg-muted)">Dhaka</text><text x="390" y="58" fontSize="10" textAnchor="end" fill="var(--fg-muted)">Zaragoza</text>
      </svg>
      <ol className="space-y-3 border-l border-line pl-4">
        {events.map(([e, where], i) => (
          <Reveal key={e} on={on} i={i + 2}><li className="relative"><span className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full bg-accent" /><div className="font-medium">{e}</div><div className="text-xs text-muted">{where}</div></li></Reveal>
        ))}
      </ol>
    </Mock>
  );
}

function DelayMock({ on }: { on: boolean }) {
  return (
    <Mock title="SHP-2026-000008" tag={on ? <Badge tone="danger" dot>Delayed</Badge> : <Badge tone="accent" dot>In transit</Badge>}>
      <Reveal on={on} className="rounded-lg border border-danger/30 bg-danger-soft p-4">
        <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 font-medium"><TriangleAlert className="h-4 w-4 text-danger" />Carrier exception</span><Badge tone="warning">Medium</Badge></div>
        <p className="mt-1 text-[13px] text-muted">Carrier reported a delay at Colombo.</p>
        <p className="mt-2 text-[13px]">Next action: confirm the revised delivery estimate with the carrier and notify the consignee.</p>
      </Reveal>
      <Reveal on={on} i={3}><Row label="Expected delivery"><span className="mr-2 text-subtle line-through">Nov 12</span><span className="font-medium text-danger">Nov 16, 2026</span></Row></Reveal>
    </Mock>
  );
}

function ReceiveMock({ on }: { on: boolean }) {
  return (
    <Mock title="PO-2026-00002 · Goods received" tag={<Badge tone="success" dot>Received</Badge>}>
      <Reveal on={on}><Row label="Basic Cotton T-Shirt"><span className="tabular">6,000 of 6,000</span> <span className="ml-2 text-success">Complete</span></Row></Reveal>
      <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
        {[['Delivered', 'Nov 16'], ['Freight cost', '€1,946'], ['Transit time', '38 days']].map(([k, v], i) => (
          <Reveal key={k} on={on} i={i + 1} className="bg-surface px-2 py-3"><div className="text-lg font-semibold tabular">{v}</div><div className="text-xs text-muted">{k}</div></Reveal>
        ))}
      </div>
    </Mock>
  );
}

const CHAPTERS = [
  { id: 'order', step: 'Order', icon: ClipboardList, Mock: OrderMock, title: 'Start with the purchase order.', body: 'Raise a PO with your supplier: lines, quantities, prices and where the goods should land. Fluxora works out the totals, and every shipment that follows stays linked to it.' },
  { id: 'approve', step: 'Approve', icon: CheckCircle2, Mock: ApproveMock, title: 'Nothing moves until it’s approved.', body: 'A buyer drafts, an admin approves and the supplier marks it ready to ship. Every step is logged with who did it and when.' },
  { id: 'compare', step: 'Compare', icon: GitCompareArrows, Mock: QuotesMock, title: 'Compare carriers, ranked your way.', body: 'Price the lane across DHL, FedEx, UPS, DSV, Kuehne+Nagel and CEVA at once. Offers that miss your date or budget drop out; the rest are ranked on cost, speed and your own on-time history.' },
  { id: 'book', step: 'Book', icon: Ticket, Mock: BookMock, title: 'Book the offer you picked.', body: 'The chosen offer becomes a shipment with a booking reference and a tracking number, still tied to the purchase order it came from.' },
  { id: 'track', step: 'Track', icon: Truck, Mock: TrackMock, title: 'Know where it is without asking.', body: 'Carrier events land on the shipment as they happen: picked up, departed, transshipped, out for delivery. The overview’s globe shows every lane at once.' },
  { id: 'alerts', step: 'Alerts', icon: TriangleAlert, Mock: DelayMock, title: 'When something slips, you hear first.', body: 'Fluxora watches for missed dates, stuck statuses, carrier-reported delays and tracking that goes quiet. Each alert says what to do next, and clears itself once the problem does.' },
  { id: 'receive', step: 'Receive', icon: PackageCheck, Mock: ReceiveMock, title: 'Receive the goods. Close the loop.', body: 'Book in what arrived against each PO line, then see spend, on-time rate and transit times across every order.' },
];

/** Index of the chapter crossing the middle of the screen (-1 above the first), plus the furthest one reached. */
function useChapterProgress(count: number) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(-1);
  const [reached, setReached] = useState(-1);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const i = refs.current.indexOf(entry.target as HTMLElement);
          if (entry.isIntersecting) {
            setActive(i);
            setReached((r) => Math.max(r, i));
          } else if (i === 0 && entry.boundingClientRect.top > 0) setActive(-1); // scrolled back to the hero
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    refs.current.slice(0, count).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [count]);
  const setRef = (i: number) => (el: HTMLElement | null) => {
    refs.current[i] = el;
  };
  return { setRef, active, reached };
}

/**
 * Wide screens: one wheel gesture or key press moves exactly one section, with a smooth scroll that
 * always lands aligned (CSS scroll-snap alone snaps short wheel scrolls back to the same section).
 */
function useSectionPaging(container: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = container.current;
    if (!el || !window.matchMedia('(min-width: 1024px)').matches) return;
    let lastWheel = 0;
    let gestureUsed = false; // this wheel gesture has already moved (or tried to move) a section
    let target = 0; // section the last move headed to
    let movedAt = 0;
    /** Moves `step` sections; returns false only when already at the first or last section. */
    const go = (step: number): boolean => {
      const now = Date.now();
      if (now - movedAt < 450) return true; // still settling from the previous move
      const tops = [...el.querySelectorAll<HTMLElement>('[data-page]')].map(
        (s) => s.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - parseFloat(getComputedStyle(s).scrollMarginTop),
      );
      // While a smooth scroll may still be running, count from where it is going, not where it is.
      const nearest = tops.reduce((best, t, i) => (Math.abs(t - el.scrollTop) < Math.abs(tops[best]! - el.scrollTop) ? i : best), 0);
      const current = now - movedAt < 1500 ? target : nearest;
      const next = Math.min(tops.length - 1, Math.max(0, current + step));
      if (next === current) return false;
      target = next;
      movedAt = now;
      el.scrollTo({ top: tops[next], behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return true;
    };
    // Wheel events closer than 250ms apart are one gesture (a trackpad swipe and its momentum, a fast
    // wheel spin). A trackpad swipe starts with tiny deltas, so the gesture moves on its first clear one.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      e.preventDefault();
      if (e.timeStamp - lastWheel > 250) gestureUsed = false;
      lastWheel = e.timeStamp;
      if (!gestureUsed && Math.abs(e.deltaY) >= 4) gestureUsed = go(e.deltaY > 0 ? 1 : -1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      const step = { ArrowDown: 1, PageDown: 1, ' ': e.shiftKey ? -1 : 1, ArrowUp: -1, PageUp: -1, Home: -99, End: 99 }[e.key];
      if (!step) return;
      e.preventDefault();
      go(step);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [container]);
}

export default function LandingPage() {
  const { startDemo } = useAuth();
  const demo = useMutation({ mutationFn: startDemo, onError: (e) => toast.error(errorMessage(e)) }); // the app replaces this page once the session exists
  // The closing section is observed too (index 7): reaching it marks every step done and hides the rail.
  const { setRef, active, reached } = useChapterProgress(CHAPTERS.length + 1);
  const inStory = active >= 0 && active < CHAPTERS.length;
  const scroller = useRef<HTMLDivElement>(null);
  useSectionPaging(scroller);
  const canRenderGlobe = useMemo(() => webglAvailable(), []);
  const hero = useMemo(() => {
    const height = Math.max(560, window.innerHeight);
    const wide = window.innerWidth >= 1024;
    return { height, altitude: wide ? 1.8 : 4.4, offset: (wide ? [window.innerWidth * 0.22, 0] : [0, height * 0.22]) as [number, number] };
  }, []);
  const demoButton = (label: string, className?: string) => (
    <Button onClick={() => demo.mutate()} loading={demo.isPending} className={className}>{label}<ArrowRight className="h-4 w-4" /></Button>
  );
  const counter = `${String(active + 1).padStart(2, '0')} / ${String(CHAPTERS.length).padStart(2, '0')}`;

  // The page is always "in space": one fixed starfield behind every section, dark tokens throughout.
  // On wide screens each section fills the screen and scroll-snaps into place under the step header.
  return (
    <div ref={scroller} className="dark relative h-full overflow-y-auto bg-black text-fg motion-safe:scroll-smooth lg:snap-y lg:snap-mandatory">
      <div className="pointer-events-none fixed inset-0 bg-[url('/globe/night-sky.png')] bg-cover bg-center opacity-60" aria-hidden />

      <section data-page className="relative overflow-hidden lg:snap-start" style={{ height: hero.height }}>
        {canRenderGlobe && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <Suspense fallback={null}>
              <OpsGlobe realistic routes={LANES} height={hero.height} interactive={false} offset={hero.offset} initialView={{ lat: 24, lng: 52, altitude: hero.altitude }} />
            </Suspense>
          </div>
        )}
        <div className="relative mx-auto flex h-full max-w-[1280px] flex-col px-4 sm:px-6">
          <div className="flex h-16 shrink-0 items-center justify-between">
            <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight" aria-label="Fluxora home"><LogoMark />Fluxora</Link>
            <div className="flex items-center gap-2">
              <ButtonLink to="/login" variant="ghost">Log in</ButtonLink>
              {demoButton('Demo')}
            </div>
          </div>
          <div className="mt-[8vh] max-w-xl lg:my-auto">
            <h1 className="text-5xl font-semibold tracking-tight text-balance sm:text-7xl">Every Move, Smarter</h1>
            <p className="mt-5 max-w-lg text-base text-muted sm:text-lg">Fluxora runs procurement and freight on one record: raise the PO, compare carriers, book, track and catch delays early.</p>
            <div className="mt-8 flex gap-3">
              {demoButton('Try the demo', 'h-11 px-5 text-[15px]')}
              <ButtonLink to="/login" variant="outline" className="h-11 border-white/20 bg-white/5 px-5 text-[15px] backdrop-blur hover:bg-white/10">Log in</ButtonLink>
            </div>
          </div>
          <a href="#order" className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-xs text-muted backdrop-blur hover:text-fg lg:left-6 lg:translate-x-0">Scroll to follow one order <ArrowDown className="h-3.5 w-3.5" /></a>
        </div>
      </section>

      {/* Placed after the hero, so it scrolls in with the first chapter and then stays pinned. */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight" aria-label="Fluxora home"><LogoMark />Fluxora</Link>
          <nav aria-label="Order steps" className="mx-auto hidden items-center gap-1 lg:flex">
            {CHAPTERS.map((c, i) => (
              <a key={c.id} href={`#${c.id}`} aria-current={i === active ? 'step' : undefined} className={cn('flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors', i === active ? 'bg-accent-soft text-accent' : i < active ? 'text-fg' : 'text-subtle hover:text-fg')}>
                {i < active ? <Check className="h-3.5 w-3.5 text-accent" /> : <c.icon className="h-3.5 w-3.5" />}{c.step}
              </a>
            ))}
          </nav>
          {inStory && <span className="text-xs whitespace-nowrap text-muted tabular lg:hidden">{counter} · {CHAPTERS[active]!.step}</span>}
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <ButtonLink to="/login" variant="ghost">Log in</ButtonLink>
            {demoButton('Demo')}
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-[1280px] px-4 sm:px-6">
        <div className="pointer-events-none sticky top-1/2 hidden h-0 xl:block" aria-hidden>
          <div className={cn('absolute -left-2 flex -translate-y-1/2 flex-col items-center gap-3 transition-opacity', !inStory && 'opacity-0')}>
            <span className="relative h-32 w-px bg-line"><span className="absolute inset-x-0 top-0 bg-accent transition-[height] duration-500" style={{ height: `${((active + 1) / CHAPTERS.length) * 100}%` }} /></span>
            <span className="text-xs text-subtle tabular">{counter}</span>
          </div>
        </div>
        {CHAPTERS.map((c, i) => (
          <section key={c.id} id={c.id} data-page ref={setRef(i)} className="grid scroll-mt-14 items-center gap-10 py-16 lg:h-[calc(100svh-3.5rem)] lg:snap-start lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 lg:py-0 xl:pl-20">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{c.title}</h2>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">{c.body}</p>
              {i < CHAPTERS.length - 1 && <a href={`#${CHAPTERS[i + 1]!.id}`} className="mt-6 inline-flex items-center gap-1.5 text-xs text-subtle hover:text-fg">Next: {CHAPTERS[i + 1]!.step} <ArrowDown className="h-3.5 w-3.5" /></a>}
            </div>
            <c.Mock on={i <= reached} />
          </section>
        ))}
      </div>

      <section data-page ref={setRef(CHAPTERS.length)} className="relative flex scroll-mt-14 flex-col lg:h-[calc(100svh-3.5rem)] lg:snap-start">
        <div className="mx-auto flex max-w-[1280px] flex-1 flex-col items-center justify-center px-4 py-28 text-center sm:px-6">
          <LogoMark size={72} />
          <h2 className="mt-6 max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Run your next order through Fluxora.</h2>
          <p className="mt-4 max-w-lg text-balance text-muted">Explore the sample workspaces, or log in with Google to start your own.</p>
          <div className="mt-8 flex gap-3">
            {demoButton('Try the demo', 'h-11 px-5 text-[15px]')}
            <ButtonLink to="/login" variant="outline" className="h-11 border-white/20 bg-white/5 px-5 text-[15px] backdrop-blur hover:bg-white/10">Log in</ButtonLink>
          </div>
        </div>
        <footer className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-6 text-xs text-subtle sm:px-6">
          <span>© 2026 Fluxora · Sample data in the demo is fictional.</span>
          <span className="flex gap-4"><Link to="/terms" className="hover:text-fg">Terms</Link><Link to="/privacy" className="hover:text-fg">Privacy</Link></span>
        </footer>
      </section>
    </div>
  );
}
