import { decryptText, encryptText, hashIdentifier, tryDecryptText } from './field-crypto';

describe('field-crypto', () => {
  const secret = 'test-data-secret';

  it('round-trips text', () => {
    const encrypted = encryptText('https://cdn.example.com/a.mp4', secret);
    expect(encrypted).not.toContain('https://');
    expect(decryptText(encrypted, secret)).toBe('https://cdn.example.com/a.mp4');
  });

  it('produces different ciphertext for the same plaintext', () => {
    expect(encryptText('title', secret)).not.toBe(encryptText('title', secret));
  });

  it('fails to decrypt with the wrong secret', () => {
    const encrypted = encryptText('secret-title', secret);
    expect(() => decryptText(encrypted, 'other-secret')).toThrow();
  });

  it('hashes identifiers deterministically', () => {
    expect(hashIdentifier('abc', secret)).toBe(hashIdentifier('abc', secret));
    expect(hashIdentifier('abc', secret)).not.toBe(hashIdentifier('abc', 'other'));
    expect(hashIdentifier('abc', secret)).not.toBe('abc');
  });

  it('tryDecryptText returns undefined for junk', () => {
    expect(tryDecryptText('not-cipher', secret)).toBeUndefined();
    expect(tryDecryptText('', secret)).toBeUndefined();
    expect(tryDecryptText(null, secret)).toBeUndefined();
    expect(tryDecryptText(undefined, secret)).toBeUndefined();
  });

  it('decryptText rejects a payload that is too short', () => {
    expect(() => decryptText(Buffer.from('short').toString('base64url'), secret)).toThrow(
      'Invalid encrypted payload',
    );
  });
});
