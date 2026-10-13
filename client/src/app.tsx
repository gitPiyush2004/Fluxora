import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';
import { AuthProvider, useAuth } from '@/providers/auth';
import { RealtimeProvider } from '@/providers/realtime';
import { ThemeProvider, useTheme } from '@/providers/theme';
import { AppShell } from '@/components/layout/app-shell';
import { ErrorState, Spinner } from '@/components/ui/feedback';
import { EmptyState } from '@/components/ui/feedback';
import { ButtonLink } from '@/components/ui/button';
import { LoginPage } from '@/features/auth/login-page';

const DashboardPage = lazy(() => import('@/features/dashboard/dashboard-page'));
const ShipmentsPage = lazy(() => import('@/features/shipments/shipments-page'));
const ShipmentFormPage = lazy(() => import('@/features/shipments/shipment-form-page'));
const ShipmentDetailPage = lazy(() => import('@/features/shipments/shipment-detail-page'));
const ComparePage = lazy(() => import('@/features/compare/compare-page'));
const TrackingPage = lazy(() => import('@/features/tracking/tracking-page'));
const PurchaseOrdersPage = lazy(() => import('@/features/purchase-orders/purchase-orders-page'));
const PurchaseOrderFormPage = lazy(() => import('@/features/purchase-orders/purchase-order-form-page'));
const PurchaseOrderDetailPage = lazy(() => import('@/features/purchase-orders/purchase-order-detail-page'));
const SuppliersPage = lazy(() => import('@/features/suppliers/suppliers-page'));
const SupplierDetailPage = lazy(() => import('@/features/suppliers/supplier-detail-page'));
const ProductsPage = lazy(() => import('@/features/products/products-page'));
const AnalyticsPage = lazy(() => import('@/features/analytics/analytics-page'));
const SettingsPage = lazy(() => import('@/features/settings/settings-page'));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

function FullScreenLoader() {
  return (
    <div className="grid h-full place-items-center">
      <Spinner />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, isLoading, signedOut } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullScreenLoader />;
  // Only an expired session or a deep link remembers where to return to.
  if (!me) return <Navigate to={signedOut ? '/login' : `/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function RouteError() {
  const error = useRouteError();
  return <ErrorState error={error} onRetry={() => window.location.reload()} className="min-h-[60vh]" />;
}

function NotFound() {
  return (
    <EmptyState
      className="min-h-[60vh]"
      title="Page not found"
      description="The page you’re looking for doesn’t exist or was moved."
      action={<ButtonLink to="/">Back to overview</ButtonLink>}
    />
  );
}

function Page() {
  return (
    <Suspense fallback={<div className="grid min-h-[50vh] place-items-center"><Spinner /></div>}>
      <Outlet />
    </Suspense>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <RealtimeProvider>
          <AppShell />
        </RealtimeProvider>
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      {
        element: <Page />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'shipments', element: <ShipmentsPage /> },
          { path: 'shipments/new', element: <ShipmentFormPage /> },
          { path: 'shipments/:id', element: <ShipmentDetailPage /> },
          { path: 'shipments/:id/edit', element: <ShipmentFormPage /> },
          { path: 'compare', element: <ComparePage /> },
          { path: 'tracking', element: <TrackingPage /> },
          { path: 'purchase-orders', element: <PurchaseOrdersPage /> },
          { path: 'purchase-orders/new', element: <PurchaseOrderFormPage /> },
          { path: 'purchase-orders/:id', element: <PurchaseOrderDetailPage /> },
          { path: 'purchase-orders/:id/edit', element: <PurchaseOrderFormPage /> },
          { path: 'suppliers', element: <SuppliersPage /> },
          { path: 'suppliers/:id', element: <SupplierDetailPage /> },
          { path: 'products', element: <ProductsPage /> },
          { path: 'analytics', element: <AnalyticsPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" richColors closeButton toastOptions={{ className: 'font-sans' }} />;
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
          <ThemedToaster />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
