import type { Server as HttpServer } from 'node:http';
import type { RequestHandler } from 'express';
import { Server } from 'socket.io';
import { corsOrigins } from '../config/env.js';
import { logger } from '../config/logger.js';
import { resolveAuthContext } from '../modules/auth/auth.service.js';
import { orgRoom, setRealtimeServer } from './realtime.js';

/**
 * Socket.IO server. Connections are authenticated with the same HttpOnly session cookie
 * as the REST API; the server — never the client — decides which organisation room a
 * socket joins, so clients cannot subscribe to another organisation's events.
 */
export function createSocketServer(httpServer: HttpServer, sessionMiddleware: RequestHandler): Server {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: corsOrigins, credentials: true },
    serveClient: false,
  });

  io.engine.use(sessionMiddleware);

  io.use(async (socket, next) => {
    const req = socket.request as unknown as { session?: { userId?: string; organizationId?: string } };
    const { userId, organizationId } = req.session ?? {};
    if (!userId || !organizationId) return next(new Error('UNAUTHENTICATED'));
    const ctx = await resolveAuthContext(userId, organizationId).catch(() => null);
    if (!ctx) return next(new Error('UNAUTHENTICATED'));
    socket.data.organizationId = String(ctx.organizationId);
    socket.data.userId = String(ctx.userId);
    next();
  });

  io.on('connection', (socket) => {
    void socket.join(orgRoom(socket.data.organizationId));
    logger.debug({ userId: socket.data.userId }, 'Socket connected');
    // Deliberately no "join room" handler: room membership is server-assigned only.
  });

  setRealtimeServer(io);
  return io;
}
