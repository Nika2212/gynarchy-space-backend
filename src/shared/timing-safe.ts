import { timingSafeEqual } from 'node:crypto';

// Compares two strings in constant time so length and content are not leaked.
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
