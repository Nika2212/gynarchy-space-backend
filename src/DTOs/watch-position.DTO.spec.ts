import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WatchPositionDTO } from './watch-position.DTO';

const MEDIA = { title: 't', duration: 1, postedAt: '', thumbnailSrc: ['/images/a'] };

describe('WatchPositionDTO', () => {
  it('accepts a position with a valid card', async () => {
    const dto = plainToInstance(WatchPositionDTO, { watchPositionAt: 30_000, media: MEDIA });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a negative position or an invalid card', async () => {
    const dto = plainToInstance(WatchPositionDTO, { watchPositionAt: -1, media: { ...MEDIA, thumbnailSrc: [1] } });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual(['media', 'watchPositionAt']);
  });
});
