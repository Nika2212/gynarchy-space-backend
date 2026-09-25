import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// Derives a 32-byte AES key from the app secret.
function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

// Encrypts a string with AES-256-GCM and returns a base64url payload.
export function encryptText(plain: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

// Decrypts an AES-256-GCM payload back to plaintext.
export function decryptText(payload: string, secret: string): string {
  const buffer = Buffer.from(payload, 'base64url');
  if (buffer.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted payload');
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const data = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// Builds a stable HMAC lookup key for a media identifier.
export function hashIdentifier(identifier: string, secret: string): string {
  return createHmac('sha256', secret).update(identifier, 'utf8').digest('hex');
}

// Decrypts a stored field, or returns undefined if the payload is missing or corrupt.
export function tryDecryptText(payload: string | null | undefined, secret: string): string | undefined {
  if (typeof payload !== 'string' || payload.trim() === '') {
    return undefined;
  }

  try {
    return decryptText(payload, secret);
  } catch {
    return undefined;
  }
}
