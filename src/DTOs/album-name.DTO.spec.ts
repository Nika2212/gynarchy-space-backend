import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AlbumNameDTO } from './album-name.DTO';

describe('AlbumNameDTO', () => {
  it('trims the name and accepts it', async () => {
    const dto = plainToInstance(AlbumNameDTO, { name: '  Road trip  ' });
    expect(dto.name).toBe('Road trip');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects empty, too long, and non-string names', async () => {
    for (const name of ['   ', 'x'.repeat(61), 42]) {
      const [error] = await validate(plainToInstance(AlbumNameDTO, { name }));
      expect(error.property).toBe('name');
    }
  });
});
