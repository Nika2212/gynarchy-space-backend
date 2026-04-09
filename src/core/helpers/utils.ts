import { customAlphabet } from 'nanoid';

/** `typeof value === 'string'` */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Non-empty string whose trimmed value parses to a finite number (e.g. `'1'`, `'-2'`, `'3.14'`).
 */
export function isNumberedString(value: unknown): value is string {
  if (!isString(value)) {
    return false;
  }
  const t = value.trim();
  if (t === '') {
    return false;
  }
  const n = Number(t);
  if (Number.isNaN(n)) {
    return false;
  }
  return Number.isFinite(n);
}

/** Finite number (excludes `NaN`, `Infinity`, `-Infinity`). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Any `typeof value === 'number'` (includes `NaN`). Prefer `isFiniteNumber` for validation. */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/** Any non-null object (`object` or `function`), including arrays, `Date`, etc. */
export function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/** Plain record created from `{}` or `Object.create(null)` — not arrays, dates, etc. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value) || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isArray<T = unknown>(value: unknown): value is T[] {
  return Array.isArray(value);
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function isNull(value: unknown): value is null {
  return value === null;
}

export function isNullish(value: unknown): value is null | undefined {
  return value == null;
}

/** Not `null` and not `undefined`. */
export function isNonNullish<T>(value: T | null | undefined): value is T {
  return value != null;
}

/**
 * Empty: `null`, `undefined`, `""`, whitespace-only strings, `[]`, `{}`,
 * `Map` / `Set` with size 0. Other values (numbers, booleans, `Date`, class instances) are not empty.
 */
export function isEmpty(value: unknown): boolean {
  if (isNullish(value)) {
    return true;
  }
  if (isString(value)) {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size === 0;
  }
  if (isPlainObject(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

/** Safe integer from string (e.g. query params). Returns `undefined` if not a valid integer in range. */
export function parseIntStrict(value: unknown, radix = 10): number | undefined {
  if (!isString(value) && !isFiniteNumber(value)) {
    return undefined;
  }
  const s = isString(value) ? value.trim() : String(value);
  if (s === '') {
    return undefined;
  }
  const n = Number.parseInt(s, radix);
  if (!Number.isInteger(n) || !Number.isFinite(n)) {
    return undefined;
  }
  return n;
}

/** Base62 tokens (8 chars ≈ 218 trillion space before heavy collision risk). */
const SHORT_TOKEN_LENGTH = 12;
const mintShortToken = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', SHORT_TOKEN_LENGTH);

const urlByToken = new Map<string, string>();
const tokenByUrl = new Map<string, string>();

function assertValidHttpUrl(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error();
    }
  } catch {
    throw new TypeError('Expected a valid absolute http(s) URL');
  }
}

function issueUniqueToken(): string {
  for (let i = 0; i < 128; i += 1) {
    const t = mintShortToken();
    if (!urlByToken.has(t)) {
      return t;
    }
  }
  throw new Error('Short token mint failed: too many collisions');
}

/**
 * Registers a URL and returns a short random id (nanoid). Same URL reuses the same id.
 * This is **not** cryptographic encryption: the full URL is kept in an in-memory map.
 * For production, persist `token ↔ url` in Redis/DB instead of this module-level store.
 */
export function encryptUrlToShortToken(url: string): string {
  const normalized = url.trim();
  if (normalized === '') {
    throw new TypeError('URL must be a non-empty string');
  }
  assertValidHttpUrl(normalized);

  const existing = tokenByUrl.get(normalized);
  if (existing !== undefined) {
    return existing;
  }

  const token = issueUniqueToken();
  urlByToken.set(token, normalized);
  tokenByUrl.set(normalized, token);
  return token;
}

/** Resolves a token from {@link encryptUrlToShortToken} back to the URL, or `undefined` if unknown. */
export function decryptShortTokenToUrl(token: string): string | undefined {
  const t = token.trim();
  if (t === '') {
    return undefined;
  }
  return urlByToken.get(t);
}
