import { decryptShortTokenToURL, encryptURLToShortToken } from './url-token';

describe('encryptURLToShortToken / decryptShortTokenToURL (base64url)', () => {
  const uniqueURL = (n: number) => `https://example.com/t/${Date.now()}-${n}-${Math.random()}`;

  it('throws TypeError for empty or whitespace-only input', () => {
    expect(() => encryptURLToShortToken('')).toThrow(TypeError);
    expect(() => encryptURLToShortToken('   ')).toThrow('URL must be a non-empty string');
  });

  it('throws TypeError for non-http(s) URLs', () => {
    expect(() => encryptURLToShortToken('ftp://example.com/a')).toThrow(TypeError);
    expect(() => encryptURLToShortToken('file:///tmp/x')).toThrow(TypeError);
    expect(() => encryptURLToShortToken('not a url')).toThrow(TypeError);
  });

  it('is deterministic for the same URL', () => {
    const url = uniqueURL(2);
    const a = encryptURLToShortToken(url);
    const b = encryptURLToShortToken(url);
    expect(a).toBe(b);
  });

  it('round-trips URL via token (no dictionary)', () => {
    const url = uniqueURL(10);
    const token = encryptURLToShortToken(url);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(decryptShortTokenToURL(token)).toBe(url);
  });

  it('trims URL before encrypt', () => {
    const url = uniqueURL(3);
    const spaced = `  ${url}  `;
    const token = encryptURLToShortToken(spaced);
    expect(token).toBe(encryptURLToShortToken(url.trim()));
    expect(decryptShortTokenToURL(token)).toBe(url.trim());
  });

  it('decryptShortTokenToURL returns undefined for blank, garbage, or non-url token', () => {
    expect(decryptShortTokenToURL('')).toBeUndefined();
    expect(decryptShortTokenToURL('   ')).toBeUndefined();
    expect(decryptShortTokenToURL('not-valid-base64url!!!')).toBeUndefined();
    expect(decryptShortTokenToURL(Buffer.from('nope', 'utf8').toString('base64url'))).toBeUndefined();
  });
});
