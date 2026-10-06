import { Body, Controller, Get, Patch, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SecurityGuard } from '../core/security.guard';
import { SettingsDTO } from '../DTOs/settings.DTO';
import { SettingsRepository } from '../repositories/settings.repository';

@UseGuards(ThrottlerGuard, SecurityGuard)
@Throttle({ default: { limit: 120, ttl: 60000 } })
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsRepository: SettingsRepository) {}

  @Get()
  public async find(@Res() res: Response): Promise<void> {
    res.status(200).json(await this.settingsRepository.find());
  }

  @Patch()
  public async update(@Res() res: Response, @Body() body: SettingsDTO): Promise<void> {
    res.status(200).json(await this.settingsRepository.update(body));
  }
}
