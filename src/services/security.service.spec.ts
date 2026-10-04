import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BLOCK_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  MAX_TRACKED_CLIENTS,
  SecurityService,
} from './security.service';

describe('SecurityService', () => {
  const jwtService = { signAsync: jest.fn().mockResolvedValue('jwt') };
  const configService = { get: jest.fn() };
  let service: SecurityService;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jwtService.signAsync.mockClear();
    configService.get.mockReturnValue('0000');
    service = new SecurityService(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function failTimes(times: number, client = 'ip'): Promise<void> {
    for (let i = 0; i < times; i++) {
      await expect(service.auth('1111', client)).rejects.toBeInstanceOf(UnauthorizedException);
    }
  }

  it('signs a JWT when the passcode matches', async () => {
    await expect(service.auth('0000', 'ip')).resolves.toEqual({ accessToken: 'jwt' });
    expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: 'admin', role: 'owner' });
  });

  it('rejects a wrong or empty configured passcode', async () => {
    await expect(service.auth('1111', 'ip')).rejects.toBeInstanceOf(UnauthorizedException);
    configService.get.mockReturnValue(undefined);
    await expect(service.auth('0000', 'ip')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('in production', () => {
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    const homeScreenIPhone = { userAgent: IPHONE, displayMode: 'standalone' };

    beforeEach(() => {
      configService.get.mockImplementation((key: string) => (key === 'NODE_ENV' ? 'production' : '0000'));
    });

    it('signs in the iOS home-screen app', async () => {
      await expect(service.auth('0000', 'ip', homeScreenIPhone)).resolves.toEqual({ accessToken: 'jwt' });
    });

    it('answers a disallowed device exactly like a wrong passcode', async () => {
      const desktop = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', displayMode: 'standalone' };
      const safariTab = { userAgent: IPHONE, displayMode: 'browser' };

      for (const device of [desktop, safariTab, { userAgent: IPHONE }, { displayMode: 'standalone' }, {}]) {
        await expect(service.auth('0000', `ip-${JSON.stringify(device)}`, device)).rejects.toThrow(new UnauthorizedException('Invalid passcode'));
      }
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('counts disallowed devices toward the block', async () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await expect(service.auth('0000', 'ip', {})).rejects.toBeInstanceOf(UnauthorizedException);
      }

      await expect(service.auth('0000', 'ip', homeScreenIPhone)).rejects.toMatchObject({ status: 429 });
    });

    it('still rejects a wrong passcode on the allowed device', async () => {
      await expect(service.auth('1111', 'ip', homeScreenIPhone)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('allows any device outside production', async () => {
    configService.get.mockImplementation((key: string) => (key === 'NODE_ENV' ? 'development' : '0000'));

    await expect(service.auth('0000', 'ip', {})).resolves.toEqual({ accessToken: 'jwt' });
  });

  it('never blocks on correct passcodes', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS * 2; i++) {
      await expect(service.auth('0000', 'ip')).resolves.toEqual({ accessToken: 'jwt' });
    }
  });

  it('blocks the client for an hour after the last allowed wrong try', async () => {
    await failTimes(MAX_FAILED_ATTEMPTS);

    await expect(service.auth('0000', 'ip')).rejects.toMatchObject({ status: 429 });
    await expect(service.auth('0000', 'ip')).rejects.toBeInstanceOf(HttpException);
    await expect(service.auth('0000', 'other')).resolves.toEqual({ accessToken: 'jwt' });

    now += BLOCK_DURATION_MS;
    await expect(service.auth('0000', 'ip')).resolves.toEqual({ accessToken: 'jwt' });
  });

  it('resets the count after a correct passcode', async () => {
    await failTimes(MAX_FAILED_ATTEMPTS - 1);
    await service.auth('0000', 'ip');
    await failTimes(MAX_FAILED_ATTEMPTS - 1);

    await expect(service.auth('0000', 'ip')).resolves.toEqual({ accessToken: 'jwt' });
  });

  it('forgets wrong tries that are more than an hour old', async () => {
    await failTimes(MAX_FAILED_ATTEMPTS - 1);
    now += BLOCK_DURATION_MS;
    await failTimes(MAX_FAILED_ATTEMPTS - 1);

    await expect(service.auth('0000', 'ip')).resolves.toEqual({ accessToken: 'jwt' });
  });

  it('drops the oldest client when too many are tracked', async () => {
    await failTimes(MAX_FAILED_ATTEMPTS, 'first');
    for (let i = 0; i < MAX_TRACKED_CLIENTS; i++) {
      await failTimes(1, `ip-${i}`);
    }

    await expect(service.auth('0000', 'first')).resolves.toEqual({ accessToken: 'jwt' });
  });
});
