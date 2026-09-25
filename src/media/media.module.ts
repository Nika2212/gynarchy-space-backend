import { Module } from '@nestjs/common';
import { XMDCentre } from '../centres/XMD.centre';
import { SecurityModule } from '../security/security.module';
import { ImageProxyService } from './image-proxy.service';
import { ImagesController } from './images.controller';
import { MediaStreamService } from './media-stream.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [SecurityModule],
  controllers: [MediaController, ImagesController],
  providers: [XMDCentre, MediaService, MediaStreamService, ImageProxyService],
})
export class MediaModule {}
