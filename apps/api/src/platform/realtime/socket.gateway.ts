import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import type { SessionPrincipal } from '@factory-vision/domain-types';
import { isOriginAllowed, allowedOrigins } from '../http/cors-policy.js';
import { recordRefusal } from '../security/security-events.js';

/**
 * The realtime board channel (§23).
 *
 * This gateway used to take `tenantId` from the handshake query and put the
 * socket straight into that room. Anyone who could guess a tenant id — they
 * appear in URLs and in every seeded install — received that factory's live
 * production events without ever presenting a credential, which made the
 * row-level security underneath it decorative for anything published here.
 *
 * The channel now costs exactly what the REST API costs: a session token, and
 * a tenant that comes from the session rather than from the caller.
 */

interface AuthPort {
  resolve(token: string): Promise<SessionPrincipal | undefined>;
}

/** Where socket.io clients may present the session token. */
function tokenFrom(socket: Socket): string | undefined {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token.trim()) return auth.token.trim();

  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();

  return undefined;
}

export class RealtimeGateway {
  private io: SocketIOServer;

  constructor(
    server: HttpServer,
    private readonly auth: AuthPort,
    private readonly options: { enabled: boolean } = { enabled: true }
  ) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin(origin, callback) {
          callback(null, isOriginAllowed(origin ?? undefined));
        },
        methods: ['GET', 'POST'],
      },
    });

    // Rejected at the handshake, so an unauthenticated client never reaches a
    // room: refusing after `connection` would still have joined it.
    this.io.use(async (socket, next) => {
      if (!this.options.enabled) {
        socket.data.tenantId = (socket.handshake.query.tenantId as string) || undefined;
        return next();
      }

      const token = tokenFrom(socket);
      const principal = token ? await this.auth.resolve(token).catch(() => undefined) : undefined;
      if (!principal) {
        recordRefusal('REALTIME_HANDSHAKE_REJECTED', 'Koneksi realtime tanpa sesi yang sah ditolak.', {
          ip: socket.handshake.address,
          detail: { origin: socket.handshake.headers.origin },
        });
        return next(new Error('UNAUTHENTICATED'));
      }

      socket.data.principal = principal;
      socket.data.tenantId = principal.tenantId;
      next();
    });

    this.io.on('connection', (socket: Socket) => {
      const tenantId = socket.data.tenantId as string | undefined;
      if (tenantId) {
        socket.join(`tenant:${tenantId}`);
      }

      socket.on('disconnect', () => {
        // Rooms are left automatically; nothing else is held per socket.
      });
    });

    // eslint-disable-next-line no-console
    console.log(
      `[realtime] gateway ready (auth ${this.options.enabled ? 'required' : 'disabled'}, origins: ${
        allowedOrigins().join(', ') || 'same-origin only'
      })`
    );
  }

  emitTenantEvent(tenantId: string, event: string, payload: unknown) {
    this.io.to(`tenant:${tenantId}`).emit(event, payload);
  }

  /**
   * Every connected socket, regardless of tenant. Kept for deployment-wide
   * notices only: anything carrying tenant data must use `emitTenantEvent`.
   */
  broadcast(event: string, payload: unknown) {
    this.io.emit(event, payload);
  }

  /** Drops the sockets of a session that has just been revoked or expired. */
  disconnectSession(sessionId: string): void {
    for (const socket of this.io.sockets.sockets.values()) {
      const principal = socket.data.principal as SessionPrincipal | undefined;
      if (principal?.sessionId === sessionId) socket.disconnect(true);
    }
  }
}
