import { createHmac } from 'crypto';

// Stable HMAC of a media identifier. Used for bucket object keys, so the bucket listing reveals nothing about the video.
export function hashIdentifier(identifier: string, secret: string): string {
  return createHmac('sha256', secret).update(identifier, 'utf8').digest('hex');
}
