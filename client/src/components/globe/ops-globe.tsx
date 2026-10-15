import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial, Color } from 'three';
import { polygonToCells } from 'h3-js';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, Geometry } from 'geojson';
import countriesTopo from 'world-atlas/countries-110m.json';
import { cssVar, useTheme } from '@/providers/theme';
import type { ShipmentStatus } from '@/lib/types';
import type { GlobeRoute } from './globe-utils';

interface Props {
  routes: GlobeRoute[];
  height: number;
  interactive?: boolean;
  autoRotate?: boolean;
  onRouteClick?: (route: GlobeRoute) => void;
  initialView?: { lat: number; lng: number; altitude: number };
  /** Photographic Earth (satellite imagery and terrain) instead of the themed hex map. */
  realistic?: boolean;
  /** Moves the globe off-centre within the canvas, in pixels [x, y]. */
  offset?: [number, number];
}

type Ring = number[][];

/** True if a polygon's outer ring spans more than 180° of longitude (i.e. it crosses the antimeridian). */
function crossesAntimeridian(polygon: Ring[]): boolean {
  const lngs = (polygon[0] ?? []).map((c) => c[0]!);
  return Math.max(...lngs) - Math.min(...lngs) > 180;
}

const HEX_RESOLUTION = 3;

/** True if H3 can hex-bin this polygon (it rejects some degenerate rings in the 110m data). */
function h3Accepts(polygon: Ring[]): boolean {
  try {
    polygonToCells(polygon, HEX_RESOLUTION, true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Natural Earth country shapes, cleaned for H3 hex-binning: polygons that wrap the
 * antimeridian (parts of Russia, Fiji), Antarctica and any ring H3 rejects are dropped,
 * so the globe never throws while rendering.
 */
const LAND: Feature<Geometry>[] = (() => {
  const topo = countriesTopo as unknown as Topology<{ countries: GeometryCollection }>;
  const fc = feature(topo, topo.objects.countries);
  const features = 'features' in fc ? (fc.features as Feature<Geometry>[]) : [];
  return features.flatMap((f): Feature<Geometry>[] => {
    if (String(f.id) === '010') return []; // Antarctica
    const g = f.geometry;
    if (g?.type === 'Polygon') return crossesAntimeridian(g.coordinates as Ring[]) || !h3Accepts(g.coordinates as Ring[]) ? [] : [f];
    if (g?.type === 'MultiPolygon') {
      const polys = (g.coordinates as Ring[][]).filter((p) => !crossesAntimeridian(p) && h3Accepts(p));
      return polys.length ? [{ ...f, geometry: { type: 'MultiPolygon', coordinates: polys } }] : [];
    }
    return [];
  });
})();

const PROBLEM: ShipmentStatus[] = ['DELAYED', 'EXCEPTION'];

// Fixed colors for the photographic globe: it always sits in space, whatever the app theme.
const SPACE_COLORS = { ocean: '#000000', land: '', atmo: '#7fb8ff', arcA: '#7fdcef', arcB: '#ffffff', danger: '#ff8080', success: '#7ee2a8' };

function readColors() {
  return {
    ocean: cssVar('--globe-ocean') || '#10161e',
    land: cssVar('--globe-land') || 'rgba(160,184,204,0.42)',
    atmo: cssVar('--globe-atmo') || '#3f7f90',
    arcA: cssVar('--arc-a') || '#4fb8cc',
    arcB: cssVar('--arc-b') || '#b4e4ee',
    danger: cssVar('--danger') || '#ef7d7d',
    success: cssVar('--success') || '#5bc98a',
  };
}

function withAlpha(color: string, alpha: number): string {
  const c = new Color(color);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
}

/**
 * 3D operations globe (WebGL via three.js). Theme-aware: colors are read from CSS tokens
 * so it follows light/dark mode. Respects prefers-reduced-motion.
 *
 * Performance note: every accessor passed to <Globe> is memoised. New function identities
 * make react-globe.gl re-run its layer digests (including H3 hex-binning of all land
 * polygons), so the component is memoised.
 */
export default memo(OpsGlobe);

function OpsGlobe({ routes, height, interactive = true, autoRotate = true, onRouteClick, initialView, realistic = false, offset }: Props) {
  const ref = useRef<GlobeMethods | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const { resolved } = useTheme();
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Theme tokens, re-read when the theme flips. ThemeProvider swaps the theme class in a
  // layout effect, which always runs before this effect, so the new values are in place.
  const [themeColors, setThemeColors] = useState(readColors);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the tokens live in the DOM and are only correct after the class swap
  useEffect(() => setThemeColors(readColors()), [resolved]);
  const colors = realistic ? SPACE_COLORS : themeColors;

  const material = useMemo(() => {
    const m = new MeshPhongMaterial({ color: new Color(colors.ocean), shininess: resolved === 'dark' ? 6 : 12, transparent: true, opacity: 0.96 });
    m.emissive = new Color(resolved === 'dark' ? '#0a1118' : '#e3eaf1');
    m.emissiveIntensity = resolved === 'dark' ? 0.5 : 0.85;
    return m;
  }, [colors.ocean, resolved]);

  useEffect(() => () => material.dispose(), [material]);

  // Stable accessors (see performance note above).
  const landColor = useCallback(() => colors.land, [colors.land]);
  const hubColor = useCallback(() => colors.arcB, [colors.arcB]);
  const ringColor = useCallback(() => (t: number) => withAlpha(colors.danger, 1 - t), [colors.danger]);
  const arcLabel = useCallback((d: object) => (d as GlobeRoute).label, []);
  const pointLabel = useCallback((d: object) => (d as { name: string }).name, []);
  const pointRadius = useCallback((d: object) => 0.22 + Math.min((d as { count: number }).count, 8) * 0.04, []);
  const dashGap = useCallback(() => Math.random(), []);
  const onArcClick = useMemo(() => (onRouteClick ? (d: object) => onRouteClick(d as GlobeRoute) : undefined), [onRouteClick]);

  const arcs = useMemo(
    () =>
      routes.map((r) => {
        const problem = PROBLEM.includes(r.status);
        const delivered = r.status === 'DELIVERED';
        const c = problem ? colors.danger : delivered ? colors.success : colors.arcA;
        return {
          ...r,
          startLat: r.from.lat,
          startLng: r.from.lng,
          endLat: r.to.lat,
          endLng: r.to.lng,
          color: delivered ? [withAlpha(c, 0.15), withAlpha(c, 0.35)] : [withAlpha(c, 0.35), problem ? c : colors.arcB],
          stroke: delivered ? 0.3 : problem ? 0.8 : 0.6,
        };
      }),
    [routes, colors],
  );

  const hubs = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number; name: string; count: number }>();
    for (const r of routes) {
      for (const p of [r.from, r.to]) {
        const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
        const hub = map.get(key) ?? { ...p, count: 0 };
        hub.count += 1;
        map.set(key, hub);
      }
    }
    return [...map.values()];
  }, [routes]);

  const rings = useMemo(() => routes.filter((r) => PROBLEM.includes(r.status)).map((r) => ({ lat: r.to.lat, lng: r.to.lng, id: r.id })), [routes]);

  useEffect(() => {
    const g = ref.current;
    if (!g || !width) return;
    const controls = g.controls();
    controls.autoRotate = autoRotate && !reducedMotion;
    controls.autoRotateSpeed = 0.25;
    controls.enableZoom = interactive;
    controls.enablePan = false;
    controls.minDistance = 160;
    controls.maxDistance = 520;
    g.pointOfView(initialView ?? { lat: 30, lng: 15, altitude: 1.85 }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, autoRotate, interactive]);

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <Globe
          ref={ref}
          width={width}
          height={height}
          backgroundColor="rgba(0,0,0,0)"
          globeOffset={offset}
          globeMaterial={realistic ? undefined : material}
          globeImageUrl={realistic ? '/globe/earth-blue-marble.jpg' : undefined}
          bumpImageUrl={realistic ? '/globe/earth-topology.png' : undefined}
          showAtmosphere
          atmosphereColor={colors.atmo}
          atmosphereAltitude={realistic ? 0.2 : 0.12}
          hexPolygonsData={realistic ? [] : LAND}
          hexPolygonResolution={HEX_RESOLUTION}
          hexPolygonMargin={0.42}
          hexPolygonUseDots={false}
          hexPolygonColor={landColor}
          arcsData={arcs}
          arcColor="color"
          arcStroke="stroke"
          arcDashLength={0.45}
          arcDashGap={0.25}
          arcDashInitialGap={dashGap}
          arcDashAnimateTime={reducedMotion ? 0 : 2600}
          arcAltitudeAutoScale={0.42}
          arcLabel={arcLabel}
          onArcClick={onArcClick}
          pointsData={hubs}
          pointLat="lat"
          pointLng="lng"
          pointColor={hubColor}
          pointAltitude={0.012}
          pointRadius={pointRadius}
          pointLabel={pointLabel}
          ringsData={rings}
          ringColor={ringColor}
          ringMaxRadius={3.2}
          ringPropagationSpeed={reducedMotion ? 0 : 1.8}
          ringRepeatPeriod={1100}
          enablePointerInteraction={interactive}
          animateIn={!reducedMotion}
        />
      )}
    </div>
  );
}
