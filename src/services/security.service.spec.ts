import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SecurityService } from './security.service';

describe('SecurityService', () => {
  const jwtService = { signAsync: jest.fn().mockResolvedValue('jwt') };
  const configService = { get: jest.fn() };
  const service = new SecurityService(
    jwtService as unknown as JwtService,
    configService as unknown as ConfigService,
  );

  beforeEach(() => {
    jwtService.signAsync.mockClear();
    configService.get.mockReturnValue('0000');
  });

  it('signs a JWT when the passcode matches', async () => {
    await expect(service.auth('0000')).resolves.toEqual({ accessToken: 'jwt' });
    expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: 'admin', role: 'owner' });
  });

  it('rejects a wrong or empty configured passcode', async () => {
    await expect(service.auth('1111')).rejects.toBeInstanceOf(UnauthorizedException);
    configService.get.mockReturnValue(undefined);
    await expect(service.auth('0000')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
