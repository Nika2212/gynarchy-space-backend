import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  // Returns a simple ok payload so load balancers can probe the process.
  public check(): { status: string } {
    return { status: 'ok' };
  }
}
