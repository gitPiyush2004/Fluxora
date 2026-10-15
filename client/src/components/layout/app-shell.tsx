import { Fragment, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import {
  Bell,
  Boxes,
  Building2,
  ChartColumn,
  Check,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Factory,
  GitCompareArrows,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Radar,
  Settings,
  Sun,
  Truck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { ALERT_TYPE_LABEL } from '@/lib/constants';
import { useAuth, useSession } from '@/providers/auth';
import { useRealtimeStatus } from '@/providers/realtime';
import { useTheme, type ThemePreference } from '@/providers/theme';
import { Button } from '../ui/button';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../ui/menu';
import { SeverityBadge } from '../ui/badge';
import { useAlertMenu, useAlertSummary } from '@/features/tracking/hooks';
import { Logo } from './logo';

// `section` starts a labelled group in the sidebar.
const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/shipments', label: 'Shipments', icon: Truck, section: 'Logistics' },
  { to: '/compare', label: 'Compare carriers', icon: GitCompareArrows },
  { to: '/tracking', label: 'Tracking & alerts', icon: Radar },
  { to: '/purchase-orders', label: 'Purchase orders', icon: ClipboardList, section: 'Procurement' },
  { to: '/suppliers', label: 'Suppliers', icon: Factory },
  { to: '/products', label: 'Products', icon: Boxes },
  { to: '/analytics', label: 'Analytics', icon: ChartColumn, section: 'Workspace' },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const COLLAPSE_KEY = 'fluxora.sidebar.collapsed';

function NavItems({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { data } = useAlertSummary();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => (
        <Fragment key={item.to}>
          {item.section &&
            (collapsed ? <div className="mx-2 my-2 border-t border-line" /> : <div className="px-2.5 pt-4 pb-1 text-xs font-medium text-subtle">{item.section}</div>)}
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                'group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors',
                isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-3 hover:text-fg',
                collapsed && 'justify-center px-0',
              )
            }
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{item.label}</span>}
            {item.to === '/tracking' && (data?.unresolved ?? 0) > 0 && (
              <span
                className={cn(
                  'rounded-full bg-danger px-1.5 text-[11px] leading-4 font-medium tabular text-white dark:text-black',
                  collapsed ? 'absolute top-1 right-1.5' : 'ml-auto',
                )}
                aria-label={`${data!.unresolved} unresolved alerts`}
              >
                {data!.unresolved}
              </span>
            )}
          </NavLink>
        </Fragment>
      ))}
    </nav>
  );
}

