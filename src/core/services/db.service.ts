import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Console } from '../helpers/console';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class DBService {
  private base: string;
  
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    void this.onInit();
  }

  private getHeader(): object {
    return {
      Authorization: `Bearer ${this.configService.get<string>('STRAPI_API')}`,
      'Content-Type': 'application/json',
    };
  }
  
  private async onInit(): Promise<void> {
    const mode = this.configService.get<string>('MODE');
    
    if (mode === 'production') {
      this.base = this.configService.get<string>('LOCAL_STRAPI') as string;
    } else if (mode === 'development') {
      this.base = this.configService.get<string>('REMOTE_STRAPI') as string;
    }

    await this.check();
  }

  private async check(): Promise<void> {
    try {
      this.httpService.head(`${this.base}`)
        .subscribe({
          next: () => Console.success('Strapi initialized successfully'),
          error: (err: Error) => Console.error(`Strapi initialization error: ${err}`),
        });
    } catch (e) {
      Console.error(e.message);
    }
  }
}