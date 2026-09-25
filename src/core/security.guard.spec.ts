import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SecurityGuard } from './security.guard';

function contextWithAuth(authorization?: string): ExecutionContext {
  const request = { headers: { authorization }, user: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe('SecurityGuard', () => {
  const jwtService = { verifyAsync: jest.fn() };
  const configService = { get: jest.fn().mockReturnValue('secret') };
  const guard = new SecurityGuard(jwtService as unknown as JwtService, configService as unknown as ConfigService);

  beforeEach(() => {
    jwtService.verifyAsync.mockReset();
    configService.get.mockReturnValue('secret');
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
