// Throws if the value is not an absolute http(s) URL.
export function assertValidHTTPURL(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error();
    }
  } catch {
    throw new TypeError('Expected a valid absolute http(s) URL');
  }
}

// Encodes an origin URL into a short base64url token used as a media id.
export function encryptURLToShortToken(url: string): string {
  const normalized = url.trim();
  if (normalized === '') {
    throw new TypeError('URL must be a non-empty string');
  }
  assertValidHTTPURL(normalized);
  return Buffer.from(normalized, 'utf8').toString('base64url');
}

// Decodes a short token back to the origin URL, or undefined if it is invalid.
export function decryptShortTokenToURL(token: string): string | undefined {
  const t = token.trim();
  if (t === '') {
    return undefined;
  }
  try {
    const decoded = Buffer.from(t, 'base64url').toString('utf8');
    assertValidHTTPURL(decoded);
    return decoded;
  } catch {
    return undefined;
  }
}
