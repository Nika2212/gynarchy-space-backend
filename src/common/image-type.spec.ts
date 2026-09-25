import { isSameSiteHost, normalizeAllowedImageType } from './image-type';

describe('normalizeAllowedImageType', () => {
  it('allows raster image types and strips parameters', () => {
    expect(normalizeAllowedImageType('image/jpeg; charset=utf-8')).toBe('image/jpeg');
    expect(normalizeAllowedImageType('image/JPG')).toBe('image/jpeg');
    expect(normalizeAllowedImageType('image/png')).toBe('image/png');
    expect(normalizeAllowedImageType('image/webp')).toBe('image/webp');
  });

  it('rejects HTML, SVG, and missing types', () => {
    expect(normalizeAllowedImageType('text/html')).toBeUndefined();
    expect(normalizeAllowedImageType('image/svg+xml')).toBeUndefined();
    expect(normalizeAllowedImageType('application/octet-stream')).toBeUndefined();
    expect(normalizeAllowedImageType(undefined)).toBeUndefined();
  });
});

describe('isSameSiteHost', () => {
  it('allows the origin host and sibling subdomains', () => {
    expect(isSameSiteHost('tube.example.com', 'tube.example.com')).toBe(true);
    expect(isSameSiteHost('cdn.example.com', 'www.example.com')).toBe(true);
    expect(isSameSiteHost('example.com', 'www.example.com')).toBe(true);
  });

  it('rejects unrelated hosts', () => {
    expect(isSameSiteHost('evil.com', 'example.com')).toBe(false);
    expect(isSameSiteHost('example.com.evil.com', 'example.com')).toBe(false);
    expect(isSameSiteHost('notexample.com', 'example.com')).toBe(false);
  });
});
