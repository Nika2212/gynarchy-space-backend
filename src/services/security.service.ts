import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { safeEqual } from '../shared/timing-safe';

export const MAX_FAILED_ATTEMPTS = 5;
export const BLOCK_DURATION_MS = 60 * 60 * 1000;
export const MAX_TRACKED_CLIENTS = 10_000;

interface IFailedAttempts {
  failures: number;
  lastFailureAt: number;
  blockedUntil: number;
}

@Injectable()
export class SecurityService {
  private readonly attempts = new Map<string, IFailedAttempts>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // Compares the passcode and signs a JWT for a valid owner.
  public async auth(passcode: string, client: string) {
    this.assertNotBlocked(client);

    const secretPasscode = this.configService.get<string>('APP_PASSCODE')?.trim() ?? '';

    if (!secretPasscode || !safeEqual(passcode, secretPasscode)) {
      this.recordFailure(client);
      throw new UnauthorizedException('Invalid passcode');
    }

    this.attempts.delete(client);

    return {
      accessToken: await this.jwtService.signAsync({ sub: 'admin', role: 'owner' }),
    };
  }

  // Rejects the client while its block is active, and forgets stale failures.
  private assertNotBlocked(client: string): void {
    const entry = this.attempts.get(client);
    if (!entry) {
      return;
    }

    const now = Date.now();
    if (entry.blockedUntil > now) {
      throw new HttpException('Too many wrong passcodes', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (now - entry.lastFailureAt >= BLOCK_DURATION_MS) {
      this.attempts.delete(client);
    }
  }

  // Counts one wrong passcode and starts the block on the last allowed try.
  private recordFailure(client: string): void {
    const now = Date.now();
    const entry = this.attempts.get(client) ?? { failures: 0, lastFailureAt: now, blockedUntil: 0 };

    entry.failures += 1;
    entry.lastFailureAt = now;
    if (entry.failures >= MAX_FAILED_ATTEMPTS) {
      entry.blockedUntil = now + BLOCK_DURATION_MS;
    }
    this.attempts.set(client, entry);

    if (this.attempts.size > MAX_TRACKED_CLIENTS) {
      this.attempts.delete(this.attempts.keys().next().value as string);
    }
  }
}
