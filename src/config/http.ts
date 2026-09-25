// Splits a comma-separated CORS_ORIGIN string into a list of origins.
export function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

// Reads TRUST_PROXY and returns hop count, or false when the proxy is off.
export function resolveTrustProxy(value: string | undefined): number | false {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '' || normalized === '0' || normalized === 'false' || normalized === 'off') {
    return false;
  }
  if (normalized === 'true' || normalized === 'on') {
    return 1;
  }

  const hops = Number(normalized);
  return Number.isInteger(hops) && hops > 0 ? hops : 1;
}
