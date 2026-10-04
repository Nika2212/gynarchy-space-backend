import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CentreRegistry } from '../core/centres/centre.registry';
import { encryptText, hashIdentifier, tryDecryptText } from '../shared/field-crypto';
import { decryptShortTokenToURL } from '../shared/url-token';
import type { IAlbum, IAlbumMedia } from '../shared/interfaces/album.interface';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { AlbumDocument, AlbumItem, AlbumModel } from './album.schema';

@Injectable()
export class AlbumRepository {
  constructor(
    @InjectModel(AlbumDocument.name) private readonly albumModel: Model<AlbumDocument>,
    private readonly configService: ConfigService,
    private readonly centreRegistry: CentreRegistry,
  ) {}

  // Loads every album, newest first, with its media newest-added first.
  public async findAll(): Promise<IAlbum[]> {
    const secret = this.secret();
    const rows = await this.albumModel.find().sort({ createdAt: -1 }).exec();

    return rows.map((row) => this.toAlbum(row, secret)).filter((album): album is IAlbum => album !== undefined);
  }

  public async count(): Promise<number> {
    return this.albumModel.countDocuments().exec();
  }

  public async create(name: string): Promise<IAlbum> {
    const secret = this.secret();
    const row = await this.albumModel.create({ name: encryptText(name, secret), items: [] });

    return this.toAlbum(row, secret)!;
  }

  // Null when the album does not exist.
  public async rename(id: string, name: string): Promise<IAlbum | null> {
    const secret = this.secret();
    const row = await this.albumModel.findById(id).exec();

    if (!row) {
      return null;
    }

    row.name = encryptText(name, secret);
    await row.save();
    return this.toAlbum(row, secret)!;
  }

  public async delete(id: string): Promise<boolean> {
    const result = await this.albumModel.deleteOne({ _id: id }).exec();

    return result.deletedCount > 0;
  }

  // Adds the media (or refreshes its card if it is already there). Null when the album does not exist.
  public async addMedia(id: string, identifier: string, media: IMediaSnapshot): Promise<IAlbum | null> {
    const secret = this.secret();
    const row = await this.albumModel.findById(id).exec();

    if (!row) {
      return null;
    }

    const identifierHash = hashIdentifier(identifier, secret);
    const existing = row.items.find((item) => item.identifierHash === identifierHash);
    const item: AlbumItem = {
      identifierHash,
      identifier: encryptText(identifier, secret),
      title: encryptText(media.title, secret),
      thumbnailSrc: encryptText(JSON.stringify(media.thumbnailSrc), secret),
      previewSrc: encryptText(media.previewSrc ?? '', secret),
      postedAt: encryptText(media.postedAt, secret),
      duration: media.duration,
      addedAt: existing?.addedAt ?? new Date(),
    };

    row.items = existing ? row.items.map((current) => (current.identifierHash === identifierHash ? item : current)) : [...row.items, item];
    await row.save();
    return this.toAlbum(row, secret)!;
  }

  // Null when the album does not exist.
  public async removeMedia(id: string, identifier: string): Promise<IAlbum | null> {
    const secret = this.secret();
    const row = await this.albumModel.findById(id).exec();

    if (!row) {
      return null;
    }

    const identifierHash = hashIdentifier(identifier, secret);

    row.items = row.items.filter((item) => item.identifierHash !== identifierHash);
    await row.save();
    return this.toAlbum(row, secret)!;
  }

  // Decrypts an album; undefined when its name cannot be read. Unreadable items are skipped.
  private toAlbum(row: AlbumModel | AlbumDocument, secret: string): IAlbum | undefined {
    const name = tryDecryptText(row.name, secret);

    if (name === undefined) {
      return undefined;
    }

    const medias = row.items
      .map((item) => this.toMedia(item, secret))
      .filter((media): media is IAlbumMedia => media !== undefined)
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());

    return {
      id: String((row as AlbumModel)._id),
      name,
      createdAt: row.createdAt ?? new Date(0),
      medias,
    };
  }

  private toMedia(item: AlbumItem, secret: string): IAlbumMedia | undefined {
    const identifier = tryDecryptText(item.identifier, secret);

    if (!identifier) {
      return undefined;
    }

    return {
      identifier,
      url: `/media/${identifier}`,
      title: tryDecryptText(item.title, secret) ?? '',
      description: '',
      postedAt: tryDecryptText(item.postedAt, secret) ?? '',
      duration: item.duration ?? 0,
      thumbnailSrc: this.parseThumbnailSrc(tryDecryptText(item.thumbnailSrc, secret)),
      ...this.previewOf(tryDecryptText(item.previewSrc, secret)),
      source: this.centreRegistry.findByURL(decryptShortTokenToURL(identifier) ?? '')?.source,
      addedAt: new Date(item.addedAt),
    };
  }

  private previewOf(raw: string | undefined): Pick<IAlbumMedia, 'previewSrc'> {
    return raw ? { previewSrc: raw } : {};
  }

  private parseThumbnailSrc(raw: string | undefined): string[] {
    try {
      const parsed: unknown = JSON.parse(raw ?? '');
      return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string') ? parsed : [];
    } catch {
      return [];
    }
  }

  private secret(): string {
    return this.configService.getOrThrow<string>('JWT_SECRET');
  }
}