function ThemeMenu() {
  const { preference, setPreference, resolved } = useTheme();
  const opts: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];
  const Icon = resolved === 'dark' ? Moon : Sun;
  return (
    <Menu
      label="Theme"
      trigger={(p) => (
        <Button variant="ghost" size="icon" aria-label="Change theme" {...p}>
          <Icon className="h-[18px] w-[18px]" />
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Appearance</MenuLabel>
          {opts.map((o) => (
            <MenuItem key={o.value} icon={<o.icon className="h-4 w-4" />} onSelect={() => { setPreference(o.value); close(); }}>
              <span className="flex-1">{o.label}</span>
              {preference === o.value && <Check className="h-4 w-4 text-accent" />}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

function NotificationsMenu() {
  const navigate = useNavigate();
  const { data } = useAlertMenu();
  const count = data?.meta?.total ?? 0;
  return (
    <Menu
      label="Notifications"
      className="w-[340px]"
      trigger={(p) => (
        <Button variant="ghost" size="icon" aria-label={`Notifications${count ? `, ${count} unresolved alerts` : ''}`} className="relative" {...p}>
          <Bell className="h-[18px] w-[18px]" />
          {count > 0 && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" aria-hidden />}
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Unresolved alerts · {count}</MenuLabel>
          {data?.data.length ? (
            data.data.map((a) => (
              <MenuItem key={a._id} onSelect={() => { close(); navigate(`/shipments/${a.shipmentId}`); }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{ALERT_TYPE_LABEL[a.type]} · {a.shipmentReference}</span>
                    <SeverityBadge severity={a.severity} />
                  </div>
                  <div className="truncate text-xs text-muted">{a.message}</div>
                  <div className="text-[11px] text-subtle">{relativeTime(a.detectedAt)}</div>
                </div>
              </MenuItem>
            ))
          ) : (
            <div className="px-3 py-4 text-sm text-muted">No unresolved alerts.</div>
          )}
          <MenuSeparator />
          <MenuItem onSelect={() => { close(); navigate('/tracking'); }}>View all alerts</MenuItem>
        </>
      )}
    </Menu>
  );
}

function UserMenu() {
  const me = useSession();
  const { signOut, switchOrganization } = useAuth();
  const navigate = useNavigate();
  const initials = me.user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Menu
      label="Account"
      className="w-[280px]"
      trigger={(p) => (
        <button type="button" className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-surface-3" aria-label="Account menu" {...p}>
          {me.user.avatarUrl ? (
            <img src={me.user.avatarUrl} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{initials}</span>
          )}
          <span className="hidden max-w-[140px] truncate text-left text-[13px] leading-tight md:block">
            <span className="block truncate font-medium text-fg">{me.user.name}</span>
            <span className="block truncate text-[11px] text-muted">{me.organization.name}</span>
          </span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-3 py-2">
            <div className="truncate text-sm font-medium">{me.user.name}</div>
            <div className="truncate text-xs text-muted">{me.user.email}</div>
            <div className="mt-1 meta-label">{me.role === 'ADMIN' ? 'Organization admin' : 'Member'}</div>
          </div>
          <MenuSeparator />
          <MenuLabel>Organizations</MenuLabel>
          {me.organizations.map((o) => (
            <MenuItem
              key={o.id}
              icon={<Building2 className="h-4 w-4" />}
              onSelect={async () => {
                close();
                if (o.id === me.organization.id) return;
                try {
                  await switchOrganization(o.id);
                  navigate('/');
                  toast.success(`Switched to ${o.name}`);
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              <span className="flex-1 truncate">{o.name}</span>
              {o.id === me.organization.id && <Check className="h-4 w-4 text-accent" />}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={<Settings className="h-4 w-4" />} onSelect={() => { close(); navigate('/settings'); }}>Settings</MenuItem>
          <MenuItem
            danger
            icon={<LogOut className="h-4 w-4" />}
            onSelect={async () => {
              close();
              await signOut(); // RequireAuth then redirects to /login
              toast.success('Signed out');
            }}
          >
            Sign out
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

export function AppShell() {
  const me = useSession();
  const realtime = useRealtimeStatus();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className={cn('hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex', collapsed ? 'w-[68px]' : 'w-[244px]')}>
        <div className={cn('flex h-14 items-center border-b border-line', collapsed ? 'justify-center' : 'px-4')}>
          <Logo compact={collapsed} />
        </div>
        <div className="flex-1 overflow-y-auto py-3">
          <NavItems collapsed={collapsed} />
        </div>
        <div className="border-t border-line p-2">
          {!collapsed && (
            <div className="mb-1 flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted">
              <span className={cn('h-1.5 w-1.5 rounded-full', realtime === 'live' ? 'bg-success' : 'bg-subtle')} aria-hidden />
              {realtime === 'live' ? 'Live updates on' : 'Live updates paused'}
            </div>
          )}
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r border-line bg-surface">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <Logo />
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto py-3">
              <NavItems collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <MenuIcon className="h-5 w-5" />
          </Button>
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <div className="hidden truncate text-sm font-medium text-fg md:block">{me.organization.name}</div>
          <div className="ml-auto flex items-center gap-1">
            <NotificationsMenu />
            <ThemeMenu />
            <div className="mx-1 h-6 w-px bg-line" aria-hidden />
            <UserMenu />
          </div>
        </header>
        <main id="main" className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
