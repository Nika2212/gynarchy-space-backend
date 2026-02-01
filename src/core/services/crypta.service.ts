import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CryptaService {
  private readonly algorithm: string = 'aes-256-gcm';

  constructor(private readonly configService: ConfigService) {}

  encrypt(text: string): string {
    const key = this.configService.get<string>('CRYPTA') as string;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv) as crypto.CipherGCM;

    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(hash: string): string {
    const key = this.configService.get<string>('CRYPTA') as string;
    const [ivHex, tagHex, encryptedHex] = hash.split(':');

    const decipher = crypto.createDecipheriv(this.algorithm, key, Buffer.from(ivHex, 'hex')) as crypto.DecipherGCM;
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);

    return decrypted.toString('utf8');
  }
}