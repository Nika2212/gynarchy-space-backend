import { WatchPositionDTO } from './watch-position.DTO';

describe('WatchPositionDTO', () => {
  it('holds a watchPositionAt field', () => {
    const dto = new WatchPositionDTO();
    dto.watchPositionAt = 30_000;
    expect(dto.watchPositionAt).toBe(30_000);
  });
});
