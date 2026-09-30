import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SecurityGuard } from './security.guard';

function contextWithAuth(authorization?: string): ExecutionContext {
  const request = { headers: { authorization }, user: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('SecurityGuard', () => {
  const jwtService = { verifyAsync: jest.fn() };
  const configService = { get: jest.fn().mockReturnValue('secret') };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new SecurityGuard(
    jwtService as unknown as JwtService,
    configService as unknown as ConfigService,
    reflector as unknown as Reflector,
  );

  beforeEach(() => {
    jwtService.verifyAsync.mockReset();
    configService.get.mockReturnValue('secret');
    reflector.getAllAndOverride.mockReturnValue(false);
  });

  it('lets a public route through without a token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(contextWithAuth())).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('throws when the Authorization header is missing or not Bearer', async () => {
    await expect(guard.canActivate(contextWithAuth())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(contextWithAuth('Basic abc'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when the JWT is invalid', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('bad'));
    await expect(guard.canActivate(contextWithAuth('Bearer bad'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the user and returns true for a valid Bearer token', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'admin' });
    const context = contextWithAuth('Bearer good');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.switchToHttp().getRequest().user).toEqual({ sub: 'admin' });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('good', { secret: 'secret' });
  });
});
