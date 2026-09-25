import { timeToMS } from './time';

describe('timeToMS', () => {
  it('returns 0 for a blank clock string', () => {
    expect(timeToMS('')).toBe(0);
  });

  it('parses seconds, minutes, and hours', () => {
    expect(timeToMS('5')).toBe(5000);
    expect(timeToMS('1:23')).toBe(83000);
    expect(timeToMS('1:02:03')).toBe(3723000);
  });

  it('ignores extra segments and non-numeric parts', () => {
    expect(timeToMS('1:02:03:04')).toBe(7384000);
    expect(timeToMS('x:2')).toBe(2000);
  });
});
