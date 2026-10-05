import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CentreRegistry } from '../core/centres/centre.registry';
import { decryptShortTokenToURL } from '../shared/url-token';
import type { IAlbum, IAlbumMedia } from '../shared/interfaces/album.interface';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { AlbumDocument, AlbumItem, AlbumModel } from './album.schema';

@Injectable()
export class AlbumRepository {
  constructor(
    @InjectModel(AlbumDocument.name) private readonly albumModel: Model<AlbumDocument>,
    private readonly centreRegistry: CentreRegistry,
  ) {}

  // Loads every album, newest first, with its media newest-added first.
  public async findAll(): Promise<IAlbum[]> {
    const rows = await this.albumModel.find().sort({ createdAt: -1 }).exec();

    return rows.map((row) => this.toAlbum(row)).filter((album): album is IAlbum => album !== undefined);
  }

  public async count(): Promise<number> {
    return this.albumModel.countDocuments().exec();
  }

  public async create(name: string): Promise<IAlbum> {
    const row = await this.albumModel.create({ name, items: [] });

    return this.toAlbum(row)!;
  }

  // Null when the album does not exist.
  public async rename(id: string, name: string): Promise<IAlbum | null> {
    const row = await this.albumModel.findById(id).exec();

    if (!row) {
      return null;
    }

    row.name = name;
    await row.save();
    return this.toAlbum(row)!;
  }

  public async delete(id: string): Promise<boolean> {
    const result = await this.albumModel.deleteOne({ _id: id }).exec();

    return result.deletedCount > 0;
  }

  // Adds the media (or refreshes its card if it is already there). Null when the album does not exist.
  public async addMedia(id: string, identifier: string, media: IMediaSnapshot): Promise<IAlbum | null> {
    const row = await this.albumModel.findById(id).exec();

    if (!row) {
      return null;
    }

    const existing = row.items.find((item) => item.identifier === identifier);
    const item: AlbumItem = {
      identifier,
      title: media.title,
      thumbnailSrc: JSON.stringify(media.thumbnailSrc),
      previewSrc: media.previewSrc ?? '',
      postedAt: media.postedAt,
      duration: media.duration,
      addedAt: existing?.addedAt ?? new Date(),
    };

    row.items = existing ? row.items.map((current) => (current.identifier === identifier ? item : current)) : [...row.items, item];
    await row.save();
    return this.toAlbum(row)!;
  }

  // Null when the album does not exist.
  public async removeMedia(id: string, identifier: string): Promise<IAlbum | null> {
    const row = await this.albumModel.findById(id).exec();

    if (!row) {
      return null;
    }

    row.items = row.items.filter((item) => item.identifier !== identifier);
    await row.save();
    return this.toAlbum(row)!;
  }

  // Maps an album row; undefined when it has no name. Items without an identifier are skipped.
  private toAlbum(row: AlbumModel | AlbumDocument): IAlbum | undefined {
    if (typeof row.name !== 'string') {
      return undefined;
    }

    const medias = row.items
      .map((item) => this.toMedia(item))
      .filter((media): media is IAlbumMedia => media !== undefined)
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());

    return {
      id: String((row as AlbumModel)._id),
      name: row.name,
      createdAt: row.createdAt ?? new Date(0),
      medias,
    };
  }

  private toMedia(item: AlbumItem): IAlbumMedia | undefined {
    if (!item.identifier) {
      return undefined;
    }

    return {
      identifier: item.identifier,
      url: `/media/${item.identifier}`,
      title: item.title ?? '',
      description: '',
      postedAt: item.postedAt ?? '',
      duration: item.duration ?? 0,
      thumbnailSrc: this.parseThumbnailSrc(item.thumbnailSrc),
      ...this.previewOf(item.previewSrc),
      source: this.centreRegistry.findByURL(decryptShortTokenToURL(item.identifier) ?? '')?.source,
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
}
