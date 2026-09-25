// True when the value is a string.
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

// True when the value is a string that parses to a finite number.
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

// True when the value is a finite number (not NaN or Infinity).
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// True when the value is any number, including NaN and Infinity.
export function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

// True when the value is an integer.
export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

// True when the value is a boolean.
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

// True when the value is a non-null object.
export function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

// True when the value is a plain object, not an array or class instance.
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value) || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// True when the value is an array.
export function isArray<T = unknown>(value: unknown): value is T[] {
  return Array.isArray(value);
}

// True when the value is not undefined.
export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// True when the value is null.
export function isNull(value: unknown): value is null {
  return value === null;
}

// True when the value is null or undefined.
export function isNullish(value: unknown): value is null | undefined {
  return value == null;
}

// True when the value is neither null nor undefined.
export function isNonNullish<T>(value: T | null | undefined): value is T {
  return value != null;
}

// True when the value is empty: blank string, empty collection, or empty object.
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

// True when the value is a string with at least one non-space character.
export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

// Parses a string or number to an integer, or undefined if it is not a clean integer.
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
