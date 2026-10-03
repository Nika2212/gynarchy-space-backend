import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { AlbumRepository } from '../repositories/album.repository';
import type { IAlbum, IAlbumList } from '../shared/interfaces/album.interface';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { decryptShortTokenToURL } from '../shared/url-token';

export const MAX_ALBUMS = 100;

@Injectable()
export class AlbumService {
  constructor(private readonly albumRepository: AlbumRepository) {}

  public async findAll(): Promise<IAlbumList> {
    return { albums: await this.albumRepository.findAll() };
  }

  // Rejects new albums past MAX_ALBUMS.
  public async create(name: string): Promise<IAlbum> {
    if ((await this.albumRepository.count()) >= MAX_ALBUMS) {
      throw new BadRequestException(`An account can have at most ${MAX_ALBUMS} albums`);
    }

    return this.albumRepository.create(name);
  }

  public async rename(id: string, name: string): Promise<IAlbum> {
    this.assertAlbumID(id);
    return this.found(await this.albumRepository.rename(id, name));
  }

  public async delete(id: string): Promise<void> {
    this.assertAlbumID(id);

    if (!(await this.albumRepository.delete(id))) {
      throw new NotFoundException('Album not found');
    }
  }

  public async addMedia(id: string, mediaID: string, media: IMediaSnapshot): Promise<IAlbum> {
    this.assertAlbumID(id);
    this.assertMediaID(mediaID);
    return this.found(await this.albumRepository.addMedia(id, mediaID, media));
  }

  public async removeMedia(id: string, mediaID: string): Promise<IAlbum> {
    this.assertAlbumID(id);
    this.assertMediaID(mediaID);
    return this.found(await this.albumRepository.removeMedia(id, mediaID));
  }

  private found(album: IAlbum | null): IAlbum {
    if (!album) {
      throw new NotFoundException('Album not found');
    }

    return album;
  }

  private assertAlbumID(id: string): void {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Album not found');
    }
  }

  private assertMediaID(id: string): void {
    if (!id || !decryptShortTokenToURL(id)) {
      throw new NotFoundException('Invalid media id');
    }
  }
}
