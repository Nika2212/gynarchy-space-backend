const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);

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
