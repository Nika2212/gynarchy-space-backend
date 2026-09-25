import { isIP } from 'node:net';

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);

// Returns a safe raster Content-Type, or undefined if the header is not allowed.
export function normalizeAllowedImageType(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const type = header.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    return undefined;
  }

  return type === 'image/jpg' ? 'image/jpeg' : type;
}

// True when the target host is the origin host or one of its subdomains.
export function isSameSiteHost(targetHost: string, originHost: string): boolean {
  const target = targetHost.toLowerCase();
  const origin = originHost.toLowerCase();

  if (target === origin) {
    return true;
  }

  const root = origin.startsWith('www.') ? origin.slice(4) : origin;
  if (root.length === 0) {
    return false;
  }

  return target === root || target.endsWith(`.${root}`);
}

// True for loopback, link-local, and private IPv4/IPv6 addresses.
export function isPrivateIP(host: string): boolean {
  if (host.includes(':')) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
  }

  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

// True when the hostname is a public host we may fetch over HTTP.
export function isPublicHTTPHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
    return false;
  }

  return !(isIP(host) && isPrivateIP(host));
}
