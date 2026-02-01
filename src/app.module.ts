import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    HttpModule.register({
      maxRedirects: 5,
      timeout: 6000,
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
