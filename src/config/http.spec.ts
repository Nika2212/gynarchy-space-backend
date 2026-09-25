import { parseCorsOrigins, resolveTrustProxy } from './http';

describe('parseCorsOrigins', () => {
  it('splits and trims a comma-separated allowlist', () => {
    expect(parseCorsOrigins('http://localhost:4200, https://app.example.com')).toEqual([
      'http://localhost:4200',
      'https://app.example.com',
    ]);
  });

  it('returns an empty list for blank input', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('  ,  ')).toEqual([]);
  });
});

describe('resolveTrustProxy', () => {
  it('treats unset/falsey values as disabled', () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy('0')).toBe(false);
    expect(resolveTrustProxy('false')).toBe(false);
  });

  it('accepts hop count or true', () => {
    expect(resolveTrustProxy('true')).toBe(1);
    expect(resolveTrustProxy('2')).toBe(2);
  });
});
