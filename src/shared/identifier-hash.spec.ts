import { hashIdentifier } from './identifier-hash';

describe('hashIdentifier', () => {
  const secret = 'test-data-secret';

  it('is stable for the same secret and differs per secret', () => {
    expect(hashIdentifier('abc', secret)).toBe(hashIdentifier('abc', secret));
    expect(hashIdentifier('abc', secret)).not.toBe(hashIdentifier('abc', 'other'));
    expect(hashIdentifier('abc', secret)).not.toBe('abc');
  });
});
