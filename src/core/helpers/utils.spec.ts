import {
  decryptShortTokenToUrl,
  encryptUrlToShortToken,
  isArray,
  isBoolean,
  isDefined,
  isEmpty,
  isFiniteNumber,
  isInteger,
  isNonEmptyString,
  isNonNullish,
  isNull,
  isNullish,
  isNumber,
  isNumberedString,
  isObject,
  isPlainObject,
  isString,
  parseIntStrict,
} from './utils';

describe('isString', () => {
  it('returns true for strings', () => {
    expect(isString('')).toBe(true);
    expect(isString('a')).toBe(true);
  });

  it('returns false for non-strings', () => {
    expect(isString(0)).toBe(false);
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
    expect(isString({})).toBe(false);
  });
});

describe('isNumberedString', () => {
  it('returns true for trimmed finite numeric strings', () => {
    expect(isNumberedString('1')).toBe(true);
    expect(isNumberedString('  -2.5  ')).toBe(true);
    expect(isNumberedString('0')).toBe(true);
  });

  it('returns false when value is not a string', () => {
    expect(isNumberedString(1)).toBe(false);
    expect(isNumberedString(null)).toBe(false);
  });

  it('returns false for empty or whitespace-only', () => {
    expect(isNumberedString('')).toBe(false);
    expect(isNumberedString('   ')).toBe(false);
  });

  it('returns false when Number is NaN', () => {
    expect(isNumberedString('not-a-number')).toBe(false);
  });

  it('returns false when not finite', () => {
    expect(isNumberedString('Infinity')).toBe(false);
    expect(isNumberedString('-Infinity')).toBe(false);
  });
});

describe('isFiniteNumber', () => {
  it('returns true only for finite numbers', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1.5)).toBe(true);
    expect(isFiniteNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('returns false for NaN and non-finite', () => {
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber(Number.NEGATIVE_INFINITY)).toBe(false);
  });

  it('returns false for non-numbers', () => {
    expect(isFiniteNumber('1')).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
  });
});

describe('isNumber', () => {
  it('returns true for any number type including NaN', () => {
    expect(isNumber(1)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(true);
    expect(isNumber(Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('returns false for non-numbers', () => {
    expect(isNumber('1')).toBe(false);
    expect(isNumber(null)).toBe(false);
  });
});

describe('isInteger', () => {
  it('returns true for integers', () => {
    expect(isInteger(0)).toBe(true);
    expect(isInteger(-3)).toBe(true);
  });

  it('returns false for floats and non-integers', () => {
    expect(isInteger(1.2)).toBe(false);
    expect(isInteger(Number.NaN)).toBe(false);
    expect(isInteger('1')).toBe(false);
  });
});

describe('isBoolean', () => {
  it('returns true for booleans only', () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean('true')).toBe(false);
  });
});

describe('isObject', () => {
  it('returns true for non-null objects and arrays', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(true);
    expect(isObject(new Date())).toBe(true);
  });

  it('returns false for null and primitives', () => {
    expect(isObject(null)).toBe(false);
    expect(isObject(undefined)).toBe(false);
    expect(isObject(1)).toBe(false);
  });

  it('returns false for functions (typeof function is not object)', () => {
    expect(isObject(() => {})).toBe(false);
  });
});

describe('isPlainObject', () => {
  it('returns true for plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('returns false for arrays and null', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });

  it('returns false for built-in class instances', () => {
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
  });
});

describe('isArray', () => {
  it('delegates to Array.isArray', () => {
    expect(isArray([])).toBe(true);
    expect(isArray([1])).toBe(true);
    expect(isArray({})).toBe(false);
  });
});

describe('isDefined', () => {
  it('returns false only for undefined', () => {
    expect(isDefined(0)).toBe(true);
    expect(isDefined(null)).toBe(true);
    expect(isDefined(undefined)).toBe(false);
  });
});

describe('isNull', () => {
  it('returns true only for null', () => {
    expect(isNull(null)).toBe(true);
    expect(isNull(undefined)).toBe(false);
    expect(isNull(0)).toBe(false);
  });
});

describe('isNullish', () => {
  it('returns true for null and undefined', () => {
    expect(isNullish(null)).toBe(true);
    expect(isNullish(undefined)).toBe(true);
    expect(isNullish(0)).toBe(false);
    expect(isNullish('')).toBe(false);
  });
});

describe('isNonNullish', () => {
  it('returns false for null and undefined', () => {
    expect(isNonNullish(null)).toBe(false);
    expect(isNonNullish(undefined)).toBe(false);
  });

  it('returns true for other values', () => {
    expect(isNonNullish(0)).toBe(true);
    expect(isNonNullish('')).toBe(true);
  });
});

describe('isEmpty', () => {
  it('treats null and undefined as empty', () => {
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty(undefined)).toBe(true);
  });

  it('treats blank strings as empty', () => {
    expect(isEmpty('')).toBe(true);
    expect(isEmpty('  \t')).toBe(true);
  });

  it('treats empty array, plain object, Map, Set as empty', () => {
    expect(isEmpty([])).toBe(true);
    expect(isEmpty({})).toBe(true);
    expect(isEmpty(new Map())).toBe(true);
    expect(isEmpty(new Set())).toBe(true);
  });

  it('returns false for non-empty collections and strings', () => {
    expect(isEmpty('a')).toBe(false);
    expect(isEmpty([0])).toBe(false);
    expect(isEmpty({ a: 1 })).toBe(false);
    expect(isEmpty(new Map([['k', 'v']]))).toBe(false);
    expect(isEmpty(new Set([1]))).toBe(false);
  });

  it('returns false for numbers, booleans, Date, and class instances', () => {
    expect(isEmpty(0)).toBe(false);
    expect(isEmpty(false)).toBe(false);
    expect(isEmpty(new Date())).toBe(false);
    expect(isEmpty(Object.assign(Object.create(null), { x: 1 }))).toBe(false);
  });
});

describe('isNonEmptyString', () => {
  it('returns true only for non-blank strings', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString(' a ')).toBe(true);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString(1)).toBe(false);
  });
});

