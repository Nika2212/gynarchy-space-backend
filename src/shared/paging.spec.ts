import { parsePage, PER_PAGE_SIZE } from './paging';

describe('paging', () => {
  it('uses 24 items per page', () => {
    expect(PER_PAGE_SIZE).toBe(24);
  });

  it('keeps positive integers and defaults the rest to 1', () => {
    expect(parsePage(3)).toBe(3);
    expect(parsePage('2')).toBe(2);
    expect(parsePage(' 4 ')).toBe(4);
    expect(parsePage(0)).toBe(1);
    expect(parsePage(-1)).toBe(1);
    expect(parsePage(1.5)).toBe(1);
    expect(parsePage('nope')).toBe(1);
    expect(parsePage('')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});
