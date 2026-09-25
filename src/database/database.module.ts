import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaRepository } from './media.repository';
import { MediaDocument, MediaSchema } from './media.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      // Builds the Atlas connection from MONGODB_URI.
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
        dbName: 'gynarchy',
        serverSelectionTimeoutMS: 10_000,
      }),
    }),
    MongooseModule.forFeature([{ name: MediaDocument.name, schema: MediaSchema }]),
  ],
  providers: [MediaRepository],
  exports: [MediaRepository],
})
export class DatabaseModule {}
