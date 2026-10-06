import { maxEditsFor, minimumTermsFor, toSearchTerms } from './search-terms';

describe('search terms', () => {
  it('lowercases, strips accents and operators, and drops duplicates', () => {
    expect(toSearchTerms('  -Latex "Mistress" Café café\\ ')).toEqual(['latex', 'mistress', 'cafe']);
  });

  it('drops stop words unless nothing else is left', () => {
    expect(toSearchTerms('the caged and plugged')).toEqual(['caged', 'plugged']);
    expect(toSearchTerms('the and')).toEqual(['the', 'and']);
  });

  it('returns nothing for punctuation only and caps the term count', () => {
    expect(toSearchTerms(' --- "" ')).toEqual([]);
    expect(toSearchTerms('a1 b2 c3 d4 e5 f6 g7 h8 i9 j0')).toHaveLength(8);
  });

  it('allows more typos in longer words and none in short words or numbers', () => {
    expect(maxEditsFor('cat')).toBe(0);
    expect(maxEditsFor('12345')).toBe(0);
    expect(maxEditsFor('cage')).toBe(1);
    expect(maxEditsFor('locktober')).toBe(2);
  });

  it('requires every term for short queries and most terms for long ones', () => {
    expect(minimumTermsFor(1)).toBe(1);
    expect(minimumTermsFor(2)).toBe(2);
    expect(minimumTermsFor(5)).toBe(4);
  });
});
