import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class SecurityService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  public async auth(passcode: string) {
    const secretPasscode = this.configService.get<string>('APP_PASSCODE');

    if (passcode !== secretPasscode) {
      throw new UnauthorizedException('Invalid passcode');
    }

    const payload = { sub: 'admin', role: 'owner' };

    return {
      accessToken: await this.jwtService.signAsync(payload),
    };
  }
}

@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token: string | undefined = this.extractTokenFromHeader(request);

    if (!token) throw new UnauthorizedException();

    try {
      request['user'] = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}