import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';

export class RealtimeGateway {
  private io: SocketIOServer;

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.io.on('connection', (socket: Socket) => {
      const tenantId = socket.handshake.query.tenantId as string;
      if (tenantId) {
        socket.join(`tenant:${tenantId}`);
        console.log(`[RealtimeGateway] Client joined tenant room: tenant:${tenantId}`);
      }

      socket.on('disconnect', () => {
        // cleanup if needed
      });
    });
  }

  emitTenantEvent(tenantId: string, event: string, payload: unknown) {
    this.io.to(`tenant:${tenantId}`).emit(event, payload);
  }

  broadcast(event: string, payload: unknown) {
    this.io.emit(event, payload);
  }
}
