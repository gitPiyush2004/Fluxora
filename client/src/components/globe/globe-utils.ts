import type { ShipmentStatus } from '@/lib/types';

/** Kept separate from ops-globe.tsx so importing these never pulls three.js into a chunk. */
export interface GlobeRoute {
  id: string;
  label: string;
  status: ShipmentStatus;
  from: { lat: number; lng: number; name: string };
  to: { lat: number; lng: number; name: string };
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    return false;
  }
}
