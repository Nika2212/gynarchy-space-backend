import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { Subject } from 'rxjs';
import type { Namespace, Socket } from 'socket.io';
import type { DownloadService } from '../services/download.service';
import type { IDownloadEvent } from '../shared/interfaces/download-event.interface';
import { DownloadsGateway } from './downloads.gateway';

describe('DownloadsGateway', () => {
  const snapshot = { jobs: [], storage: { isConfigured: true, usedBytes: 0, limitBytes: 1, freeBytes: 1 } };
  let events: Subject<IDownloadEvent>;
  let verifyAsync: jest.Mock;
  let server: { emit: jest.Mock };
  let gateway: DownloadsGateway;

  function client(token?: unknown): Socket & { emit: jest.Mock; disconnect: jest.Mock } {
    return { id: 'c1', handshake: { auth: { token } }, emit: jest.fn(), disconnect: jest.fn() } as unknown as Socket & { emit: jest.Mock; disconnect: jest.Mock };
  }

  beforeEach(() => {
    events = new Subject<IDownloadEvent>();
    verifyAsync = jest.fn().mockResolvedValue({ sub: 'admin' });
    server = { emit: jest.fn() };
    gateway = new DownloadsGateway(
      { events$: events.asObservable(), snapshot: () => snapshot } as unknown as DownloadService,
      { verifyAsync } as unknown as JwtService,
      { get: () => 'secret' } as unknown as ConfigService,
    );
    Object.assign(gateway, { server: server as unknown as Namespace });
    gateway.afterInit();
  });

  afterEach(() => gateway.onModuleDestroy());

  it('sends the snapshot to a client with a valid token', async () => {
    const socket = client('jwt');

    await gateway.handleConnection(socket);

    expect(verifyAsync).toHaveBeenCalledWith('jwt', { secret: 'secret' });
    expect(socket.emit).toHaveBeenCalledWith('downloads:snapshot', snapshot);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects clients without a valid token', async () => {
    const missing = client();
    await gateway.handleConnection(missing);
    expect(missing.disconnect).toHaveBeenCalledWith(true);

    verifyAsync.mockRejectedValueOnce(new Error('expired'));
    const invalid = client('bad');
    await gateway.handleConnection(invalid);
    expect(invalid.emit).toHaveBeenCalledWith('downloads:unauthorized');
    expect(invalid.emit).not.toHaveBeenCalledWith('downloads:snapshot', expect.anything());
    expect(invalid.disconnect).toHaveBeenCalledWith(true);
  });

  it('relays job, removal, and storage events to every client', () => {
    const job = { identifier: 'a' } as never;

    events.next({ type: 'job', job });
    events.next({ type: 'removed', identifier: 'a' });
    events.next({ type: 'storage', storage: snapshot.storage });

    expect(server.emit).toHaveBeenNthCalledWith(1, 'downloads:job', job);
    expect(server.emit).toHaveBeenNthCalledWith(2, 'downloads:removed', 'a');
    expect(server.emit).toHaveBeenNthCalledWith(3, 'downloads:storage', snapshot.storage);
  });
});
