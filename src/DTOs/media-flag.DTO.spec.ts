import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MediaFlagDTO } from './media-flag.DTO';
import { MediaSnapshotDTO } from './media-snapshot.DTO';

const MEDIA = { title: 't', duration: 1, postedAt: '', thumbnailSrc: ['/images/a'] };

describe('MediaFlagDTO', () => {
  it('turns the card into a MediaSnapshotDTO and accepts it', async () => {
    const dto = plainToInstance(MediaFlagDTO, { media: MEDIA });
    expect(dto.media).toBeInstanceOf(MediaSnapshotDTO);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a card with bad fields', async () => {
    const dto = plainToInstance(MediaFlagDTO, { media: { title: 1, duration: -1, postedAt: '', thumbnailSrc: 'x' } });
    const [error] = await validate(dto);
    expect(error.children?.map((child) => child.property).sort()).toEqual(['duration', 'thumbnailSrc', 'title']);
  });
});
