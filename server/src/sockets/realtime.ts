import type { Server } from 'socket.io';
import type { Types } from 'mongoose';

/**
 * Thin indirection so domain services can publish events without depending on the
 * Socket.IO server (and so tests can run without one). Callers must only emit AFTER
 * the corresponding database write has succeeded.
 */
let io: Server | null = null;

export function setRealtimeServer(server: Server | null): void {
  io = server;
}

export const orgRoom = (organizationId: Types.ObjectId | string) => `org:${String(organizationId)}`;

export type RealtimeEvent = 'shipment:event' | 'shipment:updated' | 'alert:created' | 'alert:updated' | 'purchase-order:updated';

export function emitToOrg(organizationId: Types.ObjectId | string, event: RealtimeEvent, payload: unknown): void {
  io?.to(orgRoom(organizationId)).emit(event, payload);
}
