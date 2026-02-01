import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { CryptaService } from './core/services/crypta.service';
import { StorageService } from './core/services/storage.service';
import { DBService } from './core/services/db.service';

@Module({
  imports: [
    HttpModule.register({
      maxRedirects: 5,
      timeout: 6000,
    }),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [],
  providers: [
    CryptaService,
    StorageService,
    DBService,
  ],
})
export class AppModule {
}
