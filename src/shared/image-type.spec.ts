import { isPrivateIP, isPublicHTTPHost, isSameSiteHost, normalizeAllowedImageType } from './image-type';

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

  it('rejects a www-only origin with an empty root', () => {
    expect(isSameSiteHost('evil.com', 'www.')).toBe(false);
  });
});

describe('isPrivateIP', () => {
  it('detects IPv6 loopback, unique-local, and link-local', () => {
    expect(isPrivateIP('::1')).toBe(true);
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd12::1')).toBe(true);
    expect(isPrivateIP('fe80::1')).toBe(true);
    expect(isPrivateIP('2001:db8::1')).toBe(false);
  });

  it('detects IPv4 private, loopback, and link-local ranges', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
    expect(isPrivateIP('10.1.2.3')).toBe(true);
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('169.254.1.1')).toBe(true);
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.1')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('172.32.0.1')).toBe(false);
  });

  it('treats malformed IPv4 as private', () => {
    expect(isPrivateIP('1.2.3')).toBe(true);
    expect(isPrivateIP('1.2.3.4.5')).toBe(true);
    expect(isPrivateIP('1.2.3.x')).toBe(true);
  });
});

describe('isPublicHTTPHost', () => {
  it('rejects localhost and private IPs', () => {
    expect(isPublicHTTPHost('localhost')).toBe(false);
    expect(isPublicHTTPHost('app.localhost')).toBe(false);
    expect(isPublicHTTPHost('::1')).toBe(false);
    expect(isPublicHTTPHost('[::1]')).toBe(false);
    expect(isPublicHTTPHost('127.0.0.1')).toBe(false);
    expect(isPublicHTTPHost('10.0.0.1')).toBe(false);
  });

  it('allows public hosts and public IPs', () => {
    expect(isPublicHTTPHost('cdn.example.com')).toBe(true);
    expect(isPublicHTTPHost('8.8.8.8')).toBe(true);
  });
});
