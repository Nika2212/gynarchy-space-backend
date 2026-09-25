import { safeEqual } from './timing-safe';

describe('safeEqual', () => {
  it('returns true for equal strings', () => {
    expect(safeEqual('0000', '0000')).toBe(true);
  });

  it('returns false for different lengths or content', () => {
    expect(safeEqual('0000', '000')).toBe(false);
    expect(safeEqual('0000', '0001')).toBe(false);
  });
});
