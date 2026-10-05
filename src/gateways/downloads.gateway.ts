import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import type { Namespace, Socket } from 'socket.io';
import { DownloadService } from '../services/download.service';
import { IDownloadEvent } from '../shared/interfaces/download-event.interface';

// Live download progress for the app. Clients authenticate with the same JWT as the REST API.
@WebSocketGateway({ namespace: 'downloads' })
export class DownloadsGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(DownloadsGateway.name);
  private subscription: Subscription | null = null;

  @WebSocketServer()
  private readonly server!: Namespace;

  constructor(
    private readonly downloadService: DownloadService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // Relays every download and storage change to all connected clients.
  public afterInit(): void {
    this.subscription = this.downloadService.events$.subscribe((event: IDownloadEvent) => this.broadcast(event));
  }

  public onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  // Drops clients without a valid JWT, and sends the current jobs and storage to the rest.
  public async handleConnection(client: Socket): Promise<void> {
    const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;

    try {
      if (typeof token !== 'string' || !token) {
        throw new Error('Missing token');
      }
      await this.jwtService.verifyAsync(token, { secret: this.configService.get<string>('JWT_SECRET') });
    } catch {
      this.logger.warn(`Rejected download socket ${client.id}`);
      client.emit('downloads:unauthorized');
      client.disconnect(true);
      return;
    }

    client.emit('downloads:snapshot', this.downloadService.snapshot());
  }

  private broadcast(event: IDownloadEvent): void {
    if (event.type === 'job') {
      this.server.emit('downloads:job', event.job);
    } else if (event.type === 'removed') {
      this.server.emit('downloads:removed', event.identifier);
    } else {
      this.server.emit('downloads:storage', event.storage);
    }
  }
}
