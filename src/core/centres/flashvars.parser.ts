import * as cheerio from 'cheerio';

class FlashvarsParseError extends Error {
  // Builds a parse error for invalid or missing flashvars.
  constructor(message: string) {
    super(message);
    this.name = 'FlashvarsParseError';
  }
}

const DEFAULT_FLASHVARS_NAME = 'flashvars';
// kt_player('kt_player', swf, width, height, <flashvars variable>); some sites rename the variable on every page load.
const KT_PLAYER_CALL =
  /kt_player\s*\(\s*(['"])[^'"]*\1\s*,\s*(['"])[^'"]*\2\s*,\s*(['"])[^'"]*\3\s*,\s*(['"])[^'"]*\4\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;

// Finds flashvars in page HTML and parses them into a plain object.
export function parseFlashvarsFromHtml(html: string): Record<string, unknown> {
  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new FlashvarsParseError('flashvars not found');
  }

  const assignments = findFlashvarsNames(html).map(toAssignPattern);

  for (const source of collectFlashvarsSources(html, assignments)) {
    for (const assignment of assignments) {
      const literal = extractFlashvarsObjectLiteral(source, assignment);
      if (!literal) {
        continue;
      }

      const parsed = parseFlashvarsObjectLiteral(literal);
      if (parsed) {
        return parsed;
      }
    }
  }

  throw new FlashvarsParseError('flashvars not found');
}

// Lists the variable names passed to kt_player, then the conventional `flashvars`.
function findFlashvarsNames(html: string): string[] {
  const names = Array.from(html.matchAll(KT_PLAYER_CALL), (match) => match[5]);
  return [...new Set([...names, DEFAULT_FLASHVARS_NAME])];
}

// Builds a matcher for `var <name> = {`, `window.<name> = {`, or `<name> = {`.
function toAssignPattern(name: string): RegExp {
  const escaped = name.replace(/\$/g, '\\$');
  return new RegExp(`(?:(?:var|let|const)\\s+)?(?:window\\.)?(?<![\\w$])${escaped}\\s*=\\s*\\{`, 'i');
}

// Collects script bodies that look like they assign flashvars.
function collectFlashvarsSources(html: string, assignments: RegExp[]): string[] {
  const $ = cheerio.load(html);
  const sources: string[] = [];

  $('script').each((_, el) => {
    const text = $(el).html();
    if (text && assignments.some((assignment) => assignment.test(text))) {
      sources.push(text);
    }
  });

  if (sources.length === 0) {
    sources.push(html);
  }

  return sources;
}

// Cuts the `{ ... }` object literal out of a flashvars assignment.
function extractFlashvarsObjectLiteral(source: string, assignment: RegExp): string | null {
  const match = source.match(assignment);
  if (!match || match.index === undefined) {
    return null;
  }

  const braceAt = match.index + match[0].length - 1;
  return extractBalancedObject(source, braceAt);
}

// Returns the balanced `{ ... }` slice starting at the given brace.
export function extractBalancedObject(source: string, start: number): string | null {
  if (source[start] !== '{') {
    return null;
  }

  let depth = 0;
  let inString: '"' | "'" | null = null;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }

    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

// Parses a flashvars object as JSON, then as a JS object literal if needed.
function parseFlashvarsObjectLiteral(literal: string): Record<string, unknown> | null {
  try {
    const json = JSON.parse(literal) as unknown;
    if (isPlainRecord(json)) {
      return json;
    }
  } catch {
    /* JS object literal */
  }

  try {
    const parser = new FlashvarsLiteralParser(literal);
    return parser.parseRootObject();
  } catch {
    return null;
  }
}

// True when the value is a plain object, not an array or null.
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class FlashvarsLiteralParser {
  private i = 0;

  // Holds the flashvars literal and a cursor used while parsing it.
  constructor(private readonly src: string) {}

  // Parses the whole source as one object and rejects leftover text.
  public parseRootObject(): Record<string, unknown> {
    const value = this.parseValue();
    this.skipWs();
    if (this.i !== this.src.length) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    if (!isPlainRecord(value)) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    return value;
  }

  // Parses the next JSON-like value: object, array, string, number, or keyword.
  private parseValue(): unknown {
    this.skipWs();
    const ch = this.src[this.i];

    if (ch === '{') {
      return this.parseObject();
    }
    if (ch === '[') {
      return this.parseArray();
    }
    if (ch === '"' || ch === "'") {
      return this.parseString();
    }
    if (ch === '-' || this.isDigit(ch)) {
      return this.parseNumber();
    }
    if (this.src.startsWith('true', this.i) && this.isTermEnd(this.i + 4)) {
      this.i += 4;
      return true;
    }
    if (this.src.startsWith('false', this.i) && this.isTermEnd(this.i + 5)) {
      this.i += 5;
      return false;
    }
    if (this.src.startsWith('null', this.i) && this.isTermEnd(this.i + 4)) {
      this.i += 4;
      return null;
    }

    throw new FlashvarsParseError('flashvars invalid');
  }

  // Parses a `{ key: value, ... }` object, including unquoted keys.
  private parseObject(): Record<string, unknown> {
    this.expect('{');
    const out: Record<string, unknown> = {};
    this.skipWs();

    if (this.peek() === '}') {
      this.i += 1;
      return out;
    }

    while (this.i < this.src.length) {
      this.skipWs();
      const key = this.parseKey();
      this.skipWs();
      this.expect(':');
      out[key] = this.parseValue();
      this.skipWs();

      if (this.peek() === ',') {
        this.i += 1;
        this.skipWs();
        if (this.peek() === '}') {
          this.i += 1;
          return out;
        }
        continue;
      }

      if (this.peek() === '}') {
        this.i += 1;
        return out;
      }

      throw new FlashvarsParseError('flashvars invalid');
    }

    throw new FlashvarsParseError('flashvars invalid');
  }

  // Parses a `[ value, ... ]` array.
  private parseArray(): unknown[] {
    this.expect('[');
    const out: unknown[] = [];
    this.skipWs();

    if (this.peek() === ']') {
      this.i += 1;
      return out;
    }

    while (this.i < this.src.length) {
      out.push(this.parseValue());
      this.skipWs();

      if (this.peek() === ',') {
        this.i += 1;
        this.skipWs();
        if (this.peek() === ']') {
          this.i += 1;
          return out;
        }
        continue;
      }

      if (this.peek() === ']') {
        this.i += 1;
        return out;
      }

      throw new FlashvarsParseError('flashvars invalid');
    }

    throw new FlashvarsParseError('flashvars invalid');
  }

  // Parses an object key as a quoted string or a bare identifier.
  private parseKey(): string {
    const ch = this.peek();
    if (ch === '"' || ch === "'") {
      return this.parseString();
    }

    const start = this.i;
    if (!this.isIdentStart(ch)) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    this.i += 1;
    while (this.i < this.src.length && this.isIdentPart(this.src[this.i])) {
      this.i += 1;
    }
    return this.src.slice(start, this.i);
  }

  // Parses a single- or double-quoted string, including escapes.
  private parseString(): string {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") {
      throw new FlashvarsParseError('flashvars invalid');
    }
    this.i += 1;

    let out = '';
    while (this.i < this.src.length) {
      const ch = this.src[this.i];
      if (ch === quote) {
        this.i += 1;
        return out;
      }
      if (ch === '\\') {
        this.i += 1;
        out += this.parseEscape();
        continue;
      }
      out += ch;
      this.i += 1;
    }

    throw new FlashvarsParseError('flashvars invalid');
  }

  // Resolves one `\` escape sequence inside a string.
  private parseEscape(): string {
    const ch = this.src[this.i];
    if (ch === undefined) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    this.i += 1;

    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '"':
      case "'":
      case '\\':
      case '/':
        return ch;
      case 'u': {
        const hex = this.src.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new FlashvarsParseError('flashvars invalid');
        }
        this.i += 4;
        return String.fromCharCode(Number.parseInt(hex, 16));
      }
      default:
        return ch;
    }
  }

  // Parses a finite number, including a leading minus and a decimal part.
  private parseNumber(): number {
    const start = this.i;
    if (this.peek() === '-') {
      this.i += 1;
    }

    if (!this.isDigit(this.peek())) {
      throw new FlashvarsParseError('flashvars invalid');
    }

    if (this.peek() === '0') {
      this.i += 1;
    } else {
      while (this.isDigit(this.peek())) {
        this.i += 1;
      }
    }

    if (this.peek() === '.') {
      this.i += 1;
      if (!this.isDigit(this.peek())) {
        throw new FlashvarsParseError('flashvars invalid');
      }
      while (this.isDigit(this.peek())) {
        this.i += 1;
      }
    }

    return Number(this.src.slice(start, this.i));
  }

  // Consumes the next character, or throws if it does not match.
  private expect(ch: string): void {
    if (this.src[this.i] !== ch) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    this.i += 1;
  }

  // Returns the current character without consuming it.
  private peek(): string {
    return this.src[this.i];
  }

  // Skips spaces and newlines before the next token.
  private skipWs(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) {
      this.i += 1;
    }
  }

  // True when the character is a decimal digit.
  private isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }

  // True when the character can start a JS identifier.
  private isIdentStart(ch: string | undefined): boolean {
    return ch !== undefined && /[A-Za-z_$]/.test(ch);
  }

  // True when the character can continue a JS identifier.
  private isIdentPart(ch: string | undefined): boolean {
    return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
  }

  // True when the next character ends a keyword such as true or null.
  private isTermEnd(index: number): boolean {
    const ch = this.src[index];
    return ch === undefined || /[\s,}\]]/.test(ch);
  }
}
