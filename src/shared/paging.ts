export const PER_PAGE_SIZE = 24;

// Coerces a query or service page value to a positive integer, defaulting to 1.
export function parsePage(value: unknown): number {
  const page = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  if (Number.isInteger(page) && page > 0) {
    return page;
  }
  return 1;
}