describe('parseIntStrict', () => {
  it('parses integer strings with default radix 10', () => {
    expect(parseIntStrict('42')).toBe(42);
    expect(parseIntStrict('  -7  ')).toBe(-7);
  });

  it('parses finite numbers by stringifying', () => {
    expect(parseIntStrict(99)).toBe(99);
    expect(parseIntStrict(-3)).toBe(-3);
  });

  it('returns undefined when value is neither string nor finite number', () => {
    expect(parseIntStrict(undefined)).toBeUndefined();
    expect(parseIntStrict(null)).toBeUndefined();
    expect(parseIntStrict({})).toBeUndefined();
    expect(parseIntStrict(Number.NaN)).toBeUndefined();
    expect(parseIntStrict(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('returns undefined for empty trimmed string', () => {
    expect(parseIntStrict('')).toBeUndefined();
    expect(parseIntStrict('   ')).toBeUndefined();
  });

  it('returns undefined when parseInt yields NaN or non-integer', () => {
    expect(parseIntStrict('notint')).toBeUndefined();
    expect(parseIntStrict('---')).toBeUndefined();
  });

  it('documents that decimal strings parse as truncated integers (parseInt behavior)', () => {
    expect(parseIntStrict('12.34')).toBe(12);
  });

  it('respects radix', () => {
    expect(parseIntStrict('ff', 16)).toBe(255);
    expect(parseIntStrict('10', 2)).toBe(2);
  });
});

describe('encryptUrlToShortToken / decryptShortTokenToUrl', () => {
  const uniqueUrl = (n: number) => `https://example.com/t/${Date.now()}-${n}-${Math.random()}`;

  it('throws TypeError for empty or whitespace-only input', () => {
    expect(() => encryptUrlToShortToken('')).toThrow(TypeError);
    expect(() => encryptUrlToShortToken('   ')).toThrow('URL must be a non-empty string');
  });

  it('throws TypeError for non-http(s) URLs', () => {
    expect(() => encryptUrlToShortToken('ftp://example.com/a')).toThrow(TypeError);
    expect(() => encryptUrlToShortToken('file:///tmp/x')).toThrow(TypeError);
    expect(() => encryptUrlToShortToken('not a url')).toThrow(TypeError);
  });

  it('returns a token and decryptShortTokenToUrl resolves it', () => {
    const url = uniqueUrl(1);
    const token = encryptUrlToShortToken(url);
    expect(typeof token).toBe('string');
    expect(token.length).toBe(12);
    expect(decryptShortTokenToUrl(token)).toBe(url);
  });

  it('reuses the same token for the same URL', () => {
    const url = uniqueUrl(2);
    expect(encryptUrlToShortToken(url)).toBe(encryptUrlToShortToken(url));
  });

  it('decryptShortTokenToUrl returns undefined for unknown or blank token', () => {
    expect(decryptShortTokenToUrl('')).toBeUndefined();
    expect(decryptShortTokenToUrl('   ')).toBeUndefined();
    expect(decryptShortTokenToUrl('noSuchToken12345678901')).toBeUndefined();
  });

  it('trims URL before storing', () => {
    const url = uniqueUrl(3);
    const spaced = `  ${url}  `;
    const token = encryptUrlToShortToken(spaced);
    expect(decryptShortTokenToUrl(token)).toBe(url.trim());
  });

  it('decryptShortTokenToUrl trims token', () => {
    const url = uniqueUrl(4);
    const token = encryptUrlToShortToken(url);
    expect(decryptShortTokenToUrl(`  ${token}  `)).toBe(url);
  });
});

describe('issueUniqueToken collision exhaustion', () => {
  it('throws when mint always returns an existing token', () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nanoid = require('nanoid') as typeof import('nanoid');
    const spy = jest.spyOn(nanoid, 'customAlphabet').mockReturnValue(() => 'fixedCollisionToken');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const utils = require('./utils') as typeof import('./utils');

    const u1 = `https://collision.test/${Date.now()}-a`;
    const u2 = `https://collision.test/${Date.now()}-b`;

    utils.encryptUrlToShortToken(u1);
    expect(() => utils.encryptUrlToShortToken(u2)).toThrow('Short token mint failed: too many collisions');

    spy.mockRestore();
    jest.resetModules();
  });
});
