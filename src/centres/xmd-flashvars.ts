import * as cheerio from 'cheerio';

export class FlashvarsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlashvarsParseError';
  }
}

const FLASHVARS_ASSIGN = /(?:(?:var|let|const)\s+)?(?:window\.)?flashvars\s*=\s*\{/i;

export function parseFlashvarsFromHtml(html: string): Record<string, unknown> {
  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new FlashvarsParseError('flashvars not found');
  }

  for (const source of collectSources(html)) {
    const literal = extractFlashvarsObjectLiteral(source);
    if (!literal) {
      continue;
    }

    const parsed = parseObjectLiteral(literal);
    if (parsed) {
      return parsed;
    }
  }

  throw new FlashvarsParseError('flashvars not found');
}

function collectSources(html: string): string[] {
  const $ = cheerio.load(html);
  const sources: string[] = [];

  $('script').each((_, el) => {
    const text = $(el).html();
    if (text && FLASHVARS_ASSIGN.test(text)) {
      sources.push(text);
    }
  });

  if (sources.length === 0) {
    sources.push(html);
  }

  return sources;
}

function extractFlashvarsObjectLiteral(source: string): string | null {
  const match = source.match(FLASHVARS_ASSIGN);
  if (!match || match.index === undefined) {
    return null;
  }

  const braceAt = match.index + match[0].length - 1;
  return extractBalancedObject(source, braceAt);
}

function extractBalancedObject(source: string, start: number): string | null {
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

function parseObjectLiteral(literal: string): Record<string, unknown> | null {
  try {
    const json = JSON.parse(literal) as unknown;
    if (isPlainRecord(json)) {
      return json;
    }
  } catch {
    /* JS object literal */
  }

  try {
    const parser = new LiteralParser(literal);
    return parser.parseRootObject();
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class LiteralParser {
  private i = 0;

  constructor(private readonly src: string) {}

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

    const n = Number(this.src.slice(start, this.i));
    if (!Number.isFinite(n)) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    return n;
  }

  private expect(ch: string): void {
    if (this.src[this.i] !== ch) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    this.i += 1;
  }

  private peek(): string {
    return this.src[this.i];
  }

  private skipWs(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) {
      this.i += 1;
    }
  }

  private isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }

  private isIdentStart(ch: string | undefined): boolean {
    return ch !== undefined && /[A-Za-z_$]/.test(ch);
  }

  private isIdentPart(ch: string | undefined): boolean {
    return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
  }

  private isTermEnd(index: number): boolean {
    const ch = this.src[index];
    return ch === undefined || /[\s,}\]]/.test(ch);
  }
}
