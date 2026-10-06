const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 40;
const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'to', 'for', 'with', 'is', 'at', 'by']);

// Splits a keyword into lowercase, accent-free terms. Operators and punctuation never reach the search engine.
export function toSearchTerms(keyword: string): string[] {
  const all = keyword
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.slice(0, MAX_TERM_LENGTH))
    .filter((term) => term.length > 0);

  const meaningful = all.filter((term) => !STOP_WORDS.has(term));
  const terms = meaningful.length > 0 ? meaningful : all;

  return [...new Set(terms)].slice(0, MAX_TERMS);
}

// Typo budget by term length: short words must match exactly, long ones allow two edits.
export function maxEditsFor(term: string): 0 | 1 | 2 {
  if (term.length <= 3 || /^\d+$/.test(term)) {
    return 0;
  }
  return term.length <= 5 ? 1 : 2;
}

// How many terms a result must match. Short queries need all of them; long ones tolerate a miss or two.
export function minimumTermsFor(count: number): number {
  return count <= 2 ? count : Math.ceil(count * 0.7);
}
