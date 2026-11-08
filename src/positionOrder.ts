/**
 * Canonical position order for emails, results and every list that shows positions.
 * Exact port of getPositionRank / sortByPositionOrder from your voter-page JS:
 * President, Vice President, Secretary, Treasurer, Auditor, PRO Internal, PRO External, then anything else (original order kept).
 */
export function getPositionRank(name: unknown): number {
  const n = String(name ?? '')
    .toLowerCase()
    .replace(/\./g, '') // "P.R.O." -> "pro"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const isPro = /\bpro\b/.test(n) || n.includes('public relation');

  if (isPro && /\b(internal|int)\b/.test(n)) return 5;
  if (isPro && /\b(external|ext)\b/.test(n)) return 6;
  if (/\bvice\b/.test(n) && n.includes('president')) return 1;
  if (n.includes('president')) return 0;
  if (n.includes('secretary')) return 2;
  if (n.includes('treasurer')) return 3;
  if (n.includes('auditor')) return 4;

  return 999; // unknown positions go last, original order preserved (Array.sort is stable)
}

export function sortByPositionOrder<T>(list: T[] | null | undefined, getName: (item: T) => unknown): T[] {
  return [...(list ?? [])].sort((a, b) => getPositionRank(getName(a)) - getPositionRank(getName(b)));
}

/** same, for an object keyed by position name (key order = JSON order) */
export function orderPositionKeys<V>(positions: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const key of sortByPositionOrder(Object.keys(positions), (k) => k)) out[key] = positions[key];
  return out;
}
